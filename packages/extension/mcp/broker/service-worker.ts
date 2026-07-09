import type {
  BridgeToPageMessage,
  McpBrowserStatePayload,
  PageToBridgeMessage,
  TempadMcpErrorCode,
  ToolCallMessage
} from '@tempad-dev/shared'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_ERROR_CODES,
  TEMPAD_MCP_FIGMA_ORIGIN,
  TEMPAD_MCP_SESSION_PORT_NAME,
  parsePageToBridgeMessage
} from '@tempad-dev/shared'

import type { McpBrokerPort } from './sessions'

import {
  MCP_LOCAL_HOST_ORIGINS,
  type McpPermissionMessageType,
  type McpPermissionResponse,
  isMcpPermissionMessage
} from '../permissions'
import { type HubConnectionStatus, McpHubClient } from './hub-client'
import { McpSessionRegistry } from './sessions'

type AssetUploadMessage = Extract<PageToBridgeMessage, { type: 'mcp.uploadAsset' }>

function toPermissionError(error: unknown): McpPermissionResponse {
  return {
    errorMessage: error instanceof Error ? error.message : 'Failed to resolve MCP permission.',
    granted: false
  }
}

export type McpBrokerHubClient = Pick<
  McpHubClient,
  'getSnapshot' | 'sendActivate' | 'sendToolResult' | 'start' | 'stop'
>

export class McpServiceWorkerBroker {
  private readonly hubClient: McpBrokerHubClient
  private readonly pendingToolCalls = new Map<string, string>()
  private readonly portSessions = new WeakMap<McpBrokerPort, string>()
  private readonly sessions = new McpSessionRegistry()

  constructor(hubClient?: McpBrokerHubClient) {
    this.hubClient =
      hubClient ??
      new McpHubClient({
        onSnapshot: () => this.handleHubSnapshot(),
        onToolCall: (message) => this.routeToolCall(message)
      })
  }

