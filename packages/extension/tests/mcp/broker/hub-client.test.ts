import { afterEach, describe, expect, it, vi } from 'vitest'

import { McpHubClient } from '@/mcp/broker/hub-client'

class FakeWebSocket extends EventTarget {
  readyState = 0
  sent: string[] = []

  constructor(readonly url: string) {
    super()
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchClose(true)
  }

  fail(message?: string): void {
    const event = new Event('error')
    if (message) Object.defineProperty(event, 'message', { value: message })
    this.dispatchEvent(event)
  }

  closeFromRemote(wasClean = false): void {
    this.readyState = 3
    this.dispatchClose(wasClean)
  }

  open(): void {
    if (this.readyState === 3) return
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(payload: unknown): void {
    this.receiveRaw(JSON.stringify(payload))
  }

  receiveRaw(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  send(payload: string): void {
    this.sent.push(payload)
  }

  private dispatchClose(wasClean: boolean): void {
    const event = new Event('close')
    Object.defineProperty(event, 'wasClean', { value: wasClean })
    this.dispatchEvent(event)
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index++) {
    await Promise.resolve()
  }
}

function stateMessage(activeId: string | null = null) {
  return {
    activeId,
    assetServerUrl: 'http://127.0.0.1:9000',
    type: 'state'
  }
}

function completeHandshake(socket: FakeWebSocket, activeId: string | null = null): void {
  socket.open()
  socket.receive({ type: 'registered', id: 'gateway-1' })
  socket.receive(stateMessage(activeId))
}

function createClient(
  sockets: FakeWebSocket[],
  events: ConstructorParameters<typeof McpHubClient>[0] = {}
): McpHubClient {
  return new McpHubClient(events, (url) => {
    const socket = new FakeWebSocket(url)
    sockets.push(socket)
    return socket as unknown as WebSocket
  })
}

function installHubProbe(isReachable: (port: number) => boolean = () => true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const port = Number(new URL(url).port)
      return isReachable(port)
        ? Promise.resolve({ status: 426 } as Response)
        : Promise.reject(new TypeError('fetch failed'))
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('mcp/broker/hub-client', () => {
  it('tries candidate ports in order and reuses the last successful port first', async () => {
    const sockets: FakeWebSocket[] = []
    const snapshots: Array<ReturnType<McpHubClient['getSnapshot']>> = []
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()

    const client = createClient(sockets, {
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    client.start()
    await flushMicrotasks()
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:6220')

    sockets[0]?.fail()
    await flushMicrotasks()

    expect(sockets[1]?.url).toBe('ws://127.0.0.1:7431')

    completeHandshake(sockets[1]!)
    await flushMicrotasks()

    expect(client.getSnapshot()).toMatchObject({ status: 'connected' })

    client.stop()
    await flushMicrotasks()
    client.start()
    await flushMicrotasks()

    expect(sockets[2]?.url).toBe('ws://127.0.0.1:7431')
    expect(snapshots.at(-1)?.status).toBe('connecting')
  })

  it('sends keepalive ping while the socket is open', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!)
    await flushMicrotasks()
    vi.advanceTimersByTime(20_000)

    expect(sockets[0]?.sent).toContain(JSON.stringify({ type: 'ping' }))
  })

  it('ignores stale socket probes after a stop/start cycle', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!)
    client.stop()
    client.start()
    await flushMicrotasks()

    expect(sockets[0]?.readyState).toBe(3)
    expect(client.getSnapshot().status).toBe('connecting')

    completeHandshake(sockets[1]!)
    await flushMicrotasks()

    expect(client.getSnapshot().status).toBe('connected')
  })

  it('retries after every candidate is unreachable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe(() => false)
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(client.getSnapshot()).toMatchObject({
      errorMessage: expect.stringContaining('MCP server is not running'),
      status: 'error'
    })

    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(fetch).toHaveBeenCalledTimes(6)
    client.stop()
  })

  it.each([
    ['malformed traffic', '{', 'Received malformed message from MCP server'],
    [
      'duplicate registration',
      JSON.stringify({ type: 'registered', id: 'replacement' }),
      'Received duplicate registration from MCP server'
    ],
    [
      'a non-loopback state update',
      JSON.stringify({
        activeId: 'gateway-1',
        assetServerUrl: 'https://collector.example/assets',
        type: 'state'
      }),
      'MCP server advertised a non-loopback asset URL'
    ],
    [
      'a changed loopback asset endpoint',
      JSON.stringify({
        activeId: 'gateway-1',
        assetServerUrl: 'http://127.0.0.1:9001/replacement',
        type: 'state'
      }),
      'MCP server changed its asset server URL'
    ]
  ])('closes and reconnects after %s on an established connection', async (_name, raw, error) => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const snapshots: Array<ReturnType<McpHubClient['getSnapshot']>> = []
    const client = createClient(sockets, {
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!, 'gateway-1')
    await flushMicrotasks()
    sockets[0]?.receiveRaw(raw)

    expect(sockets[0]?.readyState).toBe(3)
    expect(snapshots).toContainEqual(expect.objectContaining({ errorMessage: error }))
    expect(client.getSnapshot()).toMatchObject({
      activeId: null,
      assetServerUrl: null,
      registeredId: null,
      status: 'connecting'
    })

    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(sockets[1]?.url).toBe('ws://127.0.0.1:6220')
    client.stop()
  })

  it('sends activation/results only while connected and reports live socket errors', async () => {
    class TestErrorEvent extends Event {
      constructor(
        type: string,
        readonly message: string
      ) {
        super(type)
      }
    }
    vi.stubGlobal('ErrorEvent', TestErrorEvent)
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const snapshots: Array<ReturnType<McpHubClient['getSnapshot']>> = []
    const client = createClient(sockets, {
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    client.sendActivate()
    client.sendToolResult({ id: 'before-connect', payload: {}, type: 'toolResult' })
    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!)
    await flushMicrotasks()
    client.sendActivate()
    client.sendToolResult({ id: 'call-1', payload: { ok: true }, type: 'toolResult' })
    sockets[0]?.dispatchEvent(new TestErrorEvent('error', 'socket failed'))

    expect(sockets[0]?.sent).toEqual([
      JSON.stringify({ type: 'activate' }),
      JSON.stringify({ id: 'call-1', payload: { ok: true }, type: 'toolResult' })
    ])
    expect(snapshots.at(-1)?.errorMessage).toBe('socket failed')
    client.stop()
  })

  it.each([
    ['malformed traffic', ['{']],
    [
      'duplicate registration',
      [
        JSON.stringify({ type: 'registered', id: 'gateway-1' }),
        JSON.stringify({ type: 'registered', id: 'gateway-2' })
      ]
    ],
    ['duplicate state', [JSON.stringify(stateMessage()), JSON.stringify(stateMessage())]],
    [
      'tool traffic',
      [JSON.stringify({ id: 'call-1', payload: { args: {}, name: 'get_code' }, type: 'toolCall' })]
    ],
    [
      'a non-loopback asset URL',
      [
        JSON.stringify({ type: 'registered', id: 'gateway-1' }),
        JSON.stringify({
          activeId: null,
          assetServerUrl: 'https://collector.example/assets',
          type: 'state'
        })
      ]
    ]
  ])('rejects %s during the handshake and continues probing', async (_name, messages) => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    sockets[0]?.open()
    messages.forEach((message) => sockets[0]?.receiveRaw(message))
    await flushMicrotasks()

    expect(sockets[0]?.readyState).toBe(3)
    expect(sockets[1]?.url).toBe('ws://127.0.0.1:7431')
    expect(client.getSnapshot().assetServerUrl).toBeNull()
    client.stop()
  })

  it('ignores stale events from a replaced socket', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!)
    await flushMicrotasks()
    client.stop()
    await flushMicrotasks()
    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[1]!)
    await flushMicrotasks()

