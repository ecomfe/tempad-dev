import type { Socket } from 'node:net'

import { ResultSchema, type RequestId } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { finished } from 'node:stream/promises'
import { z } from 'zod'

import { ClientHookRequestSchema } from '../agent-clients/hooks'
import { getRuntimeTimingConfig } from '../config'
import {
  ControlPeer,
  LEASE_MS,
  negotiate,
  RegistrationSchema,
  RECOVER_MS,
  SocketTransport,
  type Registration,
  unavailable
} from './protocol'

export const AUTOMATIC_IDLE_MS = getRuntimeTimingConfig().automaticIdleMs

export class HubControl {
  readonly hubId = randomUUID()
  private generation = 0
  private peer?: ControlPeer
  private expires = 0
  private gated: boolean
  private stopping = false
  private retained = false
  private readonly sessions = new Map<
    string,
    Registration & { generation: number; attached: boolean; expires: number }
  >()

  constructor(
    private readonly secret: string,
    private readonly now = () => performance.now(),
    private readonly handoff?: {
      paused?: boolean
      inspect: () => {
        drained: boolean
        deadline: number
        blockers: string[]
        version: string
        autoBlockers?: string[]
        idleForMs?: number
      }
      flush: () => void
      stop: () => Promise<void>
      retireLegacyHooks?: () => void
      hook: (
        input: import('../agent-clients/hooks').ClientHook,
        fresh: boolean
      ) => Record<string, unknown>
    }
  ) {
    this.gated = handoff?.paused ?? false
  }

  admitting() {
    return this.available() && !this.gated
  }

  keepAlive() {
    return this.available() && this.retained
  }

  available(generation = this.generation) {
    return !!this.peer && generation === this.generation && this.now() < this.expires
  }

  get currentGeneration() {
    return this.generation
  }

  pendingConnections() {
    let pending = 0
    for (const [id, session] of this.sessions) {
      if (session.attached) continue
      if (session.generation !== this.generation || session.expires <= this.now())
        this.sessions.delete(id)
      else pending++
    }
    return pending
  }

  private attachedSessions() {
    return [...this.sessions].filter(([, session]) => session.attached).map(([id]) => id)
  }

