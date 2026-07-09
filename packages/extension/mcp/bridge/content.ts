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
  let lastEnableMessage: EnableMessage | null = null
  let port: ReturnType<typeof browser.runtime.connect> | null = null
  let permissionRequest: Promise<boolean> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let sessionGeneration = 0

  function clearReconnectTimer(): void {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect(): void {
    if (!lastEnableMessage || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnect()
    }, RECONNECT_DELAY_MS)
  }

  function connect(): boolean {
    if (port) return true
    try {
      port = browser.runtime.connect({ name: TEMPAD_MCP_SESSION_PORT_NAME })
      clearReconnectTimer()
    } catch {
      scheduleReconnect()
      return false
    }

    port.onMessage.addListener((raw) => {
      const message = parseBridgeToPageMessage(raw)
      if (!message) return
      window.postMessage(message, TEMPAD_MCP_FIGMA_ORIGIN)
    })

    port.onDisconnect.addListener(() => {
      port = null
      scheduleReconnect()
    })

    return true
  }

  function reconnect(): void {
    if (connect()) replayEnableMessage()
  }

  function replayEnableMessage(): void {
    if (!port) return
    if (lastEnableMessage) {
      port.postMessage(lastEnableMessage)
    }
  }

  function cachePageMessage(message: PageToBridgeMessage): void {
    switch (message.type) {
      case 'mcp.enable':
        lastEnableMessage = message
        break
      case 'mcp.disable':
        sessionGeneration++
        lastEnableMessage = null
        clearReconnectTimer()
        break
    }
  }

  async function forwardToServiceWorker(raw: unknown): Promise<void> {
    const message = parsePageToBridgeMessage(raw)
    if (!message) return

    if (message.type === 'mcp.enable') {
      const generation = ++sessionGeneration
      if (!(await ensureLocalHostPermission())) {
        if (generation === sessionGeneration) {
          postMissingLocalHostPermission(message.sessionId)
        }
        return
      }
      if (generation !== sessionGeneration) return
    }

    cachePageMessage(message)
    if (message.type === 'mcp.disable' && !port) return
    if (!connect() || !port) return
    try {
      port.postMessage(message)
    } catch {
      port = null
      scheduleReconnect()
    }
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
    if (event.source !== window || event.origin !== TEMPAD_MCP_FIGMA_ORIGIN) {
      return
    }
    void forwardToServiceWorker(event.data)
  })

  window.addEventListener(MCP_PERMISSION_REQUEST_EVENT, () => {
    void requestLocalHostPermission()
  })
}
