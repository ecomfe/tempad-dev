import type { BridgeToPageMessage, PageToBridgeMessage } from '@tempad-dev/shared'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_FIGMA_ORIGIN,
  TEMPAD_MCP_SESSION_PORT_NAME
} from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startMcpContentBridge } from '@/mcp/bridge/content'
import {
  MCP_LOCAL_HOST_PERMISSION_ERROR,
  MCP_PERMISSION_REQUEST_EVENT,
  createMcpPermissionMessage
} from '@/mcp/permissions'

type RuntimePort = ReturnType<typeof browser.runtime.connect>
type MessageListener = (payload: unknown) => void
type DisconnectListener = () => void
type WindowMessageListener = (event: MessageEvent<unknown>) => void
type EventListener = () => void

function createPort() {
  const messageListeners: MessageListener[] = []
  const disconnectListeners: DisconnectListener[] = []
  const port = {
    onDisconnect: {
      addListener: vi.fn((listener: DisconnectListener) => disconnectListeners.push(listener))
    },
    onMessage: {
      addListener: vi.fn((listener: MessageListener) => messageListeners.push(listener))
    },
    postMessage: vi.fn()
  } as unknown as RuntimePort

  return {
    disconnect: () => disconnectListeners.forEach((listener) => listener()),
    port,
    postMessage: port.postMessage as ReturnType<typeof vi.fn>,
    receive: (payload: unknown) => messageListeners.forEach((listener) => listener(payload))
  }
}

function installBrowser(
  ports: Array<ReturnType<typeof createPort>>,
  sendMessage = vi.fn().mockResolvedValue({ granted: true })
): ReturnType<typeof vi.fn> {
  vi.stubGlobal('browser', {
    runtime: {
      connect: vi.fn(({ name }: { name: string }) => {
        expect(name).toBe(TEMPAD_MCP_SESSION_PORT_NAME)
        const port = createPort()
        ports.push(port)
        return port.port
      }),
      sendMessage
    }
  })
  return sendMessage
}

function installWindow() {
  const messageListeners: WindowMessageListener[] = []
  const eventListeners = new Map<string, EventListener[]>()
  const windowMock = {
    addEventListener: vi.fn((type: string, listener: WindowMessageListener | EventListener) => {
      if (type === 'message') {
        messageListeners.push(listener as WindowMessageListener)
        return
      }
      eventListeners.set(type, [...(eventListeners.get(type) ?? []), listener as EventListener])
    }),
    postMessage: vi.fn()
  }
  vi.stubGlobal('window', windowMock)

  return {
    dispatchEvent: (type: string) => {
      for (const listener of eventListeners.get(type) ?? []) {
        listener()
      }
    },
    postMessage: windowMock.postMessage,
    sendPageMessage: (data: unknown, origin = TEMPAD_MCP_FIGMA_ORIGIN) => {
      const event = {
        data,
        origin,
        source: windowMock
      } as unknown as MessageEvent<unknown>
      messageListeners.forEach((listener) => listener(event))
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index++) {
    await Promise.resolve()
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function pageMessage(type: 'mcp.disable' | 'mcp.enable'): PageToBridgeMessage {
  return {
    sessionId: 'session-1',
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type,
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function stateMessage(): BridgeToPageMessage {
  return {
    payload: {
      activeSessionId: 'session-1',
      assetServerUrl: null,
      errorMessage: null,
      sessionCount: 1,
      sessionId: 'session-1',
      status: 'connected'
    },
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.state',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('mcp/bridge/content', () => {
  it('forwards page messages and replays the last enable after reconnect', async () => {
    vi.useFakeTimers()
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    installBrowser(ports)

    startMcpContentBridge()
    const enable = pageMessage('mcp.enable')
    windowMock.sendPageMessage(enable)
    await flushMicrotasks()

    expect(ports[0]?.postMessage).toHaveBeenCalledWith(enable)

    ports[0]?.disconnect()
    vi.advanceTimersByTime(1000)

    expect(ports).toHaveLength(2)
    expect(ports[1]?.postMessage).toHaveBeenCalledWith(enable)
  })

  it('clears replayed enable state after disable', async () => {
    vi.useFakeTimers()
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    installBrowser(ports)

    startMcpContentBridge()
    const enable = pageMessage('mcp.enable')
    const disable = pageMessage('mcp.disable')
    windowMock.sendPageMessage(enable)
    await flushMicrotasks()
    windowMock.sendPageMessage(disable)

    ports[0]?.disconnect()
    vi.advanceTimersByTime(1000)

    expect(ports).toHaveLength(1)
  })

  it('forwards valid broker messages back to the page', async () => {
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    installBrowser(ports)

    startMcpContentBridge()
    windowMock.sendPageMessage(pageMessage('mcp.enable'))
    await flushMicrotasks()
    const state = stateMessage()
    ports[0]?.receive(state)
    ports[0]?.receive({ type: 'unknown' })

    expect(windowMock.postMessage).toHaveBeenCalledTimes(1)
    expect(windowMock.postMessage).toHaveBeenCalledWith(state, TEMPAD_MCP_FIGMA_ORIGIN)
  })

  it('does not connect or reconnect while MCP is disabled', async () => {
    vi.useFakeTimers()
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    installBrowser(ports)

    startMcpContentBridge()

    expect(ports).toHaveLength(0)

    windowMock.sendPageMessage(pageMessage('mcp.disable'))
    await flushMicrotasks()
    expect(ports).toHaveLength(0)

    windowMock.sendPageMessage(pageMessage('mcp.enable'))
    await flushMicrotasks()
    windowMock.sendPageMessage(pageMessage('mcp.disable'))
    ports[0]?.disconnect()
    vi.advanceTimersByTime(1000)

    expect(ports).toHaveLength(1)
  })

  it('requests local host permission from the explicit page event before enabling', async () => {
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    const sendMessage = installBrowser(ports, vi.fn().mockResolvedValue({ granted: true }))

    startMcpContentBridge()
    windowMock.dispatchEvent(MCP_PERMISSION_REQUEST_EVENT)
    windowMock.sendPageMessage(pageMessage('mcp.enable'))
    await flushMicrotasks()

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      createMcpPermissionMessage('mcp.permissions.request')
    )
    expect(ports).toHaveLength(1)
  })

  it('does not prompt while auto-enabling and reports missing local host permission', async () => {
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    const sendMessage = installBrowser(ports, vi.fn().mockResolvedValue({ granted: false }))

    startMcpContentBridge()
    windowMock.sendPageMessage(pageMessage('mcp.enable'))
    await flushMicrotasks()

    expect(sendMessage).toHaveBeenCalledWith(createMcpPermissionMessage('mcp.permissions.contains'))
    expect(ports).toHaveLength(0)
    expect(windowMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          errorMessage: MCP_LOCAL_HOST_PERMISSION_ERROR,
          status: 'error'
        }),
        type: 'mcp.state'
      }),
      TEMPAD_MCP_FIGMA_ORIGIN
    )
  })

  it('does not connect when disabled before the permission request completes', async () => {
    const ports: Array<ReturnType<typeof createPort>> = []
    const windowMock = installWindow()
    const permission = createDeferred<{ granted: boolean }>()
    installBrowser(ports, vi.fn().mockReturnValue(permission.promise))

    startMcpContentBridge()
    windowMock.dispatchEvent(MCP_PERMISSION_REQUEST_EVENT)
    windowMock.sendPageMessage(pageMessage('mcp.enable'))
    windowMock.sendPageMessage(pageMessage('mcp.disable'))
    permission.resolve({ granted: true })
    await flushMicrotasks()

    expect(ports).toHaveLength(0)
  })
})