  async attach(socket: Socket) {
    const peer = new ControlPeer()
    let acquired = false
    let pendingStop: { id: RequestId; signal: AbortSignal } | undefined
    const cancelStop = () => {
      if (!pendingStop) return
      pendingStop.signal.removeEventListener('abort', cancelStop)
      pendingStop = undefined
      this.stopping = false
    }
    const transport = new SocketTransport(socket, async (message) => {
      if (!pendingStop || !('result' in message) || message.id !== pendingStop.id) return
      // The SDK schedules response writes after the handler returns. Commit the
      // shutdown only after its reply was written, then finish the pipe gracefully.
      pendingStop.signal.removeEventListener('abort', cancelStop)
      pendingStop = undefined
      try {
        const ended = finished(socket, {
          readable: false,
          cleanup: true,
          signal: AbortSignal.timeout(5000)
        })
        socket.end()
        await ended
      } finally {
        // The flushed acknowledgement commits the stop. A later pipe failure
        // cannot revoke the exit already promised to the supervisor.
        // Partial shutdown also stays fenced until the process exits.
        await this.handoff!.stop()
      }
    })
    peer.onerror = () => {
      cancelStop()
      void peer.close()
    }
    peer.onclose = () => {
      cancelStop()
      if (this.peer === peer) {
        this.peer = undefined
        this.retained = false
      }
    }
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-acquire'),
        params: z
          .object({
            secret: z.string(),
            versions: z.array(z.number().int().positive()).max(16)
          })
          .strict()
      }),
      ({ params }) => {
        const version = negotiate(params.versions)
        if (acquired) throw unavailable('Control lease acquisition is single-use.')
        if (params.secret !== this.secret || (this.peer && this.peer !== peer && this.available()))
          throw unavailable('Runtime control is already owned or its capability is invalid.')
        acquired = true
        this.generation++
        void this.peer?.close()
        this.peer = peer
        this.expires = this.now() + LEASE_MS
        return { version, generation: this.generation, hubId: this.hubId, hubPid: process.pid }
      }
    )
    const requireLease = () => {
      if (this.peer !== peer || !this.available()) throw unavailable()
    }
    peer.setRequestHandler(
      z.object({ method: z.literal('tempad/runtime-retire-legacy-hooks') }),
      () => {
        requireLease()
        if (!this.handoff?.retireLegacyHooks)
          throw unavailable('This Hub cannot retire legacy lifecycle evidence.')
        this.handoff.retireLegacyHooks()
        this.handoff.flush()
        return {}
      }
    )
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-renew') }), () => {
      requireLease()
      this.expires = this.now() + LEASE_MS
      return {}
    })
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-hook'),
        params: z
          .object({
            input: ClientHookRequestSchema.shape.params,
            admittedHubId: z.uuid().optional()
          })
          .strict()
      }),
      ({ params }) => {
        requireLease()
        if (!this.handoff) throw unavailable('Durable hook admission is unavailable.')
        return this.handoff.hook(params.input, params.admittedHubId === this.hubId)
      }
    )
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-retain'),
        params: z.object({ retained: z.boolean() })
      }),
      ({ params }) => {
        requireLease()
        this.retained = params.retained
        return {}
      }
    )
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-inspect') }), () => {
      requireLease()
      if (!this.handoff) throw unavailable('This Hub does not support durable handoff.')
      return {
        ...this.handoff.inspect(),
        attachedSessions: this.attachedSessions(),
        gated: this.gated,
        handoffVersion: 1
      }
    })
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-gate'),
        params: z.object({ closed: z.boolean() }).strict()
      }),
      ({ params }) => {
        requireLease()
        if (!this.handoff || this.stopping)
          throw unavailable('This Hub cannot change its admission gate.')
        if (!params.closed) this.handoff.flush()
        this.gated = params.closed
        return {
          ...this.handoff.inspect(),
          attachedSessions: this.attachedSessions(),
          gated: this.gated,
          handoffVersion: 1
        }
      }
    )
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-stop'),
        params: z
          .object({
            pausedSessions: z.array(z.uuid()).max(128),
            automatic: z.literal(true).optional()
          })
          .strict()
      }),
      ({ params }, extra) => {
        requireLease()
        const handoff = this.handoff
        const state = handoff?.inspect()
        if (this.stopping) throw unavailable('Runtime shutdown has already been admitted.')
        if (!this.gated || !handoff || !state?.drained)
          throw unavailable('Runtime has not drained; shutdown was not admitted.')
        if (this.attachedSessions().some((id) => !params.pausedSessions.includes(id)))
          throw unavailable('An MCP data session has no acknowledged admission barrier.')
        if (
          params.automatic &&
          (!state.autoBlockers ||
            state.autoBlockers.length ||
            (state.idleForMs ?? 0) < AUTOMATIC_IDLE_MS)
        )
          throw unavailable('Runtime is no longer idle or eligible for automatic replacement.')
        handoff.flush()
        this.stopping = true
        pendingStop = { id: extra.requestId, signal: extra.signal }
        extra.signal.addEventListener('abort', cancelStop, { once: true })
        if (extra.signal.aborted) cancelStop()
        return { stopping: this.hubId }
      }
    )
    peer.setRequestHandler(
      z.object({ method: z.literal('tempad/runtime-register'), params: RegistrationSchema }),
      ({ params }) => {
        requireLease()
        negotiate(params.versions)
        // Expire abandoned registrations before applying the capacity limit.
        this.pendingConnections()
        const existing = this.sessions.get(params.sessionId)
        if (
          existing &&
          (existing.token !== params.token ||
            JSON.stringify(existing.context) !== JSON.stringify(params.context))
        )
          throw unavailable('Runtime session identity changed; reconnect the MCP host.')
        if (!existing && this.sessions.size >= 128) throw unavailable('Too many runtime sessions.')
        this.sessions.set(params.sessionId, {
          ...params,
          generation: this.generation,
          attached: existing?.attached ?? false,
          expires: this.now() + RECOVER_MS
        })
        return { generation: this.generation }
      }
    )
    await peer.connect(transport)
    return peer
  }

  claimSession(sessionId: string, token: string) {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      this.stopping ||
      session.token !== token ||
      !this.available(session.generation) ||
      (!session.attached && session.expires <= this.now())
    )
      throw unavailable('Runtime session has no current supervisor grant.')
    session.attached = true
    return session
  }

  admits(sessionId: string, generation: number, method?: string) {
    return (
      this.available(generation) &&
      this.sessions.get(sessionId)?.generation === generation &&
      (!this.gated || ['initialize', 'tools/list', 'ping'].includes(method ?? ''))
    )
  }

  forget(sessionId: string) {
    this.sessions.delete(sessionId)
  }
  close() {
    return this.peer?.close()
  }
}

export const LeaseSchema = ResultSchema.extend({
  version: z.number().int().positive(),
  generation: z.number().int().positive(),
  hubId: z.uuid(),
  hubPid: z.number().int().positive()
})
