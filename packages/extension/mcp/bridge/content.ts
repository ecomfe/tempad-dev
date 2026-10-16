import type { DesignTask, PageToBridgeMessage } from '@tempad-dev/shared'

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
  MCP_PERMISSION_CHANGE_MESSAGE,
  MCP_PERMISSION_REQUEST_EVENT,
  type McpPermissionMessageType,
  createMcpPermissionMessage,
  isMcpPermissionResponse
} from '../permissions'

const RECONNECT_DELAY_MS = 1000
type EnableMessage = Extract<PageToBridgeMessage, { type: 'mcp.enable' }>

export function startMcpContentBridge(): () => void {
  let invalidated = false
  let enableMessage: EnableMessage | null = null
  let latestTask: DesignTask | undefined
  let enableReady: Promise<void> | null = null
  let enableRevision = 0
  let port: ReturnType<typeof browser.runtime.connect> | null = null
  let permissionGranted = false
  let permissionRequest: Promise<boolean> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function clearReconnectTimer(): void {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function rememberTask(task: DesignTask): void {
    if (!enableMessage || task.target.fileKey !== enableMessage.document?.fileKey) return
    const previous = latestTask?.taskId === task.taskId ? latestTask : undefined
    latestTask = {
      ...task,
      ...(previous?.status === 'cancelled' ? { status: 'cancelled', operation: null } : {}),
      ...(previous?.reviewClosed ? { reviewClosed: true } : {})
    }
    // Another tab's live review cannot become this page's claim. Stop and Done
    // fences, however, must survive worker loss from any tab showing this file.
    if (
      task.target.sessionId === enableMessage.sessionId ||
      enableMessage.reviewTask?.taskId === task.taskId ||
      latestTask.status === 'cancelled' ||
      latestTask.reviewClosed
    )
      enableMessage.reviewTask = latestTask
    else delete enableMessage.reviewTask
  }

  function scheduleReconnect(): void {
    if (invalidated || !enableMessage || !permissionGranted || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (enableMessage) postToServiceWorker(enableMessage)
    }, RECONNECT_DELAY_MS)
  }

  function connect(): boolean {
    if (invalidated || invalidateIfNeeded()) return false
    if (port) return true
    let nextPort: ReturnType<typeof browser.runtime.connect>
    try {
      nextPort = browser.runtime.connect({ name: TEMPAD_MCP_SESSION_PORT_NAME })
      port = nextPort
      clearReconnectTimer()
    } catch (error) {
      if (!invalidateIfNeeded(error)) scheduleReconnect()
      return false
    }

    nextPort.onMessage.addListener((raw) => {
      if (invalidated || port !== nextPort) return
      const message = parseBridgeToPageMessage(raw)
      if (!message) return
      if (message.type === 'mcp.designTaskState') rememberTask(message.task)
      if (
        message.type === 'mcp.designReviewClosed' &&
        message.taskId === latestTask?.taskId &&
        message.fileKey === latestTask.target.fileKey
      )
        rememberTask({ ...latestTask, reviewClosed: true })
      window.postMessage(message, TEMPAD_MCP_FIGMA_ORIGIN)
    })

    nextPort.onDisconnect.addListener(() => {
      if (port !== nextPort) return
      port = null
      if (invalidateIfNeeded()) return
      if (enableMessage) postDisconnected('Agent disconnected. Reconnecting…')
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
    } catch (error) {
      if (!invalidateIfNeeded(error)) {
        port = null
        scheduleReconnect()
      }
      return false
    }
  }

  async function enable(message: EnableMessage): Promise<void> {
    const revision = ++enableRevision
    const granted = await ensureLocalHostPermission()
    if (invalidated || enableMessage !== message || revision !== enableRevision) return
    if (!granted) {
      postMissingLocalHostPermission(message.sessionId)
      return
    }
    permissionGranted = true
    postToServiceWorker(message)
  }

  async function forwardToServiceWorker(raw: unknown): Promise<void> {
    if (invalidated) return
    const message = parsePageToBridgeMessage(raw)
    if (!message) return

    if (message.type === 'mcp.enable') {
      if (
        enableMessage?.sessionId !== message.sessionId ||
        enableMessage.document?.fileKey !== message.document?.fileKey
      )
        latestTask = undefined
      enableMessage = message
      const review = message.reviewTask ?? latestTask
      if (review) rememberTask(review)
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
        if (enableMessage.document?.fileKey !== message.document.fileKey) {
          latestTask = undefined
          delete enableMessage.reviewTask
        }
        enableMessage.document = message.document
      }
      if (
        message.type === 'mcp.designAction' &&
        message.action.action === 'stop' &&
        message.action.taskId === latestTask?.taskId
      )
        // Cache before reconnect can replay enable or failed storage can lose Stop.
        rememberTask({ ...latestTask, status: 'cancelled', operation: null })
      if (message.type === 'mcp.disable') {
        enableMessage = null
        latestTask = undefined
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
    } catch (error) {
      invalidateIfNeeded(error)
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

  function handlePageMessage(event: MessageEvent<unknown>): void {
    // The MCP runtime uses Figma's page-world API, so the exact Figma origin is
    // intentionally the trust boundary. The broker still validates port/session ownership.
    if (event.source !== window || event.origin !== TEMPAD_MCP_FIGMA_ORIGIN) {
      return
    }
    void forwardToServiceWorker(event.data).catch(() => {
      postDisconnected('The extension connection is unavailable. Reload this Figma tab.')
    })
  }

  function handlePermissionRequest(): void {
    void requestLocalHostPermission()
  }

  const runtimeMessages = browser.runtime.onMessage
  const handlePermissionChange: Parameters<typeof runtimeMessages.addListener>[0] = (
    message,
    sender
  ) => {
    if (
      invalidated ||
      !enableMessage ||
      permissionGranted ||
      sender.id !== browser.runtime?.id ||
      message?.source !== MCP_PERMISSION_CHANGE_MESSAGE.source ||
      message?.type !== MCP_PERMISSION_CHANGE_MESSAGE.type
    )
      return
    enableReady = enable(enableMessage)
  }

  window.addEventListener('message', handlePageMessage)
  window.addEventListener(MCP_PERMISSION_REQUEST_EVENT, handlePermissionRequest)
  runtimeMessages.addListener(handlePermissionChange)

  function postDisconnected(message: string): void {
    if (!enableMessage) return
    window.postMessage(
      {
        payload: {
          activeSessionId: null,
          errorMessage: message,
          sessionCount: 0,
          sessionId: enableMessage.sessionId,
          status: 'connecting'
        },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.state',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      },
      TEMPAD_MCP_FIGMA_ORIGIN
    )
  }

  function invalidateIfNeeded(error?: unknown): boolean {
    if (
      !browser.runtime?.id ||
      (error instanceof Error && error.message.includes('Extension context invalidated'))
    ) {
      invalidate()
      return true
    }
    return false
  }

  function invalidate(): void {
    if (invalidated) return
    invalidated = true
    clearReconnectTimer()
    window.removeEventListener('message', handlePageMessage)
    window.removeEventListener(MCP_PERMISSION_REQUEST_EVENT, handlePermissionRequest)
    const previousPort = port
    port = null
    try {
      runtimeMessages.removeListener(handlePermissionChange)
    } catch {
      // A stale listener must not prevent disconnecting its port.
    }
    try {
      previousPort?.disconnect()
    } catch {
      // Invalidated contexts may reject disconnect as well as messaging.
    }
    postDisconnected('TemPad Dev was updated. Reload this Figma tab to reconnect.')
  }

  return invalidate
}
