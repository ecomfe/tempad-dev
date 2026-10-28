import {
  deserializeMessage,
  STDIO_DEFAULT_MAX_BUFFER_SIZE
} from '@modelcontextprotocol/sdk/shared/stdio.js'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { z } from 'zod'

import { ClientHookRequestSchema, type ClientHook } from '../agent-clients/hooks'
import { writeDurableJson } from '../durable-json'
import {
  ExpiredHookError,
  HOOK_RECEIPT_LIMIT,
  LEGACY_HOOK_EXHAUSTED_RESULT,
  LegacyHookCapacityError,
  hookCutoff,
  hookPressureCutoff,
  hookRetentionCutoff,
  hookSignature,
  isExpiredHookResult
} from '../hook-receipts'
import { cleanupEndpoint, runtimeEndpoint } from '../runtime-platform'
import { listenPrivate } from './processes'
import { readPrivateJsonAsync } from './state'

const InboxSchema = z.array(
  z.object({
    input: ClientHookRequestSchema.shape.params,
    admittedHubId: z.uuid().optional(),
    recordedAt: z.number().optional(),
    retired: z.literal('expired').optional(),
    result: z.record(z.string(), z.unknown()).optional()
  })
)
const ReceiverSchema = z.object({ hubId: z.uuid(), freshAfter: z.number().optional() })
class FutureHookError extends Error {}