    sockets[0]?.closeFromRemote()

    expect(client.getSnapshot().status).toBe('connected')
    expect(sockets[1]?.readyState).toBe(1)
  })

  it('parses hub registration, state, and tool calls', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const toolCall = vi.fn()
    const client = createClient(sockets, { onToolCall: toolCall })

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!, 'gateway-1')
    await flushMicrotasks()
    sockets[0]?.receive({
      id: 'call-1',
      payload: { args: { nodeId: '1:2' }, name: 'get_code' },
      type: 'toolCall'
    })

    expect(client.getSnapshot()).toMatchObject({
      activeId: 'gateway-1',
      assetServerUrl: 'http://127.0.0.1:9000',
      registeredId: 'gateway-1',
      status: 'connected'
    })
    expect(toolCall).toHaveBeenCalledWith({
      id: 'call-1',
      payload: { args: { nodeId: '1:2' }, name: 'get_code' },
      type: 'toolCall'
    })
  })

  it('skips WebSocket construction for unreachable candidate ports', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    const sockets: FakeWebSocket[] = []
    const probedPorts: number[] = []
    installHubProbe((port) => {
      probedPorts.push(port)
      return port === 8127
    })
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()

    expect(probedPorts).toEqual([6220, 7431, 8127])
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:8127')
    client.stop()
  })

  it('continues to the next candidate when a reachable WebSocket does not speak Tempad', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    sockets[0]?.open()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(sockets[0]?.readyState).toBe(3)
    expect(sockets[1]?.url).toBe('ws://127.0.0.1:7431')
    client.stop()
  })

  it('ignores stale probe failures after stop', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    let rejectProbe: ((reason?: unknown) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectProbe = reject
          })
      )
    )
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    client.stop()
    rejectProbe?.(new TypeError('fetch failed'))
    await flushMicrotasks()

    expect(client.getSnapshot()).toMatchObject({ errorMessage: null, status: 'idle' })
    expect(sockets).toHaveLength(0)
  })
})
