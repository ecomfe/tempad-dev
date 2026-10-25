import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import { captureHostContext, HostContextNotificationSchema } from '../agent-clients/host-context'
import { runtimeIdentity } from '../agent-clients/identity'
import { ClientBindingSubscribeSchema } from '../client-binding'
import { getMcpServerConfig } from '../config'
import { ConsumerTransport } from '../consumer-transport'
import { endLogging, PACKAGE_VERSION, SOCK_PATH } from '../shared'
import { startStableEdge } from '../stable-edge'
import { connectSocket, supervisorConnection, type PrototypeConfig } from './processes'
import {
  ControlPeer,
  CONTROL_VERSIONS,
  GrantSchema,
  RECOVER_MS,
  REQUEST_TIMEOUT_MS,
  RuntimeDataTransport,
  SocketTransport,
  type Grant,
  type Registration
} from './protocol'

export async function startPrototypeEdge(config: PrototypeConfig) {
  const registration: Registration = {
    sessionId: randomUUID(),
    token: randomUUID(),
    context: captureHostContext(process.env),
    versions: [...CONTROL_VERSIONS]
  }
  let control: ControlPeer | undefined
  let grant: Grant | undefined
  let ready = false
  let recovering = false
  let lifetime: AbortSignal
  const runtimeConfig = getMcpServerConfig()
  const requestTimeoutMs = Math.max(
    REQUEST_TIMEOUT_MS,
    ...[
      runtimeConfig.toolTimeoutMs,
      runtimeConfig.applyCanvasTimeoutMs,
      runtimeConfig.getCodeTimeoutMs,
      runtimeConfig.getDesignSystemTimeoutMs,
      runtimeConfig.pageStructureTimeoutMs
    ].map((value) => value + 10_000)
  )

  async function attachControl() {
    const socket = await supervisorConnection(config, lifetime)
    const peer = new ControlPeer()
    peer.onerror = () => void peer.close()
    try {
      await peer.connect(new SocketTransport(socket))
      const next = await peer.request(
        { method: 'tempad/runtime-hello', params: registration },
        GrantSchema,
        {
          timeout: 5000,
          signal: lifetime
        }
      )
      if (!peer.transport) throw new Error('Supervisor closed during registration.')
      if (grant && grant.hubId !== next.hubId)
        throw new Error(
          'The runtime Hub was replaced. Pending writes will not be replayed; restart the isolated prototype.'
        )
      lifetime.throwIfAborted()
      grant = next
      control = peer
      ready = true
      peer.onclose = () => {
        if (control !== peer) return
        ready = false
        if (!lifetime.aborted) void recover()
      }
    } catch (error) {
      await peer.close()
      throw error
    }
  }

  async function recover() {
    if (recovering || lifetime.aborted) return
    recovering = true
    const deadline = performance.now() + RECOVER_MS
    try {
      do {
        try {
          await attachControl()
          return
        } catch {
          if (lifetime.aborted) return
          await delay(200, undefined, { signal: lifetime })
        }
      } while (performance.now() < deadline)
      process.stderr.write(
        'Runtime supervisor recovery exhausted. The MCP session remains open; writes are unavailable and were not replayed.\n'
      )
    } catch {
      // Host closure ends recovery without creating another process.
    } finally {
      recovering = false
    }
  }

  const host = new ConsumerTransport()
  const edge = await startStableEdge(host, {
    version: PACKAGE_VERSION,
    requestTimeoutMs,
    onError: (error) => process.stderr.write(`Runtime edge: ${error.message}\n`),
    open: async (_initialize, signal) => {
      lifetime = signal
      await attachControl()
      const socket = await connectSocket(SOCK_PATH, signal)
      const wire = new SocketTransport(socket)
      try {
        await new Promise<void>((resolve, reject) => {
          const id = randomUUID()
          const timeout = setTimeout(
            () => finish(new Error('Runtime data attachment timed out.')),
            5000
          )
          const abort = () => finish(new Error('Runtime data attachment cancelled.'))
          const finish = (error?: Error) => {
            clearTimeout(timeout)
            signal.removeEventListener('abort', abort)
            if (error) reject(error)
            else resolve()
          }
          wire.onclose = () => finish(new Error('Runtime data socket closed.'))
          wire.onerror = finish
          wire.onmessage = (message: JSONRPCMessage) => {
            if (!('method' in message) && message.id === id)
              finish('error' in message ? new Error(message.error.message) : undefined)
            else finish(new Error('Unexpected runtime attachment response.'))
          }
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) {
            abort()
            return
          }
          void wire
            .start()
            .then(() =>
              wire.send({
                jsonrpc: '2.0',
                id,
                method: 'tempad/runtime-attach',
                params: { sessionId: registration.sessionId, token: registration.token }
              })
            )
            .catch(finish)
        })
        return new RuntimeDataTransport(wire, {
          generation: () => grant!.generation,
          admit: (generation) => ready && grant?.generation === generation,
          role: 'edge',
          timeoutMs: requestTimeoutMs,
          started: true
        })
      } catch (error) {
        await wire.close()
        throw error
      }
    },
    register: async (client) => {
      await client.notification({
        method: HostContextNotificationSchema.shape.method.value,
        params: registration.context
      })
      const identity = runtimeIdentity(process.env).client
      await client.notification({
        method: 'notifications/tempad/client-event',
        params: {
          event: 'connect',
          kind: identity.kind,
          sessionId: identity.sessionId
        }
      })
      const sessionId = process.env.CLAUDE_CODE_SESSION_ID
      await client.notification({
        method: ClientBindingSubscribeSchema.shape.method.value,
        ...(sessionId && sessionId.length <= 256 ? { params: { sessionId } } : {})
      })
    }
  })
  const close = () => void edge.close()
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  process.stdin.once('end', close)
  if (await edge.closed) process.exitCode = 1
  process.off('SIGINT', close)
  process.off('SIGTERM', close)
  process.stdin.off('end', close)
  await control?.close()
  process.stdin.destroy()
  endLogging()
}
