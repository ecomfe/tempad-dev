import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

it.each([
  {
    name: 'unnegotiated terminal receipt',
    raw: JSON.stringify({
      type: 'toolCall',
      id: 'call',
      payload: { name: 'get_code', args: {} },
      terminalReceipt: { token: 'unexpected' }
    })
  },
  {
    name: 'unsupported completion acknowledgment',
    raw: JSON.stringify({ type: 'toolCompletionAck' })
  },
  { name: 'malformed JSON', raw: '{' }
])('reports $name through the harness failure path', async ({ raw }) => {
  const module = '../scripts/check-protocol-13.mjs'
  const { checkProtocol13 } = await import(module)
  const socket = new EventEmitter()
  const failures: unknown[] = []
  const upload = Promise.withResolvers<Response>()
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(upload.promise)
  const pending = checkProtocol13({
    port: 1234,
    origin: 'chrome-extension://fixture',
    peer: async (_port: number, _legacy: boolean, schema: { parse(value: unknown): unknown }) => {
      // Match peer()'s guarded receive boundary; all failures must stay inside it.
      socket.on('message', (raw: Buffer) => {
        try {
          schema.parse(JSON.parse(raw.toString()))
        } catch (error) {
          failures.push(error)
        }
      })
      return {
        socket,
        frames: [{ supportedProtocolVersions: [13] }],
        assetServerUrl: 'http://fixture.invalid'
      }
    },
    send: vi.fn(),
    activate: vi.fn(),
    call: async () => {
      throw failures[0] ?? new Error('Unexpected MCP request')
    }
  }).catch((error: unknown) => error)

  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(() => socket.emit('message', Buffer.from(raw))).not.toThrow()
    expect(failures).toHaveLength(1)
  } finally {
    upload.resolve(new Response(null, { status: 201 }))
    await pending
  }
  expect(await pending).toBe(failures[0])
})
