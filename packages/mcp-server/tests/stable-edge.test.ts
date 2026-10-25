import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ResultSchema
} from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startStableEdge, type StableEdgeOptions } from '../src/stable-edge'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

async function fixture(overrides: Partial<StableEdgeOptions> = {}) {
  const [clientTransport, hostTransport] = InMemoryTransport.createLinkedPair()
  const [edgeTransport, runtimeTransport] = InMemoryTransport.createLinkedPair()
  const runtime = new Server(
    { name: 'runtime', version: '9', title: 'Runtime title' },
    { capabilities: { tools: { listChanged: true } }, instructions: 'Original guidance.' }
  )
  let description = 'Original tool.'
  const list = vi.fn(() => ({
    tools: [
      {
        name: 'fixture',
        description,
        inputSchema: { type: 'object' as const },
        annotations: { readOnlyHint: true }
      }
    ]
  }))
  runtime.setRequestHandler(ListToolsRequestSchema, list)
  await runtime.connect(runtimeTransport)
  const error = vi.fn()
  const open = vi.fn(async () => edgeTransport)
  const binding = vi.fn()
  const edge = await startStableEdge(hostTransport, {
    version: '1',
    requestTimeoutMs: 5000,
    open,
    onError: error,
    onBinding: binding,
    ...overrides
  })
  const client = new Client({ name: 'host', version: '2' }, { capabilities: { roots: {} } })
  cleanup.push(async () => {
    await edge.close()
    await client.close()
    await runtime.close()
  })
  return {
    client,
    clientTransport,
    hostTransport,
    runtime,
    runtimeTransport,
    edgeTransport,
    edge,
    error,
    open,
    list,
    binding,
    changeDescription: (value: string) => (description = value),
    connect: () => client.connect(clientTransport)
  }
}