  start(): void {
    browser.runtime.onConnect.addListener((port) => this.handlePort(port))
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isMcpPermissionMessage(message)) return
      // Chromium discards a promise returned from onMessage; only a literal `true`
      // keeps the channel open until sendResponse runs.
      void this.handlePermissionMessage(message.type).then(sendResponse)
      return true
    })
  }

  handlePort(port: McpBrokerPort): void {
    if (port.name !== TEMPAD_MCP_SESSION_PORT_NAME) return
    if (!this.isAllowedSender(port)) {
      port.disconnect()
      return
    }

    port.onMessage.addListener((raw) => this.handlePortMessage(port, raw))
    port.onDisconnect.addListener(() => this.handlePortDisconnect(port))
  }

  private isAllowedSender(port: McpBrokerPort): boolean {
    const senderUrl = port.sender?.url ?? port.sender?.tab?.url
    if (!senderUrl) return false
    try {
      return new URL(senderUrl).origin === TEMPAD_MCP_FIGMA_ORIGIN
    } catch {
      return false
    }
  }

  private handlePortMessage(port: McpBrokerPort, raw: unknown): void {
    const message = parsePageToBridgeMessage(raw)
    if (!message) return

    switch (message.type) {
      case 'mcp.enable':
        this.enableSession(port, message)
        break
      case 'mcp.disable':
        this.disableSession(port, message.sessionId)
        break
      case 'mcp.activateSession':
        this.activateSession(port, message.sessionId)
        break
      case 'mcp.toolResult':
        this.forwardToolResult(message)
        break
      case 'mcp.uploadAsset':
        void this.uploadAsset(port, message)
        break
    }
  }

  private handlePermissionMessage(type: McpPermissionMessageType): Promise<McpPermissionResponse> {
    if (type === 'mcp.permissions.request') {
      return this.requestLocalHostPermissions()
    }
    return this.containsLocalHostPermissions()
  }

  private requestLocalHostPermissions(): Promise<McpPermissionResponse> {
    // The sender's user activation only survives the synchronous part of the
    // listener, so request() cannot wait on a contains() check first. Re-requesting
    // an already granted origin is a no-op.
    try {
      const requested = browser.permissions.request({ origins: [...MCP_LOCAL_HOST_ORIGINS] })
      return Promise.resolve(requested).then((granted) => ({ granted }), toPermissionError)
    } catch (error) {
      return Promise.resolve(toPermissionError(error))
    }
  }

  private async containsLocalHostPermissions(): Promise<McpPermissionResponse> {
    try {
      for (const origin of MCP_LOCAL_HOST_ORIGINS) {
        if (!(await browser.permissions.contains({ origins: [origin] }))) {
          return { granted: false }
        }
      }
      return { granted: true }
    } catch (error) {
      return toPermissionError(error)
    }
  }

  private enableSession(
    port: McpBrokerPort,
    message: Extract<PageToBridgeMessage, { type: 'mcp.enable' }>
  ): void {
    const existingSessionId = this.portSessions.get(port)
    if (existingSessionId && existingSessionId !== message.sessionId) {
      this.unregisterSession(
        existingSessionId,
        'Figma session was replaced before providing a result.'
      )
    }
    const existingSession = this.sessions.get(message.sessionId)
    if (existingSession && existingSession.port !== port) {
      this.portSessions.delete(existingSession.port)
    }

    this.portSessions.set(port, message.sessionId)
    this.sessions.register({
      port,
      sessionId: message.sessionId
    })

    this.hubClient.start()
    this.ensureHubActive()
    this.broadcastState()
  }

  private disableSession(port: McpBrokerPort, sessionId: string): void {
    const mappedSessionId = this.portSessions.get(port)
    if (mappedSessionId !== sessionId) return
    this.unregisterSession(sessionId, 'Figma session disconnected before providing a result.')
    this.stopHubIfIdle()
    this.broadcastState()
  }

  private activateSession(port: McpBrokerPort, sessionId: string): void {
    if (this.portSessions.get(port) !== sessionId) return
    if (!this.sessions.activate(sessionId)) return
    this.hubClient.start()
    this.ensureHubActive()
    this.broadcastState()
  }

  private forwardToolResult(
    message: Extract<PageToBridgeMessage, { type: 'mcp.toolResult' }>
  ): void {
    const pendingSessionId = this.pendingToolCalls.get(message.callId)
    if (pendingSessionId !== message.sessionId) {
      return
    }
    this.pendingToolCalls.delete(message.callId)
    this.hubClient.sendToolResult({
      error: message.error,
      id: message.callId,
      payload: message.payload,
      type: 'toolResult'
    })
  }

  private async uploadAsset(port: McpBrokerPort, message: AssetUploadMessage): Promise<void> {
    if (this.portSessions.get(port) !== message.sessionId) return

    const { assetServerUrl } = this.hubClient.getSnapshot()
    if (!assetServerUrl) {
      this.sendAssetUploadResult(port, message, {
        code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
        message: 'Asset server URL is not configured.'
      })
      return
    }

    try {
      await uploadAssetToServer(assetServerUrl, message.payload)
      this.sendAssetUploadResult(port, message)
    } catch (error) {
      this.sendAssetUploadResult(port, message, {
        message: error instanceof Error ? error.message : 'Failed to upload asset.'
      })
    }
  }

  private handlePortDisconnect(port: McpBrokerPort): void {
    const sessionId = this.portSessions.get(port)
    if (!sessionId) return
    this.unregisterSession(sessionId, 'Figma session disconnected before providing a result.')
    this.stopHubIfIdle()
    this.broadcastState()
  }

  private handleHubSnapshot(): void {
    this.ensureHubActive()
    this.broadcastState()
  }

  private ensureHubActive(): void {
    const snapshot = this.hubClient.getSnapshot()
    if (
      snapshot.status === 'connected' &&
      snapshot.registeredId &&
      this.sessions.getActive() &&
      snapshot.activeId !== snapshot.registeredId
    ) {
      this.hubClient.sendActivate()
    }
  }

  private routeToolCall(message: ToolCallMessage): void {
    const activeSession = this.sessions.getActive()
    if (!activeSession) {
      this.sendToolError(
        message.id,
        TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
        'No active TemPad Dev Figma session available.'
      )
      return
    }

    const bridgeMessage: BridgeToPageMessage = {
      callId: message.id,
      payload: message.payload,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.toolCall',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    }

    try {
      activeSession.port.postMessage(bridgeMessage)
      this.pendingToolCalls.set(message.id, activeSession.sessionId)
    } catch {
      this.unregisterSession(
        activeSession.sessionId,
        'Figma session disconnected before receiving a tool call.'
      )
      this.sendToolError(
        message.id,
        TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
        'Figma session disconnected before receiving a tool call.'
      )
      this.stopHubIfIdle()
      this.broadcastState()
    }
  }

  private unregisterSession(sessionId: string, message: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.portSessions.delete(session.port)
    }
    this.sessions.unregister(sessionId)
    this.rejectPendingForSession(sessionId, message)
  }

  private rejectPendingForSession(sessionId: string, message: string): void {
    for (const [callId, pendingSessionId] of this.pendingToolCalls) {
      if (pendingSessionId !== sessionId) continue
      this.pendingToolCalls.delete(callId)
      this.sendToolError(callId, TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED, message)
    }
  }

  private sendToolError(callId: string, code: TempadMcpErrorCode, message: string): void {
    this.hubClient.sendToolResult({
      error: {
        code,
        message
      },
      id: callId,
      type: 'toolResult'
    })
  }

  private sendAssetUploadResult(
    port: McpBrokerPort,
    request: AssetUploadMessage,
    error?: { code?: TempadMcpErrorCode; message: string }
  ): void {
    const message: BridgeToPageMessage = {
      ...(error ? { error } : {}),
      requestId: request.requestId,
      sessionId: request.sessionId,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetUploadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    }
    try {
      port.postMessage(message)
    } catch {
      this.unregisterSession(
        request.sessionId,
        'Figma session disconnected before receiving asset upload result.'
      )
      this.stopHubIfIdle()
      this.broadcastState()
    }
  }

  private stopHubIfIdle(): void {
    if (this.sessions.size === 0) {
      this.pendingToolCalls.clear()
      this.hubClient.stop()
    }
  }

  private broadcastState(): void {
    const snapshot = this.hubClient.getSnapshot()
    const commonState = {
      activeSessionId: this.sessions.getActiveId(),
      assetServerUrl: snapshot.assetServerUrl,
      errorMessage: snapshot.errorMessage,
      sessionCount: this.sessions.size,
      status: this.toBrowserStatus(snapshot.status)
    } satisfies Omit<McpBrowserStatePayload, 'sessionId'>

    let removedSession = false
    for (const session of this.sessions.list()) {
      const message: BridgeToPageMessage = {
        payload: {
          ...commonState,
          sessionId: session.sessionId
        },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.state',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      }
      try {
        session.port.postMessage(message)
      } catch {
        this.unregisterSession(
          session.sessionId,
          'Figma session disconnected before receiving MCP state.'
        )
        removedSession = true
      }
    }
    if (removedSession) {
      this.stopHubIfIdle()
      if (this.sessions.size > 0) {
        this.broadcastState()
      }
    }
  }

  private toBrowserStatus(status: HubConnectionStatus): McpBrowserStatePayload['status'] {
    return status === 'idle' ? 'disabled' : status
  }
}

export function startMcpServiceWorkerBroker(): void {
  new McpServiceWorkerBroker().start()
}

async function uploadAssetToServer(
  assetServerUrl: string,
  payload: AssetUploadMessage['payload']
): Promise<void> {
  const response = await fetch(`${assetServerUrl}/assets/${payload.hash}`, {
    body: new Blob([base64ToArrayBuffer(payload.base64)], { type: payload.mimeType }),
    headers: buildAssetUploadHeaders(payload),
    method: 'POST'
  })

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status} ${response.statusText}`)
  }
}

function buildAssetUploadHeaders(payload: AssetUploadMessage['payload']): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': payload.mimeType
  }
  if (payload.metadata?.width) headers['X-Asset-Width'] = String(payload.metadata.width)
  if (payload.metadata?.height) headers['X-Asset-Height'] = String(payload.metadata.height)
  if (payload.metadata?.themeable) headers['X-Asset-Themeable'] = 'true'
  return headers
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return buffer
}
