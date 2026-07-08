import type { ToolCallMessage } from '@tempad-dev/shared'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_ERROR_CODES,
  TEMPAD_MCP_SESSION_PORT_NAME
} from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { McpBrokerHubClient } from '@/mcp/broker/service-worker'
import type { McpBrokerPort } from '@/mcp/broker/sessions'

import { McpServiceWorkerBroker } from '@/mcp/broker/service-worker'
import { type McpPermissionMessageType, MCP_LOCAL_HOST_ORIGINS } from '@/mcp/permissions'

type Listener<T> = (payload: T) => void
type BrokerInternals = {
  handlePermissionMessage: (type: McpPermissionMessageType) => Promise<{ granted: boolean }>
  routeToolCall: (message: ToolCallMessage) => void
}

function createHubClient(
  snapshot: Partial<ReturnType<McpBrokerHubClient['getSnapshot']>> = {}
): McpBrokerHubClient {
  return {
    getSnapshot: () => ({
      activeId: null,
      assetServerUrl: snapshot.assetServerUrl ?? null,
      errorMessage: null,
      registeredId: null,
      status: snapshot.status ?? 'idle'
    }),
    sendActivate: vi.fn(),
    sendToolResult: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  }
}

function createPort(url?: string) {
  const messageListeners: Array<Listener<unknown>> = []
  const disconnectListeners: Array<Listener<void>> = []
  const port = {
    disconnect: vi.fn(),
    name: TEMPAD_MCP_SESSION_PORT_NAME,
    onDisconnect: {
      addListener: vi.fn((listener: Listener<void>) => disconnectListeners.push(listener))
    },
    onMessage: {
      addListener: vi.fn((listener: Listener<unknown>) => messageListeners.push(listener))
    },
    postMessage: vi.fn(),
    sender: url ? { frameId: 0, tab: { id: 1, url }, url } : undefined
  } as unknown as McpBrokerPort

  return {
    disconnect: () => disconnectListeners.forEach((listener) => listener()),
    message: (payload: unknown) => messageListeners.forEach((listener) => listener(payload)),
    port,
    postMessage: port.postMessage as ReturnType<typeof vi.fn>
  }
}

function pageMessage(
  type: 'mcp.activateSession' | 'mcp.disable' | 'mcp.enable',
  sessionId = 'session-1'
) {
  return {
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type,
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function toolResult(callId: string, sessionId = 'session-1') {
  return {
    callId,
    payload: { ok: true },
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.toolResult',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function assetUpload(sessionId = 'session-1') {
  return {
    payload: {
      base64: 'AQID',
      hash: 'abcdef12',
      metadata: { height: 20, themeable: true, width: 10 },
      mimeType: 'image/png'
    },
    requestId: 'upload-1',
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.uploadAsset',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function routeToolCall(broker: McpServiceWorkerBroker, id = 'call-1'): void {
  const internals = broker as unknown as BrokerInternals
  internals.routeToolCall({
    id,
    payload: { args: { nodeId: '1:2' }, name: 'get_code' },
    type: 'toolCall'
  })
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mcp/broker/service-worker', () => {
  it('rejects session ports without a Figma sender URL', () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const { port } = createPort()

    broker.handlePort(port)

    expect(port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not let a replaced port disconnect unregister the current session', () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.enable'))

    const callsBeforeDisconnect = second.postMessage.mock.calls.length
    first.disconnect()
    second.message(pageMessage('mcp.activateSession'))

    expect(second.postMessage.mock.calls.length).toBeGreaterThan(callsBeforeDisconnect)
  })

  it('routes tool calls to the active session and forwards matching results', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    routeToolCall(broker)

    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        type: 'mcp.toolCall'
      })
    )

    session.message(toolResult('call-1'))

    expect(hubClient.sendToolResult).toHaveBeenCalledWith({
      error: undefined,
      id: 'call-1',
      payload: { ok: true },
      type: 'toolResult'
    })
  })

  it('ignores session control messages from ports that do not own the session', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.disable', 'session-a'))
    second.message(pageMessage('mcp.activateSession', 'session-a'))
    routeToolCall(broker)

    expect(first.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        type: 'mcp.toolCall'
      })
    )
    expect(hubClient.sendToolResult).not.toHaveBeenCalled()
  })

  it('prunes sessions that fail state delivery and rebroadcasts the current count', () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.enable', 'session-b'))
    first.postMessage.mockClear()
    second.postMessage.mockClear()
    first.postMessage.mockImplementation(() => {
      throw new Error('port closed')
    })

    second.message(pageMessage('mcp.activateSession', 'session-b'))

    expect(second.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          activeSessionId: 'session-b',
          sessionCount: 1
        }),
        type: 'mcp.state'
      })
    )
  })

  it('uploads assets through the hub asset server for the owning session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, statusText: 'Created' })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const broker = new McpServiceWorkerBroker(
      createHubClient({ assetServerUrl: 'http://127.0.0.1:9000' })
    )
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetUpload())
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9000/assets/abcdef12', {
      body: expect.any(Blob),
      headers: {
        'Content-Type': 'image/png',
        'X-Asset-Height': '20',
        'X-Asset-Themeable': 'true',
        'X-Asset-Width': '10'
      },
      method: 'POST'
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    await expect((init.body as Blob).arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer
    )
    expect(session.postMessage).toHaveBeenLastCalledWith({
      requestId: 'upload-1',
      sessionId: 'session-1',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetUploadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })
  })

  it('returns an asset upload error when the hub has no asset server URL', async () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetUpload())
    await flushMicrotasks()

    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: {
          code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
          message: 'Asset server URL is not configured.'
        },
        requestId: 'upload-1',
        type: 'mcp.assetUploadResult'
      })
    )
  })

  it('returns a coded error when no active session can receive a tool call', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)

    routeToolCall(broker)

    expect(hubClient.sendToolResult).toHaveBeenCalledWith({
      error: {
        code: TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
        message: 'No active TemPad Dev Figma session available.'
      },
      id: 'call-1',
      type: 'toolResult'
    })
  })

  it('checks and requests optional local host permissions', async () => {
    const contains = vi.fn().mockResolvedValue(false)
    const request = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('browser', {
      permissions: {
        contains,
        request
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient()) as unknown as BrokerInternals

    await expect(broker.handlePermissionMessage('mcp.permissions.contains')).resolves.toEqual({
      granted: false
    })
    await expect(broker.handlePermissionMessage('mcp.permissions.request')).resolves.toEqual({
      granted: true
    })

    expect(contains).toHaveBeenCalledWith({ origins: [MCP_LOCAL_HOST_ORIGINS[0]] })
    expect(contains).toHaveBeenCalledWith({ origins: [MCP_LOCAL_HOST_ORIGINS[1]] })
    expect(request).toHaveBeenCalledWith({ origins: [...MCP_LOCAL_HOST_ORIGINS] })
  })

  it('requests only missing optional local host permissions', async () => {
    const contains = vi.fn(({ origins }: { origins: string[] }) =>
      Promise.resolve(origins[0] === 'http://localhost/*')
    )
    const request = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('browser', {
      permissions: {
        contains,
        request
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient()) as unknown as BrokerInternals

    await expect(broker.handlePermissionMessage('mcp.permissions.request')).resolves.toEqual({
      granted: true
    })

    expect(request).toHaveBeenCalledWith({ origins: ['http://127.0.0.1/*'] })
  })
})
