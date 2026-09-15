import type { PageToBridgeMessage } from '@tempad-dev/shared'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_FIGMA_ORIGIN,
  TEMPAD_MCP_SESSION_PORT_NAME,
  parseBridgeToPageMessage,
  parsePageToBridgeMessage
} from '@tempad-dev/shared'

import {
  MCP_LOCAL_HOST_PERMISSION_ERROR,
  MCP_PERMISSION_REQUEST_EVENT,
  type McpPermissionMessageType,
  createMcpPermissionMessage,
  isMcpPermissionResponse
} from '../permissions'

const RECONNECT_DELAY_MS = 1000
type EnableMessage = Extract<PageToBridgeMessage, { type: 'mcp.enable' }>

export function startMcpContentBridge(): void {
  let enableMessage: EnableMessage | null = null
  let enableReady: Promise<void> | null = null
  let port: ReturnType<typeof browser.runtime.connect> | null = null
  let permissionGranted = false
  let permissionRequest: Promise<boolean> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function clearReconnectTimer(): void {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect(): void {
    if (!enableMessage || !permissionGranted || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (enableMessage) postToServiceWorker(enableMessage)
    }, RECONNECT_DELAY_MS)
  }

  function connect(): boolean {
    if (port) return true
    let nextPort: ReturnType<typeof browser.runtime.connect>
    try {
      nextPort = browser.runtime.connect({ name: TEMPAD_MCP_SESSION_PORT_NAME })
      port = nextPort
      clearReconnectTimer()
    } catch {
      scheduleReconnect()
      return false
    }

    nextPort.onMessage.addListener((raw) => {
      const message = parseBridgeToPageMessage(raw)
      if (!message) return
      window.postMessage(message, TEMPAD_MCP_FIGMA_ORIGIN)
    })

    nextPort.onDisconnect.addListener(() => {
      if (port !== nextPort) return
      port = null
      scheduleReconnect()
    })

    return true
  }

  function postToServiceWorker(message: PageToBridgeMessage): boolean {
    if (message.type !== 'mcp.disable' && !permissionGranted) return false
    const connected = !!port
    if (!connect() || !port) return false
    try {
      // A request can arrive before the scheduled reconnect re-registers this tab.
      if (!connected && message.type !== 'mcp.enable' && enableMessage)
        port.postMessage(enableMessage)
      port.postMessage(message)
      return true
    } catch {
      port = null
      scheduleReconnect()
      return false
    }
  }

  async function enable(message: EnableMessage): Promise<void> {
    const granted = await ensureLocalHostPermission()
    if (enableMessage !== message) return
    if (!granted) {
      postMissingLocalHostPermission(message.sessionId)
      return
    }
    permissionGranted = true
    postToServiceWorker(message)
  }

  async function forwardToServiceWorker(raw: unknown): Promise<void> {
    const message = parsePageToBridgeMessage(raw)
    if (!message) return

    if (message.type === 'mcp.enable') {
      enableMessage = message
      permissionGranted = false
      enableReady = enable(message)
      return enableReady
    } else {
      if (enableMessage?.sessionId !== message.sessionId) return
      if (message.type === 'mcp.feedbackDrafts') {
        const currentEnable = enableMessage
        // Restored task UI can request drafts while the initial permission check is pending.
        await enableReady
        if (enableMessage !== currentEnable || !postToServiceWorker(message)) {
          window.postMessage(
            {
              source: TEMPAD_MCP_BROWSER_SOURCE,
              version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
              type: 'mcp.feedbackDraftsResult',
              sessionId: message.sessionId,
              requestId: message.requestId,
              error: { message: 'Comments unavailable.' }
            },
            TEMPAD_MCP_FIGMA_ORIGIN
          )
        }
        return
      }
      if (message.type === 'mcp.sessionInfo') {
        enableMessage.document = message.document
      }
      if (message.type === 'mcp.disable') {
        enableMessage = null
        permissionGranted = false
        clearReconnectTimer()
      }
    }

    if (message.type === 'mcp.disable' && !port) return
    postToServiceWorker(message)
  }

  function requestLocalHostPermission(): Promise<boolean> {
    if (!permissionRequest) {
      permissionRequest = sendPermissionMessage('mcp.permissions.request').finally(() => {
        permissionRequest = null
      })
    }
    return permissionRequest
  }

  function ensureLocalHostPermission(): Promise<boolean> {
    return permissionRequest ?? sendPermissionMessage('mcp.permissions.contains')
  }

  async function sendPermissionMessage(type: McpPermissionMessageType): Promise<boolean> {
    try {
      const response = await browser.runtime.sendMessage(createMcpPermissionMessage(type))
      return isMcpPermissionResponse(response) && response.granted
    } catch {
      return false
    }
  }

  function postMissingLocalHostPermission(sessionId: string): void {
    window.postMessage(
      {
        payload: {
          activeSessionId: null,
          errorMessage: MCP_LOCAL_HOST_PERMISSION_ERROR,
          sessionCount: 0,
          sessionId,
          status: 'connecting'
        },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.state',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      },
      TEMPAD_MCP_FIGMA_ORIGIN
    )
  }

  window.addEventListener('message', (event) => {
    // The MCP runtime uses Figma's page-world API, so the exact Figma origin is
    // intentionally the trust boundary. The broker still validates port/session ownership.
    if (event.source !== window || event.origin !== TEMPAD_MCP_FIGMA_ORIGIN) {
      return
    }
    void forwardToServiceWorker(event.data)
  })

  window.addEventListener(MCP_PERMISSION_REQUEST_EVENT, () => {
    void requestLocalHostPermission()
  })
}
