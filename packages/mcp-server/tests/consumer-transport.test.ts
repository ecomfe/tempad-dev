import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsumerTransport } from '../src/consumer-transport'

const fixtures: { input: PassThrough; output: PassThrough; transport: ConsumerTransport }[] = []
function fixture() {
  const input = new PassThrough()
  const output = new PassThrough()
  const transport = new ConsumerTransport(input, output)
  const messages: JSONRPCMessage[] = []
  let buffer = ''
  output.on('data', (chunk) => {
    buffer += String(chunk)
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      messages.push(JSON.parse(buffer.slice(0, newline)))
      buffer = buffer.slice(newline + 1)
    }
  })
  const value = {
    input,
    output,
    transport,
    messages,
    send: (message: JSONRPCMessage) => input.write(JSON.stringify(message) + '\n')
  }
  fixtures.push(value)
  return value
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    await value.transport.close()
    value.input.destroy()
    value.output.destroy()
  }
})

const ids = [
  0,
  '',
  1,
  -7,
  'tempad:request:zero',
  'tempad:request:string:',
  'tempad:request:string:abc'
]

describe('consumer request ID cancellation compatibility', () => {
  it('cancels concurrent requests without collisions between number, empty and prefixed string IDs', async () => {
    const f = fixture()
    const mcp = new McpServer({ name: 'fixture', version: '1' })
    const signals: AbortSignal[] = []
    const finish: (() => void)[] = []
    mcp.registerTool('wait', { inputSchema: {} }, async (_args, extra) => {
      signals.push(extra.signal)
      await new Promise<void>((resolve) => finish.push(resolve))
      return { content: [] }
    })
    await mcp.connect(f.transport)
    try {
      for (const id of ids)
        f.send({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'wait', arguments: {} }
        })
      await vi.waitFor(() => expect(signals).toHaveLength(ids.length))
      for (const [index, id] of ids.entries()) {
        f.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } })
        await vi.waitFor(() => expect(signals[index]!.aborted).toBe(true))
        expect(signals.slice(index + 1).every((signal) => !signal.aborted)).toBe(true)
      }
    } finally {
      for (const resolve of finish) resolve()
      await mcp.close()
    }
  })

  it('preserves response IDs, request metadata and progress tokens on the wire', async () => {
    const f = fixture()
    const mcp = new McpServer({ name: 'fixture', version: '1' })
    mcp.registerTool('echo', { inputSchema: {} }, async (_args, extra) => {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: '', progress: 1 }
      })
      return { content: [{ type: 'text', text: JSON.stringify(extra._meta) }] }
    })
    await mcp.connect(f.transport)
    const meta = { progressToken: '', trace: 'tempad:request:zero' }
    for (const id of ids)
      f.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'echo', arguments: {}, _meta: meta }
      })
    await vi.waitFor(() => expect(f.messages).toHaveLength(ids.length * 2))
    expect(f.messages.flatMap((message) => ('id' in message ? [message.id] : []))).toEqual(ids)
    for (const message of f.messages) {
      if ('method' in message)
        expect(message).toEqual({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { progressToken: '', progress: 1 }
        })
      else
        expect(message).toMatchObject({
          result: { content: [{ type: 'text', text: JSON.stringify(meta) }] }
        })
    }
    f.send({
      jsonrpc: '2.0',
      id: '',
      method: 'tools/call',
      params: { name: 'missing', arguments: {} }
    })
    await vi.waitFor(() => expect(f.messages).toHaveLength(ids.length * 2 + 1))
    expect(f.messages.at(-1)).toMatchObject({ id: '', result: { isError: true } })
    f.send({ jsonrpc: '2.0', id: 'tempad:request:zero', method: 'unknown-method' })
    await vi.waitFor(() => expect(f.messages).toHaveLength(ids.length * 2 + 2))
    expect(f.messages.at(-1)).toMatchObject({ id: 'tempad:request:zero', error: { code: -32601 } })
    await mcp.close()
  })

  it('keeps server-initiated request IDs and incoming response IDs independent', async () => {
    const f = fixture()
    const mcp = new McpServer({ name: 'fixture', version: '1' })
    await mcp.connect(f.transport)
    const ping = mcp.server.ping()
    await vi.waitFor(() => expect(f.messages).toHaveLength(1))
    expect(f.messages[0]).toEqual({ jsonrpc: '2.0', id: 0, method: 'ping' })
    f.send({ jsonrpc: '2.0', id: 0, result: {} })
    await expect(ping).resolves.toEqual({})
    await mcp.close()
  })

  it('forwards stream errors and close callbacks, and stops consuming after close', async () => {
    const f = fixture()
    const error = new Error('Input failed')
    f.transport.onerror = vi.fn()
    f.transport.onclose = vi.fn()
    const receive = vi.fn()
    f.transport.onmessage = receive
    await f.transport.start()
    f.input.emit('error', error)
    expect(f.transport.onerror).toHaveBeenCalledExactlyOnceWith(error)
    await f.transport.close()
    expect(f.transport.onclose).toHaveBeenCalledOnce()
    f.send({ jsonrpc: '2.0', id: 0, method: 'ping' })
    expect(receive).not.toHaveBeenCalled()
  })

  it('rejects duplicate starts without changing the live connection ID mapping', async () => {
    const f = fixture()
    const receive = vi.fn<(message: JSONRPCMessage) => void>()
    f.transport.onmessage = receive
    await f.transport.start()
    await expect(f.transport.start()).rejects.toThrow('already started')
    f.send({ jsonrpc: '2.0', id: 0, method: 'ping' })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    const message = receive.mock.calls[0]![0]
    if (!('id' in message) || message.id === undefined) throw new Error('Missing request ID')
    await f.transport.send({ jsonrpc: '2.0', id: message.id, result: {} })
    expect(f.messages).toEqual([{ jsonrpc: '2.0', id: 0, result: {} }])
  })
})
