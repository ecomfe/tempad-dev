import {
  deserializeMessage,
  STDIO_DEFAULT_MAX_BUFFER_SIZE
} from '@modelcontextprotocol/sdk/shared/stdio.js'
import { rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { z } from 'zod'

import { ClientHookRequestSchema, type ClientHook } from '../agent-clients/hooks'
import { writeDurableJson } from '../durable-json'
import {
  ExpiredHookError,
  HOOK_RECEIPT_LIMIT,
  hookCutoff,
  hookSignature,
  isExpiredHookResult
} from '../hook-receipts'
import { listenPrivate } from './processes'
import { readPrivateJson } from './state'

const InboxSchema = z.array(
  z.object({
    input: ClientHookRequestSchema.shape.params,
    admittedHubId: z.uuid().optional(),
    retired: z.literal('expired').optional(),
    result: z.record(z.string(), z.unknown()).optional()
  })
)
const ReceiverSchema = z.object({ hubId: z.uuid(), freshAfter: z.number().optional() })

/** Keep the installed hook path alive while the data-plane Hub is stopped. */
export async function startHookGateway(
  root: string,
  deliver: (input: ClientHook, admittedHubId?: string) => Promise<Record<string, unknown>>,
  onFault: (error?: unknown) => void = () => {},
  socketPath = join(root, 'run', 'mcp.sock')
) {
  const path = join(root, 'hooks.json')
  const stored = readPrivateJson(
    path,
    z.union([
      InboxSchema,
      z.object({
        version: z.literal(2),
        cutoff: z.number(),
        entries: InboxSchema,
        receiver: ReceiverSchema.optional()
      })
    ])
  )
  let entries = Array.isArray(stored) ? stored : (stored?.entries ?? [])
  let cutoff = Array.isArray(stored) ? 0 : (stored?.cutoff ?? 0)
  let receiver = Array.isArray(stored) ? undefined : stored?.receiver
  let flushing: Promise<void> | undefined
  let closed = false
  const sockets = new Set<import('node:net').Socket>()
  const retained = (entry: (typeof entries)[number]) =>
    (!entry.result && !entry.retired) || entry.input.version !== 2 || entry.input.issuedAt > cutoff
  const capacityFailure = () =>
    entries.filter(retained).length >= HOOK_RECEIPT_LIMIT
      ? new Error('Hook inbox capacity reached.')
      : undefined
  const pending = () => entries.some((entry) => !entry.result && !entry.retired)
  const evidenceHub = (input: ClientHook) =>
    receiver &&
    (input.version !== 2 ||
      (input.issuedAt <= Date.now() &&
        (receiver.freshAfter === undefined || input.issuedAt > receiver.freshAfter)))
      ? receiver.hubId
      : undefined
  function save(next: typeof entries, nextReceiver = receiver) {
    if (closed) throw new Error('The hook inbox owner has closed.')
    try {
      writeDurableJson(path, { version: 2, cutoff, entries: next, receiver: nextReceiver })
      entries = next
      receiver = nextReceiver
    } catch (error) {
      onFault(error)
      throw error
    }
  }
  async function flush() {
    if (flushing) return flushing
    const run = async () => {
      while (true) {
        const entry = entries.find((value) => !value.result && !value.retired)
        if (!entry) {
          // A later Stop (including one admitted during this drain) must commit
          // before an earlier delivery fault can reopen the data plane.
          onFault(capacityFailure())
          return
        }
        const result = await deliver(
          entry.input,
          entry.admittedHubId === evidenceHub(entry.input) ? entry.admittedHubId : undefined
        ).catch((error: unknown) => {
          onFault(error)
          throw error
        })
        const retired = isExpiredHookResult(result)
        if (retired && entry.input.version === 2) cutoff = Math.max(cutoff, entry.input.issuedAt)
        const outcome = retired ? { retired: 'expired' as const } : { result }
        save(entries.map((value) => (value === entry ? { ...value, ...outcome } : value)))
      }
    }
    flushing = run()
    try {
      await flushing
    } finally {
      flushing = undefined
    }
  }
  const server = createServer((socket) => {
    if (sockets.size >= 128) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    let notifications = 0
    const timeout = setTimeout(() => socket.destroy(), 5000)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      clearTimeout(timeout)
      sockets.delete(socket)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > STDIO_DEFAULT_MAX_BUFFER_SIZE) {
        socket.destroy()
        return
      }
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let message
        try {
          message = deserializeMessage(buffer.slice(0, newline))
        } catch {
          socket.destroy()
          return
        }
        buffer = buffer.slice(newline + 1)
        // Old CLIs send identity notifications before initialize. Consume that
        // bounded prefix so the host receives an actionable initialize error.
        if (!('id' in message)) {
          if (++notifications > 16) {
            socket.destroy()
            return
          }
          continue
        }
        socket.removeAllListeners('data')
        void (async () => {
          const parsed = ClientHookRequestSchema.safeParse(message)
          if (!parsed.success) {
            socket.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32002,
                  message: 'MCP_RUNTIME_RESTART_REQUIRED: connect through the stable MCP edge.'
                }
              }) + '\n'
            )
            return
          }
          const input = parsed.data.params
          if (input.version === 2 && input.profile.kind !== 'release')
            throw new Error('Lifecycle hook belongs to a different runtime profile.')
          cutoff = hookCutoff(input, cutoff)
          const live = entries.filter(retained)
          if (live.length !== entries.length) save(live)
          const existing = entries.find((entry) => entry.input.invocationId === input.invocationId)
          if (existing && hookSignature(existing.input) !== hookSignature(input))
            throw new Error('Lifecycle invocation identity changed.')
          if (!existing) {
            const error = capacityFailure()
            if (error) {
              onFault(error)
              throw error
            }
            save([...entries, { input, admittedHubId: evidenceHub(input) }])
          }
          if (input.version === 2) {
            void flush().catch(() => {})
          } else await flush()
          const result = entries.find(
            (entry) => entry.input.invocationId === input.invocationId
          )?.result
          if (input.version === 1 && !result)
            throw new Error('Hook remains queued during runtime handoff.')
          socket.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result:
                input.version === 2
                  ? {
                      ...result,
                      receipt: {
                        version: 2,
                        invocationId: input.invocationId,
                        state: result ? 'applied' : 'accepted'
                      }
                    }
                  : result
            }) + '\n'
          )
        })().catch((error: unknown) => {
          if (error instanceof ExpiredHookError)
            socket.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32001, message: error.message }
              }) + '\n'
            )
          else socket.destroy()
        })
        return
      }
    })
  })
  rmSync(socketPath, { force: true })
  await listenPrivate(server, socketPath)
  onFault(
    capacityFailure() ?? (pending() ? new Error('Lifecycle hooks remain queued.') : undefined)
  )
  return {
    flush,
    setReceiver(hubId: string) {
      if (receiver?.hubId === hubId) return
      // A real Hub replacement requires new evidence. The first receiver still
      // accepts hooks issued while it was starting; reconnecting the same Hub
      // preserves its boundary and each invocation's original admission.
      save(
        entries,
        ReceiverSchema.parse({
          hubId,
          ...(receiver || stored !== undefined
            ? { freshAfter: Math.max(receiver?.freshAfter ?? 0, Date.now()) }
            : {})
        })
      )
    },
    get pending() {
      return pending()
    },
    close: async () => {
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(socketPath, { force: true })
    }
  }
}
