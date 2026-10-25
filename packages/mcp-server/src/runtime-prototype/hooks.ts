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
import { HOOK_RECEIPT_LIMIT, hookCutoff, hookSignature } from '../hook-receipts'
import { listenPrivate } from './processes'
import { readPrivateJson } from './state'

const InboxSchema = z.array(
  z.object({
    input: ClientHookRequestSchema.shape.params,
    result: z.record(z.string(), z.unknown()).optional()
  })
)

/** Keep the installed hook path alive while the data-plane Hub is stopped. */
export async function startHookGateway(
  root: string,
  deliver: (input: ClientHook) => Promise<Record<string, unknown>>,
  onFault: (error?: unknown) => void = () => {},
  socketPath = join(root, 'run', 'mcp.sock')
) {
  const path = join(root, 'hooks.json')
  const stored = readPrivateJson(
    path,
    z.union([
      InboxSchema,
      z.object({ version: z.literal(2), cutoff: z.number(), entries: InboxSchema })
    ])
  )
  let entries = Array.isArray(stored) ? stored : (stored?.entries ?? [])
  let cutoff = Array.isArray(stored) ? 0 : (stored?.cutoff ?? 0)
  let flushing: Promise<void> | undefined
  let closed = false
  const sockets = new Set<import('node:net').Socket>()
  const capacityFailure = () =>
    entries.length >= HOOK_RECEIPT_LIMIT ? new Error('Hook inbox capacity reached.') : undefined
  function save(next: typeof entries) {
    if (closed) throw new Error('The hook inbox owner has closed.')
    try {
      writeDurableJson(path, { version: 2, cutoff, entries: next })
      entries = next
    } catch (error) {
      onFault(error)
      throw error
    }
  }
  async function flush() {
    if (flushing) return flushing
    const run = async () => {
      while (true) {
        const entry = entries.find((value) => !value.result)
        if (!entry) return
        const result = await deliver(entry.input).catch((error: unknown) => {
          onFault(error)
          throw error
        })
        save(entries.map((value) => (value === entry ? { ...value, result } : value)))
        onFault(capacityFailure())
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
          const retained = entries.filter(
            (entry) => !entry.result || entry.input.version !== 2 || entry.input.issuedAt > cutoff
          )
          if (retained.length !== entries.length) save(retained)
          const existing = entries.find((entry) => entry.input.invocationId === input.invocationId)
          if (existing && hookSignature(existing.input) !== hookSignature(input))
            throw new Error('Lifecycle invocation identity changed.')
          if (!existing) {
            const error = capacityFailure()
            if (error) {
              onFault(error)
              throw error
            }
            save([...entries, { input }])
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
        })().catch(() => socket.destroy())
        return
      }
    })
  })
  rmSync(socketPath, { force: true })
  await listenPrivate(server, socketPath)
  onFault(capacityFailure())
  return {
    flush,
    close: async () => {
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(socketPath, { force: true })
    }
  }
}
