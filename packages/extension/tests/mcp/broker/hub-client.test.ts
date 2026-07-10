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
    this.dispatchEvent(new Event('close'))
  }

  fail(): void {
    this.dispatchEvent(new Event('error'))
  }

  closeFromRemote(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open(): void {
    if (this.readyState === 3) return
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(payload: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  send(payload: string): void {
    this.sent.push(payload)
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
    client.stop()
    client.start()
    await flushMicrotasks()

    sockets[0]?.open()
    await flushMicrotasks()

    expect(sockets[0]?.readyState).toBe(3)
    expect(client.getSnapshot().status).toBe('connecting')

    completeHandshake(sockets[1]!)
    await flushMicrotasks()

    expect(client.getSnapshot().status).toBe('connected')
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
