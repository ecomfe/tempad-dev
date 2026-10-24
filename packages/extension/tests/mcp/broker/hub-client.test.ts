import {
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
  type RuntimeHelloMessage
} from '@tempad-dev/shared'
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
  socket.receive({
    type: 'registered',
    id: 'gateway-1',
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
  })
  socket.receive(stateMessage(activeId))
}

function createClient(
  sockets: FakeWebSocket[],
  events: ConstructorParameters<typeof McpHubClient>[0] = {},
  runtimeIdentity: RuntimeHelloMessage | null = null
): McpHubClient {
  return new McpHubClient(
    events,
    (url, protocol) => {
      expect(protocol).toBe(TEMPAD_MCP_BRIDGE_SUBPROTOCOL)
      const socket = new FakeWebSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    runtimeIdentity
  )
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
  it.each(['missing', 'release', 'foreign'] as const)(
    'never probes any port when checkout identity is %s',
    async (kind) => {
      vi.useFakeTimers()
      vi.stubGlobal('__TEMPAD_RUNTIME_PROFILE__', { kind: 'checkout', id: 'a'.repeat(16) })
      installHubProbe()
      const sockets: FakeWebSocket[] = []
      const client = createClient(
        sockets,
        {},
        kind === 'missing'
          ? null
          : {
              type: 'runtimeHello',
              protocolVersion: 15,
              extensionVersion: '1',
              extensionRuntimeFingerprint: 'a'.repeat(64),
              ...(kind === 'foreign'
                ? { runtimeProfile: { kind: 'checkout', id: 'b'.repeat(16) } }
                : {})
            }
      )
      client.start()
      await vi.advanceTimersByTimeAsync(10000)
      expect(fetch).not.toHaveBeenCalled()
      expect(sockets).toEqual([])
      expect(client.getSnapshot()).toMatchObject({
        status: 'error',
        errorMessage: expect.stringContaining('Rebuild and reload')
      })
      client.stop()
    }
  )

  it.each([false, true])(
    'uses checkout ports and verifies identity before state (receipts: %s)',
    async (receipts) => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', { OPEN: 1 })
      installHubProbe()
      const sockets: FakeWebSocket[] = []
      const hello: RuntimeHelloMessage = {
        type: 'runtimeHello',
        protocolVersion: 15,
        extensionVersion: '1',
        extensionRuntimeFingerprint: 'a'.repeat(64),
        runtimeProfile: { kind: 'checkout', id: 'a'.repeat(16) }
      }
      vi.stubGlobal('__TEMPAD_RUNTIME_PROFILE__', hello.runtimeProfile)
      const client = createClient(sockets, {}, hello)
      client.start()
      await flushMicrotasks()
      expect(sockets[0]?.url).toBe('ws://127.0.0.1:16220')
      sockets[0]!.open()
      sockets[0]!.receive({
        type: 'registered',
        id: 'other',
        protocolVersion: 15,
        runtimeProfile: { kind: 'checkout', id: 'b'.repeat(16) }
      })
      await flushMicrotasks()
      expect(sockets[0]!.readyState).toBe(3)
      expect(sockets[0]!.sent).toEqual([])
      const matched = sockets[1]!
      expect(matched.url).toBe('ws://127.0.0.1:17431')
      matched.open()
      matched.receive({
        type: 'registered',
        id: 'own',
        protocolVersion: 15,
        runtimeProfile: hello.runtimeProfile,
        ...(receipts ? { terminalReceiptGeneration: 'generation' } : {})
      })
      expect(matched.sent.map((value) => JSON.parse(value))).toEqual([
        { ...hello, ...(receipts ? { terminalReceipts: true } : {}) }
      ])
      matched.receive(stateMessage())
      await flushMicrotasks()
      expect(client.getSnapshot().status).toBe('connected')
      expect(matched.sent).toHaveLength(1)
      client.stop()
    }
  )

  it('closes a failed checkout hello and continues discovery', async () => {
    vi.useFakeTimers()
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const runtimeProfile = { kind: 'checkout' as const, id: 'a'.repeat(16) }
    vi.stubGlobal('__TEMPAD_RUNTIME_PROFILE__', runtimeProfile)
    const client = createClient(
      sockets,
      {},
      {
        type: 'runtimeHello',
        protocolVersion: 15,
        extensionVersion: '1',
        extensionRuntimeFingerprint: 'a'.repeat(64),
        runtimeProfile
      }
    )
    client.start()
    await flushMicrotasks()
    const failed = sockets[0]!
    failed.open()
    vi.spyOn(failed, 'send').mockImplementation(() => {
      throw new Error('Socket closed')
    })
    failed.receive({ type: 'registered', id: 'hub', protocolVersion: 15, runtimeProfile })
    await flushMicrotasks()
    expect(failed.readyState).toBe(3)
    expect(sockets[1]!.url).toBe('ws://127.0.0.1:17431')
    expect(client.getSnapshot().status).toBe('connecting')
    client.stop()
  })

  it('rejects checkout registration on a release discovery port', async () => {
    vi.useFakeTimers()
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)
    client.start()
    await flushMicrotasks()
    sockets[0]!.receive({
      type: 'registered',
      id: 'dev',
      protocolVersion: 15,
      runtimeProfile: { kind: 'checkout', id: 'a'.repeat(16) }
    })
    await flushMicrotasks()
    expect(sockets[0]!.readyState).toBe(3)
    expect(sockets[1]!.url).toBe('ws://127.0.0.1:7431')
    client.stop()
  })

  it('negotiates receipts only when offered and exposes rejected or throwing terminal sends', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const onToolCompletionAck = vi.fn()
    const onKeepalive = vi.fn()
    const hello: RuntimeHelloMessage = {
      type: 'runtimeHello',
      protocolVersion: 15,
      extensionVersion: '1',
      extensionRuntimeFingerprint: 'a'.repeat(64)
    }
    const client = createClient(sockets, { onToolCompletionAck, onKeepalive }, hello)
    const result = { id: 'call', type: 'toolResult' as const, payload: {} }
    const completion = {
      id: 'call',
      type: 'toolCompletion' as const,
      generation: 'hub',
      receiptId: 'receipt'
    }
    expect(client.sendToolResult(result)).toBe(false)
    client.start()
    await flushMicrotasks()
    const socket = sockets[0]!
    socket.open()
    socket.receive({
      type: 'registered',
      id: 'gateway',
      protocolVersion: 15,
      terminalReceiptGeneration: 'hub'
    })
    socket.receive(stateMessage())
    await flushMicrotasks()
    expect(JSON.parse(socket.sent[0]!)).toEqual({ ...hello, terminalReceipts: true })
    expect(client.sendToolResult(result)).toBe(true)
    expect(client.sendToolCompletion(completion)).toBe(true)
    expect(client.sendToolCompletion({ ...completion, generation: 'old-hub' })).toBe(false)
    socket.readyState = 2
    expect(client.sendToolResult(result)).toBe(false)
    expect(client.sendToolCompletion(completion)).toBe(false)
    socket.readyState = 1
    vi.spyOn(socket, 'send').mockImplementation(() => {
      throw new Error('Socket write failed')
    })
    expect(client.sendToolResult(result)).toBe(false)
    expect(client.sendToolCompletion(completion)).toBe(false)
    await vi.advanceTimersByTimeAsync(20000)
    expect(onKeepalive).toHaveBeenCalledOnce()
    const ack = { ...completion, type: 'toolCompletionAck', accepted: true }
    socket.receive(ack)
    expect(onToolCompletionAck).toHaveBeenCalledWith(ack)
    socket.closeFromRemote()
    expect(client.getSnapshot().terminalReceiptGeneration).toBe('hub')
    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    completeHandshake(sockets[1]!) // Released Hub: no capability offer.
    await flushMicrotasks()
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual(hello)
    expect(client.getSnapshot().terminalReceiptGeneration).toBeUndefined()
    client.stop()
  })
  it('aborts a reachable HTTP probe after headers while still opening its WebSocket', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    let signal: AbortSignal | undefined
    let body: ReadableStream<Uint8Array> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal!
        body = new ReadableStream<Uint8Array>({
          start(controller) {
            // Fetch leaves its streaming response tied to the request's signal.
            signal!.addEventListener('abort', () => controller.error(signal!.reason), {
              once: true
            })
          }
        })
        return new Response(body, { status: 426 })
      })
    )
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)
    try {
      client.start()
      await flushMicrotasks()
      expect(sockets[0]?.url).toBe('ws://127.0.0.1:6220')
      expect(signal?.aborted).toBe(true)
      const reader = body!.getReader()
      try {
        await expect(reader.read()).rejects.toBe(signal!.reason)
      } finally {
        reader.releaseLock()
      }
      completeHandshake(sockets[0]!)
      await flushMicrotasks()
      expect(client.getSnapshot().status).toBe('connected')
    } finally {
      client.stop()
    }
  })

  it('publishes extension runtime identity before declaring the handshake connected', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const runtimeIdentity = {
      type: 'runtimeHello' as const,
      protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
      extensionVersion: '0.21.0',
      extensionRuntimeFingerprint: 'a'.repeat(64)
    }
    const client = createClient(sockets, {}, runtimeIdentity)

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!)
    await flushMicrotasks()

    expect(sockets[0]?.sent.map((message) => JSON.parse(message))).toContainEqual(runtimeIdentity)
    expect(client.getSnapshot().status).toBe('connected')
  })

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

  it('does not install keepalive after a reentrant stop during handshake completion', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets, {
      onSnapshot: (snapshot) => {
        if (snapshot.status === 'connected') client.stop()
      }
    })

    client.start()
    await flushMicrotasks()
    completeHandshake(sockets[0]!)
    await flushMicrotasks()

    expect(client.getSnapshot().status).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
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
      JSON.stringify({
        type: 'registered',
        id: 'replacement',
        protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
      }),
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

  it('revokes a rejected socket immediately without waiting for its close handshake', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const onToolCall = vi.fn()
    const client = createClient(sockets, { onToolCall })
    try {
      client.start()
      await flushMicrotasks()
      const rejected = sockets[0]!
      completeHandshake(rejected, 'gateway-1')
      await flushMicrotasks()
      // Browser close() enters CLOSING before a later close event confirms teardown.
      vi.spyOn(rejected, 'close').mockImplementation(() => {
        rejected.readyState = 2
      })
      rejected.receiveRaw('{')

      expect(client.getSnapshot()).toMatchObject({
        activeId: null,
        assetServerUrl: null,
        registeredId: null,
        status: 'connecting',
        errorMessage: 'Received malformed message from MCP server'
      })
      await vi.advanceTimersByTimeAsync(3000)
      expect(sockets).toHaveLength(2)
      completeHandshake(sockets[1]!, 'gateway-1')
      await flushMicrotasks()
      rejected.receive({
        id: 'stale-call',
        payload: { args: {}, name: 'get_code' },
        type: 'toolCall'
      })
      rejected.closeFromRemote()
      expect(onToolCall).not.toHaveBeenCalled()
      expect(client.getSnapshot()).toMatchObject({ status: 'connected', errorMessage: null })
      expect(sockets[1]!.readyState).toBe(1)
    } finally {
      client.stop()
    }
  })

  it.each([
    ['malformed traffic', ['{']],
    [
      'duplicate registration',
      [
        JSON.stringify({
          type: 'registered',
          id: 'gateway-1',
          protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
        }),
        JSON.stringify({
          type: 'registered',
          id: 'gateway-2',
          protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
        })
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
        JSON.stringify({
          type: 'registered',
          id: 'gateway-1',
          protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
        }),
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

  it.each([
    ['missing', {}],
    ['released protocol 13', { protocolVersion: 13, supportedProtocolVersions: [13] }],
    ['different', { protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1 }],
    [
      'dropped',
      {
        protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 2,
        supportedProtocolVersions: [TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1]
      }
    ]
  ])('reports a %s bridge protocol after probing candidates', async (_case, announcement) => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    for (let index = 0; index < 3; index++) {
      sockets[index]?.open()
      sockets[index]?.receive({ type: 'registered', id: `gateway-${index}`, ...announcement })
      await flushMicrotasks()
    }

    expect(client.getSnapshot()).toMatchObject({
      errorMessage: expect.stringContaining('protocol mismatch'),
      status: 'error'
    })
    expect(client.getSnapshot().errorMessage).toContain(
      'Restart the agent and its TemPad Dev MCP connection using @tempad-dev/mcp@latest'
    )
    expect(sockets.every((socket) => socket.sent.length === 0)).toBe(true)
    client.stop()
  })

  it('recovers after an old Hub is replaced without sending new frames to it', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const identity: RuntimeHelloMessage = {
      type: 'runtimeHello',
      protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
      extensionVersion: '0.21.0',
      extensionRuntimeFingerprint: 'a'.repeat(64)
    }
    const client = createClient(sockets, {}, identity)
    client.start()
    await flushMicrotasks()
    for (let index = 0; index < 3; index++) {
      sockets[index]!.open()
      sockets[index]!.receive({ type: 'registered', id: 'old-hub' })
      await flushMicrotasks()
    }
    expect(client.getSnapshot().errorMessage).toContain('Reloading Figma alone does not update')
    expect(sockets.every((socket) => socket.readyState === 3 && socket.sent.length === 0)).toBe(
      true
    )
    await vi.advanceTimersByTimeAsync(3000)
    completeHandshake(sockets[3]!)
    await flushMicrotasks()
    expect(client.getSnapshot()).toMatchObject({ status: 'connected', errorMessage: null })
    expect(sockets[3]!.sent.map((message) => JSON.parse(message))).toEqual([identity])
    client.stop()
  })

  it('connects to a newer hub that still serves this extension protocol', async () => {
    // A Hub can ship ahead of store review; it stays usable while it announces this version.
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    installHubProbe()
    const sockets: FakeWebSocket[] = []
    const client = createClient(sockets)

    client.start()
    await flushMicrotasks()
    sockets[0]?.open()
    sockets[0]?.receive({
      type: 'registered',
      id: 'gateway-0',
      protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1,
      supportedProtocolVersions: [
        TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
        TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1
      ],
      announcedLater: 'ignored'
    })
    sockets[0]?.receive({
      type: 'state',
      activeId: 'gateway-0',
      assetServerUrl: 'http://127.0.0.1:6220'
    })
    await flushMicrotasks()

    expect(client.getSnapshot()).toMatchObject({ errorMessage: null, status: 'connected' })
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
