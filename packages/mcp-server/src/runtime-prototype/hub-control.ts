import type { Socket } from 'node:net'

import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

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

export class HubControl {
  readonly hubId = randomUUID()
  private generation = 0
  private peer?: ControlPeer
  private expires = 0
  private readonly sessions = new Map<
    string,
    Registration & { generation: number; attached: boolean; expires: number }
  >()

  constructor(
    private readonly secret: string,
    private readonly now = () => performance.now()
  ) {}

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
      if (session.expires <= this.now()) this.sessions.delete(id)
      else pending++
    }
    return pending
  }

  async attach(socket: Socket) {
    const peer = new ControlPeer()
    let acquired = false
    peer.onerror = () => void peer.close()
    peer.onclose = () => {
      if (this.peer === peer) this.peer = undefined
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
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-renew') }), () => {
      requireLease()
      this.expires = this.now() + LEASE_MS
      return {}
    })
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
    await peer.connect(new SocketTransport(socket))
    return peer
  }

  claimSession(sessionId: string, token: string) {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      session.token !== token ||
      !this.available(session.generation) ||
      (!session.attached && session.expires <= this.now())
    )
      throw unavailable('Runtime session has no current supervisor grant.')
    session.attached = true
    return session
  }

  admits(sessionId: string, generation: number) {
    return this.available(generation) && this.sessions.get(sessionId)?.generation === generation
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
