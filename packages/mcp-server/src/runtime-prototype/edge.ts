import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { McpError, ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

import { captureHostContext, HostContextNotificationSchema } from '../agent-clients/host-context'
import { runtimeIdentity } from '../agent-clients/identity'
import { ClientBindingSubscribeSchema, type ClaudeBinding } from '../client-binding'
import { getMcpServerConfig } from '../config'
import { ConsumerTransport } from '../consumer-transport'
import { releaseManifest } from '../runtime-update/artifact'
import { endLogging, PACKAGE_VERSION } from '../shared'
import { contractHashes, startStableEdge } from '../stable-edge'
import {
  connectSocket,
  hubSocketPath,
  supervisorConnection,
  unavailableSocket,
  type PrototypeConfig
} from './processes'
import {
  ControlPeer,
  isRuntimeUnavailable,
  CONTROL_VERSIONS,
  GrantSchema,
  RECOVER_MS,
  REQUEST_TIMEOUT_MS,
  RuntimeDataTransport,
  SocketTransport,
  unavailable,
  type Grant,
  type Registration
} from './protocol'
import { readJournal } from './state'

export async function startPrototypeEdge(
  config: PrototypeConfig,
  updates?: Registration['updates']
) {
  const registration: Registration = {
    sessionId: randomUUID(),
    token: randomUUID(),
    context: captureHostContext(process.env),
    versions: [...CONTROL_VERSIONS],
    ...(updates ? { updates } : {})
  }
  let control: ControlPeer | undefined
  let grant: Grant | undefined
  let ready = false
  let recovering = false
  let lifetime: AbortSignal
  let edge: Awaited<ReturnType<typeof startStableEdge>> | undefined = undefined
  let backendHubId: string | undefined
  let backendLost = false
  let replacing = false
  let attaching: Promise<void> | undefined
  let openingHubId: string | undefined
  let frozenEpoch: number | undefined
  let claudeBinding: ClaudeBinding | undefined
  let claudeHintRetired = false
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

  function attachControl(signal = lifetime): Promise<void> {
    // A lost Hub can close data and control at the same time. Both recovery
    // paths must share registration, or a duplicate control peer pins updates.
    attaching ??= openControl(signal).finally(() => {
      attaching = undefined
    })
    return attaching
  }

  async function openControl(signal: AbortSignal) {
    const socket = await supervisorConnection(config, signal)
    const peer = new ControlPeer()
    peer.onerror = () => void peer.close()
    try {
      await peer.connect(new SocketTransport(socket))
      const next = await peer.request(
        { method: 'tempad/runtime-hello', params: registration },
        GrantSchema,
        {
          timeout: 5000,
          signal
        }
      )
      if (!peer.transport) throw new Error('Supervisor closed during registration.')
      signal.throwIfAborted()
      grant = next
      const previous = control
      control = peer
      ready = true
      peer.setNotificationHandler(
        z.object({
          method: z.literal('notifications/tempad/runtime-replaced'),
          params: GrantSchema
        }),
        async ({ params }) => {
          grant = params
          ready = true
          if (backendHubId && (backendLost || backendHubId !== params.hubId)) void replaceBackend()
          else if (backendHubId) await acknowledgeReady()
        }
      )
      peer.onclose = () => {
        if (control !== peer) return
        ready = false
        if (!lifetime.aborted) void recover()
      }
      await previous?.close()
      if (backendHubId && (backendLost || backendHubId !== next.hubId)) void replaceBackend()
      else if (backendHubId) await acknowledgeReady()
    } catch (error) {
      await peer.close()
      throw error
    }
  }

  async function acknowledgeReady(error?: string) {
    await control!.request(
      {
        method: 'tempad/runtime-ready',
        params: { hubId: grant!.hubId, waitForRuntime: true, ...(error ? { error } : {}) }
      },
      ResultSchema,
      { timeout: 5000, signal: lifetime }
    )
  }

  async function replaceBackend() {
    if (replacing || !edge || lifetime.aborted) return
    replacing = true
    const deadline = performance.now() + RECOVER_MS
    try {
      while (!lifetime.aborted && performance.now() < deadline) {
        try {
          await edge.replaceBackend()
          return
        } catch (error) {
          if (error instanceof McpError && error.code === -32002)
            await acknowledgeReady(error.message).catch(() => {})
          if (!lifetime.aborted) await delay(100, undefined, { signal: lifetime })
        }
      }
      if (!lifetime.aborted)
        process.stderr.write(
          'Runtime backend recovery timed out; the MCP session remains open and no request was replayed.\n'
        )
    } catch {
      // Closing the host cancels connection recovery, never the remote write.
    } finally {
      replacing = false
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

  async function openTransport(signal: AbortSignal) {
    if (!control?.transport || !ready) await attachControl(signal)
    else
      grant = await control.request({ method: 'tempad/runtime-refresh' }, GrantSchema, {
        timeout: 5000,
        signal
      })
    let socket
    try {
      socket = await connectSocket(hubSocketPath(config.root, config.directories?.runtime), signal)
    } catch (error) {
      if (unavailableSocket(error)) throw unavailable('Runtime data endpoint is unavailable.')
      throw error
    }
    openingHubId = grant!.hubId
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
            finish(
              'error' in message
                ? new McpError(message.error.code, message.error.message, message.error.data)
                : undefined
            )
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
  }

  const host = new ConsumerTransport()
  edge = await startStableEdge(host, {
    ...(config.release
      ? {
          validateContract: (observed, version, previous) => {
            const journal = readJournal(config.root)
            const artifact = [journal?.active, journal?.candidate, journal?.previous].find(
              (value) => value?.version === version
            )
            if (!artifact) throw new Error('The backend is not a retained release artifact.')
            const manifest = releaseManifest(artifact)
            const hashes = contractHashes(observed)
            if (
              hashes.wireHash !== manifest.wireHash ||
              hashes.presentationHash !== manifest.presentationHash ||
              (previous &&
                (manifest.guidanceEpoch !== frozenEpoch ||
                  hashes.wireHash !== contractHashes(previous).wireHash))
            )
              throw new McpError(
                -32002,
                'MCP_RUNTIME_RESTART_REQUIRED: runtime contract or guidance changed.'
              )
            frozenEpoch ??= manifest.guidanceEpoch
          }
        }
      : {}),
    version: PACKAGE_VERSION,
    requestTimeoutMs,
    runtimeWaitMs: 10_000,
    onError: (error) => process.stderr.write(`Runtime edge: ${error.message}\n`),
    onBinding: (binding) => {
      claudeHintRetired = true
      if ('kind' in binding) claudeBinding = binding
    },
    onBackendClose: () => {
      backendLost = true
      void replaceBackend()
    },
    onBackendReady: async () => {
      if (openingHubId !== grant?.hubId)
        throw new Error('Runtime changed during backend initialization.')
      backendHubId = openingHubId
      backendLost = false
      await acknowledgeReady()
    },
    open: async (_initialize, hostSignal) => {
      lifetime = hostSignal
      const startup = backendHubId ? undefined : AbortSignal.timeout(RECOVER_MS)
      const signal = startup ? AbortSignal.any([hostSignal, startup]) : hostSignal
      // Retry only pre-MCP admission. Initialization and business requests are
      // never replayed, and permanent compatibility/ownership failures escape.
      for (;;) {
        try {
          return await openTransport(signal)
        } catch (error) {
          hostSignal.throwIfAborted()
          if (!startup || (!startup.aborted && !isRuntimeUnavailable(error))) throw error
          if (!startup.aborted) await delay(200, undefined, { signal }).catch(() => {})
          hostSignal.throwIfAborted()
          if (startup.aborted)
            throw unavailable('Runtime startup recovery timed out; retry the MCP connection.')
        }
      }
    },
    register: async (client) => {
      await client.notification({
        method: HostContextNotificationSchema.shape.method.value,
        params: registration.context
      })
      // As in the byte bridge, a remembered session is only a reconnect claim;
      // the replacement Hub still requires a fresh matching Claude hook.
      const identity = claudeBinding ?? runtimeIdentity(process.env).client
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
        ...(!claudeHintRetired && sessionId && sessionId.length <= 256
          ? { params: { sessionId } }
          : {})
      })
    }
  })
  const close = () => void edge!.close()
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