describe('stable MCP edge', () => {
  async function replacement(
    f: Awaited<ReturnType<typeof fixture>>,
    version = '10',
    instructions = 'Original guidance.'
  ) {
    const [transport, endpoint] = InMemoryTransport.createLinkedPair()
    const runtime = new Server(
      { name: 'runtime', version, title: 'Runtime title' },
      { capabilities: { tools: { listChanged: true } }, instructions }
    )
    runtime.setRequestHandler(ListToolsRequestSchema, () => f.list())
    runtime.fallbackRequestHandler = async () => ({ runtime: version })
    await runtime.connect(endpoint)
    cleanup.push(() => runtime.close())
    f.open.mockResolvedValue(transport)
    return runtime
  }

  it('switches two initialized clients without replacing frozen metadata or replaying requests', async () => {
    const register = vi.fn(async () => {})
    const clients = await Promise.all([fixture({ register }), fixture({ register })])
    for (const f of clients) {
      await f.connect()
      const catalog = await f.client.listTools()
      const runtime = await replacement(f)
      await f.edge.replaceBackend()
      expect(runtime.getClientVersion()).toEqual({ name: 'host', version: '2' })
      expect(await f.client.request({ method: 'fixture/version' }, ResultSchema)).toEqual({
        runtime: '10'
      })
      expect(await f.client.listTools()).toEqual(catalog)
      expect(f.client.getServerVersion()?.version).toBe('1')
      expect(f.client.getInstructions()).toBe('Original guidance.')
    }
    expect(register).toHaveBeenCalledTimes(4)
  })

  it('fails lost writes once, rejects calls during replacement, and preserves the session after a rejected candidate', async () => {
    const closed = vi.fn()
    const f = await fixture({ onBackendClose: closed })
    const written = vi.fn(
      async (_request, extra) =>
        new Promise<Record<string, unknown>>((resolve) =>
          extra.signal.addEventListener('abort', () => resolve({}))
        )
    )
    f.runtime.fallbackRequestHandler = written
    await expect(f.edge.replaceBackend()).rejects.toMatchObject({ data: { dispatched: false } })
    await f.connect()
    const pending = f.client.request({ method: 'fixture/write' }, ResultSchema)
    const lost = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(written).toHaveBeenCalledOnce())
    await f.runtime.close()
    await lost
    expect(closed).toHaveBeenCalledOnce()
    await expect(f.client.request({ method: 'fixture/write' }, ResultSchema)).rejects.toMatchObject(
      { data: { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false } }
    )
    expect(await f.client.ping()).toEqual({})
    const catalog = await f.client.listTools()
    await replacement(f, '10', 'Incompatible guidance.')
    await expect(f.edge.replaceBackend()).rejects.toThrow('MCP_RUNTIME_RESTART_REQUIRED')
    expect(await f.client.listTools()).toEqual(catalog)
    await replacement(f, '9')
    await f.edge.replaceBackend()
    expect(await f.client.request({ method: 'fixture/version' }, ResultSchema)).toEqual({
      runtime: '9'
    })
    expect(written).toHaveBeenCalledOnce()
  })

  it('freezes runtime guidance and catalog while identifying the edge version', async () => {
    const f = await fixture()
    await f.connect()
    expect(f.client.getServerVersion()).toEqual({
      name: 'runtime',
      title: 'Runtime title',
      version: '1'
    })
    expect(f.runtime.getClientVersion()).toEqual({ name: 'host', version: '2' })
    expect(f.runtime.getClientCapabilities()).toEqual({ roots: {} })
    expect(f.client.getInstructions()).toBe('Original guidance.')
    const catalog = await f.client.listTools()
    f.changeDescription('New guidance.')
    await f.runtime.notification({ method: 'notifications/tools/list_changed' })
    expect(await f.client.listTools()).toEqual(catalog)
    expect(f.list).toHaveBeenCalledTimes(1)
    await f.runtime.close()
    expect(await f.client.listTools()).toEqual(catalog)
    await expect(f.client.ping()).resolves.toEqual({})
  })

  it('preserves metadata, structured results, errors and progress in both directions', async () => {
    const f = await fixture()
    const received = vi.fn()
    f.runtime.fallbackRequestHandler = async (request, extra) => {
      received(request)
      if (request.method === 'fixture/error')
        throw new McpError(-32019, 'Rejected by runtime.', { reason: 'fixture', retryable: false })
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: request.params!._meta!.progressToken!, progress: 3, total: 5 }
      })
      return { structuredContent: { exact: ['a', 1] }, _meta: { generation: 7 }, content: [] }
    }
    const hostReceived = vi.fn(async () => ({ roots: [{ uri: 'file:///fixture' }] }))
    f.client.fallbackRequestHandler = hostReceived
    await f.connect()
    const progress = vi.fn()
    const result = await f.client.request(
      {
        method: 'fixture/result',
        params: { _meta: { 'codex/thread-id': 'thread', nested: { preserve: true } } }
      },
      ResultSchema,
      { onprogress: progress }
    )
    expect(result).toEqual({
      structuredContent: { exact: ['a', 1] },
      _meta: { generation: 7 },
      content: []
    })
    expect(received.mock.calls[0]![0].params._meta).toMatchObject({
      'codex/thread-id': 'thread',
      nested: { preserve: true }
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ progress: 3, total: 5 }))
    await expect(f.client.request({ method: 'fixture/error' }, ResultSchema)).rejects.toMatchObject(
      {
        code: -32019,
        data: { reason: 'fixture', retryable: false }
      }
    )
    expect(await f.runtime.request({ method: 'roots/list' }, ResultSchema)).toEqual({
      roots: [{ uri: 'file:///fixture' }]
    })
    expect(hostReceived).toHaveBeenCalledTimes(1)
  })

  it('cancels only the corresponding runtime request and never retries a lost write', async () => {
    const f = await fixture()
    const signals: AbortSignal[] = []
    const finish: (() => void)[] = []
    f.runtime.fallbackRequestHandler = async (_request, extra) => {
      signals.push(extra.signal)
      await new Promise<void>((resolve) => finish.push(resolve))
      return {}
    }
    await f.connect()
    const abort = new AbortController()
    const first = f.client.request({ method: 'fixture/write' }, ResultSchema, {
      signal: abort.signal
    })
    const second = f.client.request({ method: 'fixture/write' }, ResultSchema)
    const settled = Promise.allSettled([first, second])
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    abort.abort()
    await vi.waitFor(() => expect(signals[0]!.aborted).toBe(true))
    expect(signals[1]!.aborted).toBe(false)
    await f.runtimeTransport.close()
    expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(f.open).toHaveBeenCalledTimes(1)
    expect(signals).toHaveLength(2)
    for (const resolve of finish) resolve()
  })

  it('keeps private binding notifications away from the host and registers before tools', async () => {
    const order: string[] = []
    const f = await fixture({ register: async () => void order.push('register') })
    const list = f.list.getMockImplementation()!
    f.list.mockImplementation(() => {
      order.push('tools')
      return list()
    })
    const hostNotifications = vi.fn()
    f.client.fallbackNotificationHandler = hostNotifications
    await f.connect()
    await f.runtime.notification({
      method: 'notifications/tempad/client-binding',
      params: { kind: 'claude', sessionId: 'new-session' }
    })
    expect(order).toEqual(['register', 'tools'])
    expect(f.binding).toHaveBeenCalledWith({ kind: 'claude', sessionId: 'new-session' })
    expect(hostNotifications).not.toHaveBeenCalled()
  })

  it('freezes all catalog pages and rejects unknown or cyclic cursors', async () => {
    const f = await fixture()
    f.runtime.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
      params?.cursor ? { tools: [], _meta: { page: 2 } } : { tools: [], nextCursor: 'second' }
    )
    await f.connect()
    expect(await f.client.listTools()).toEqual({ tools: [], nextCursor: 'second' })
    expect(await f.client.listTools({ cursor: 'second' })).toEqual({
      tools: [],
      _meta: { page: 2 }
    })
    await expect(f.client.listTools({ cursor: 'unknown' })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams
    })
    const cycle = await fixture()
    cycle.runtime.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [],
      nextCursor: 'again'
    }))
    await expect(cycle.connect()).rejects.toThrow('cyclic or oversized')
    await cycle.edge.closed
  })

  it('returns an explicit initialization error when runtime negotiation fails', async () => {
    const f = await fixture({
      open: async () => {
        throw new McpError(-32001, 'MCP_RUNTIME_RESTART_REQUIRED: incompatible control protocol.', {
          supported: [1]
        })
      }
    })
    await expect(f.connect()).rejects.toMatchObject({
      code: -32001,
      data: { supported: [1] }
    })
    expect(f.list).not.toHaveBeenCalled()
    await f.edge.closed
  })

  it('closes a runtime that finishes opening after the host has already left', async () => {
    let opened: (transport: Transport) => void
    const f = await fixture({ open: () => new Promise((resolve) => (opened = resolve)) })
    const connecting = f.connect().catch(() => {})
    await vi.waitFor(() => expect(opened).toBeDefined())
    await f.clientTransport.close()
    const close = vi.spyOn(f.edgeTransport, 'close')
    opened!(f.edgeTransport)
    await connecting
    await vi.waitFor(() => expect(close).toHaveBeenCalled())
    await f.edge.closed
  })

  it('rejects pre-initialize calls without opening a runtime', async () => {
    const f = await fixture()
    const messages: JSONRPCMessage[] = []
    f.clientTransport.onmessage = (message) => messages.push(message)
    await f.clientTransport.send({ jsonrpc: '2.0', id: 0, method: 'tools/list' })
    expect(messages).toEqual([
      {
        jsonrpc: '2.0',
        id: 0,
        error: { code: ErrorCode.InvalidRequest, message: 'Initialize the MCP session first.' }
      }
    ])
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'overflow'] as const)(
    'releases pending initialization on %s',
    async (reason) => {
      let signal: AbortSignal | undefined
      const f = await fixture({
        open: (_request, lifetime) => {
          signal = lifetime
          return new Promise((_resolve, reject) =>
            lifetime.addEventListener('abort', () => reject(new Error('closed')), { once: true })
          )
        }
      })
      await f.clientTransport.send({
        jsonrpc: '2.0',
        id: 'initializing',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          clientInfo: { name: 'fixture', version: '1' },
          capabilities: {}
        }
      })
      expect(signal?.aborted).toBe(false)
      if (reason === 'cancel')
        await f.clientTransport.send({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 'initializing' }
        })
      else
        for (let i = 0; i < 65; i++)
          await f.clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      const failure = await f.edge.closed
      expect(signal?.aborted).toBe(true)
      expect(failure?.message).toBe(
        reason === 'overflow'
          ? 'Host initialization buffer exceeded the MCP buffer limit.'
          : undefined
      )
      expect(f.list).not.toHaveBeenCalled()
    }
  )
})