/** Keep the installed hook path alive while the data-plane Hub is stopped. */
export async function startHookGateway(
  root: string,
  deliver: (input: ClientHook, admittedHubId?: string) => Promise<Record<string, unknown>>,
  onFault: (error?: unknown) => void = () => {},
  socketPath = runtimeEndpoint(join(root, 'run'), 'mcp.sock'),
  retireLegacy: () => Promise<void> = async () => {
    throw new Error('Legacy lifecycle retirement requires a connected Hub.')
  },
  signal?: AbortSignal
) {
  const path = join(root, 'hooks.json')
  const stored = await readPrivateJsonAsync(
    path,
    z.object({
      version: z.literal(2),
      cutoff: z.number(),
      entries: InboxSchema,
      receiver: ReceiverSchema.optional()
    })
  )
  signal?.throwIfAborted()
  let entries = stored?.entries ?? []
  let cutoff = stored?.cutoff ?? 0
  let receiver = stored?.receiver
  let flushing: Promise<void> | undefined
  let legacyRetiredFor: string | undefined
  let closed = false
  const sockets = new Set<import('node:net').Socket>()
  const pendingEntry = (entry: (typeof entries)[number]) => !entry.result && !entry.retired
  const capacityFailure = () =>
    entries.filter(pendingEntry).length >= HOOK_RECEIPT_LIMIT
      ? new Error('Hook inbox capacity reached.')
      : undefined
  const pending = () => entries.some(pendingEntry)
  const legacyExhausted = () =>
    entries.some((entry) => entry.result?.runtimeHookLegacyUpgradeRequired === true) ||
    entries.filter((entry) => entry.input.version === 1).length >= HOOK_RECEIPT_LIMIT
  const evidenceHub = (input: ClientHook) =>
    receiver &&
    (input.version !== 2 ||
      receiver.freshAfter === undefined ||
      input.issuedAt > receiver.freshAfter)
      ? receiver.hubId
      : undefined
  function save(next: typeof entries, nextReceiver = receiver, nextCutoff = cutoff) {
    if (closed) throw new Error('The hook inbox owner has closed.')
    try {
      writeDurableJson(path, {
        version: 2,
        cutoff: nextCutoff,
        entries: next,
        receiver: nextReceiver
      })
      entries = next
      receiver = nextReceiver
      cutoff = nextCutoff
    } catch (error) {
      onFault(error)
      throw error
    }
  }
  function compact(reserveResult = false) {
    let nextCutoff = hookRetentionCutoff(cutoff)
    const legacyCutoff = hookRetentionCutoff(0)
    if (reserveResult) {
      const completed: number[] = []
      const unresolved: number[] = []
      for (const entry of entries)
        if (entry.input.version === 2)
          (pendingEntry(entry) ? unresolved : completed).push(entry.input.issuedAt)
      nextCutoff = hookPressureCutoff(nextCutoff, completed, unresolved)
    }
    const next = entries.filter(
      (entry) =>
        pendingEntry(entry) || entry.input.version !== 2 || entry.input.issuedAt > nextCutoff
    )
    const compacted = next.map((entry) => {
      if (
        entry.input.version === 1 &&
        entry.result &&
        !entry.retired &&
        (entry.recordedAt === undefined || entry.recordedAt <= legacyCutoff)
      ) {
        // Legacy senders have no timestamp. Keep their identity as an old-reader-safe
        // tombstone: forgetting it would let a retry become fresh lifecycle evidence.
        return {
          input: entry.input,
          retired: 'expired' as const,
          ...(entry.result.runtimeHookLegacyUpgradeRequired
            ? { result: LEGACY_HOOK_EXHAUSTED_RESULT }
            : {})
        }
      }
      return entry
    })
    if (
      nextCutoff !== cutoff ||
      compacted.length !== entries.length ||
      compacted.some((entry, index) => entry !== entries[index])
    )
      save(compacted, receiver, nextCutoff)
  }
  async function flush() {
    if (flushing) return flushing
    const run = async () => {
      compact()
      while (true) {
        const entry = entries.find(pendingEntry)
        if (!entry) {
          // A later Stop (including one admitted during this drain) must commit
          // before an earlier delivery fault can reopen the data plane.
          const receiverId = receiver?.hubId ?? ''
          if (legacyExhausted() && legacyRetiredFor !== receiverId) {
            try {
              await retireLegacy()
              legacyRetiredFor = receiverId
            } catch (error) {
              onFault(error)
              throw error
            }
          }
          if (pending() || receiverId !== (receiver?.hubId ?? '')) continue
          onFault(undefined)
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
        const outcome = retired ? { retired: 'expired' as const, result } : { result }
        save(
          entries.map((value) =>
            value === entry ? { ...value, ...outcome, recordedAt: Date.now() } : value
          ),
          receiver,
          retired && entry.input.version === 2 ? Math.max(cutoff, entry.input.issuedAt) : cutoff
        )
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
          const admittedAt = Date.now()
          const known = entries.some((entry) => entry.input.invocationId === input.invocationId)
          compact()
          hookCutoff(input, cutoff, admittedAt)
          if (input.version === 2 && !known) {
            // A retryable clock skew must not evict completed results before admission.
            if (input.issuedAt > admittedAt)
              throw new FutureHookError(
                'Lifecycle invocation is ahead of the runtime clock; retry the same invocation.'
              )
            compact(true)
            hookCutoff(input, cutoff, admittedAt)
          }
          const existing = entries.find((entry) => entry.input.invocationId === input.invocationId)
          if (existing && hookSignature(existing.input) !== hookSignature(input))
            throw new Error('Lifecycle invocation identity changed.')
          if (existing?.retired) throw new ExpiredHookError(cutoff)
          if (!existing) {
            if (input.version === 1 && legacyExhausted()) {
              await flush()
              throw new LegacyHookCapacityError()
            }
            const error = capacityFailure()
            const historyFull =
              input.version === 2 &&
              entries.filter((entry) => entry.input.version === 2).length >= HOOK_RECEIPT_LIMIT
            if (error || historyFull) {
              const fault =
                error ??
                new Error('Hook result history is waiting for unresolved lifecycle effects.')
              onFault(fault)
              throw fault
            }
            save([...entries, { input, admittedHubId: evidenceHub(input) }])
            if (legacyExhausted()) onFault(new LegacyHookCapacityError())
          }
          if (input.version === 2) {
            void flush().catch(() => {})
          } else await flush()
          const result = entries.find(
            (entry) => entry.input.invocationId === input.invocationId
          )?.result
          if (result?.runtimeHookLegacyUpgradeRequired) throw new LegacyHookCapacityError()
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
          if (
            error instanceof ExpiredHookError ||
            error instanceof FutureHookError ||
            error instanceof LegacyHookCapacityError
          )
            socket.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32001,
                  message: error.message,
                  ...(error instanceof FutureHookError || error instanceof LegacyHookCapacityError
                    ? {
                        data: {
                          code:
                            error instanceof FutureHookError
                              ? 'MCP_HOOK_CLOCK_AHEAD'
                              : 'MCP_HOOK_LEGACY_UPGRADE_REQUIRED'
                        }
                      }
                    : {})
                }
              }) + '\n'
            )
          else socket.destroy()
        })
        return
      }
    })
  })
  compact()
  cleanupEndpoint(socketPath)
  await listenPrivate(server, socketPath, signal)
  onFault(
    capacityFailure() ??
      (pending()
        ? new Error('Lifecycle hooks remain queued.')
        : legacyExhausted()
          ? new LegacyHookCapacityError()
          : undefined)
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
    get legacyExhausted() {
      return legacyExhausted()
    },
    close: async () => {
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      cleanupEndpoint(socketPath)
    }
  }
}
