import type {
  MessageToExtension,
  RegisteredMessage,
  StateMessage,
  ToolCallMessage,
  ToolResultMessage
} from '@tempad-dev/shared'

import { MCP_PORT_CANDIDATES, parseMessageToExtension } from '@tempad-dev/shared'

const RECONNECT_DELAY_MS = 3000
const KEEPALIVE_INTERVAL_MS = 20000
const PORT_PROBE_TIMEOUT_MS = 500
const HUB_HANDSHAKE_TIMEOUT_MS = 1000
const LOCAL_HUB_UNREACHABLE_MESSAGE =
  'MCP server is not running. Start your agent or copy the MCP configuration from Agent integration.'

type HubConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

type HubClientSnapshot = {
  activeId: string | null
  assetServerUrl: string | null
  errorMessage: string | null
  registeredId: string | null
  status: HubConnectionStatus
}

type McpHubClientEvents = {
  onSnapshot?: (snapshot: HubClientSnapshot) => void
  onToolCall?: (message: ToolCallMessage) => void
}

type WebSocketFactory = (url: string) => WebSocket

type HubConnection = {
  registered: RegisteredMessage
  state: StateMessage
  ws: WebSocket
}

export class McpHubClient {
  private activeId: string | null = null
  private assetServerUrl: string | null = null
  private candidateSocket: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private connectionEpoch = 0
  private enabled = false
  private errorMessage: string | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private lastSuccessfulPort: number | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private registeredId: string | null = null
  private status: HubConnectionStatus = 'idle'
  private ws: WebSocket | null = null

  constructor(
    private readonly events: McpHubClientEvents = {},
    private readonly createWebSocket: WebSocketFactory = (url) => new WebSocket(url)
  ) {}

  getSnapshot(): HubClientSnapshot {
    return {
      activeId: this.activeId,
      assetServerUrl: this.assetServerUrl,
      errorMessage: this.errorMessage,
      registeredId: this.registeredId,
      status: this.status
    }
  }

  start(): void {
    if (!this.enabled) {
      this.connectionEpoch++
    }
    this.enabled = true
    this.ensureConnected()
  }

  stop(): void {
    this.enabled = false
    this.connectionEpoch++
    this.connectPromise = null
    this.clearReconnectTimer()
    this.cleanupSocket()
    this.activeId = null
    this.assetServerUrl = null
    this.errorMessage = null
    this.registeredId = null
    this.status = 'idle'
    this.emitSnapshot()
  }

  private ensureConnected(): void {
    if (!this.enabled || this.status === 'connected' || this.connectPromise) {
      return
    }
    const trackedPromise = this.connect(this.connectionEpoch).finally(() => {
      if (this.connectPromise === trackedPromise) {
        this.connectPromise = null
      }
    })
    this.connectPromise = trackedPromise
  }

  sendActivate(): void {
    this.sendJson({ type: 'activate' })
  }

  sendToolResult(message: ToolResultMessage): void {
    this.sendJson(message)
  }

  private async connect(epoch: number): Promise<void> {
    this.clearReconnectTimer()
    this.status = 'connecting'
    this.errorMessage = null
    this.emitSnapshot()

    for (const candidatePort of this.getPortCandidates()) {
      if (!this.isCurrentConnection(epoch)) return
      try {
        const isReachable = await probeLocalHubPort(candidatePort)
        if (!this.isCurrentConnection(epoch)) return
        if (!isReachable) continue

        const connection = await this.openHubConnection(candidatePort)
        if (!this.isCurrentConnection(epoch)) {
          closeWebSocket(connection.ws)
          return
        }
        this.attachSocket(connection.ws)
        this.handleHubMessage(connection.registered)
        this.handleHubMessage(connection.state)
        this.lastSuccessfulPort = candidatePort
        this.startKeepalive()
        return
      } catch {
        if (!this.isCurrentConnection(epoch)) return
      }
    }

    if (!this.isCurrentConnection(epoch)) return
    this.cleanupSocket()
    this.status = 'error'
    this.errorMessage = LOCAL_HUB_UNREACHABLE_MESSAGE
    this.emitSnapshot()
    this.scheduleReconnect()
  }

  private isCurrentConnection(epoch: number): boolean {
    return this.enabled && this.connectionEpoch === epoch
  }

  private getPortCandidates(): number[] {
    if (this.lastSuccessfulPort && MCP_PORT_CANDIDATES.includes(this.lastSuccessfulPort)) {
      return [
        this.lastSuccessfulPort,
        ...MCP_PORT_CANDIDATES.filter((port) => port !== this.lastSuccessfulPort)
      ]
    }
    return [...MCP_PORT_CANDIDATES]
  }

  private openHubConnection(port: number): Promise<HubConnection> {
    return new Promise((resolve, reject) => {
      const ws = this.createWebSocket(`ws://127.0.0.1:${port}`)
      this.candidateSocket = ws
      let registered: RegisteredMessage | null = null
      let state: StateMessage | null = null
      let settled = false

      const timer = setTimeout(() => {
        fail(new Error('MCP server handshake timed out'))
      }, HUB_HANDSHAKE_TIMEOUT_MS)

      const cleanup = () => {
        clearTimeout(timer)
        ws.removeEventListener('message', handleMessage)
        ws.removeEventListener('close', handleClose)
        ws.removeEventListener('error', handleError)
        if (this.candidateSocket === ws) {
          this.candidateSocket = null
        }
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        closeWebSocket(ws)
        reject(error)
      }
      const finish = () => {
        if (settled || !registered || !state) return
        settled = true
        cleanup()
        resolve({ registered, state, ws })
      }
      const handleMessage = (event: Event) => {
        const message = parseHubMessage(event)
        if (!message) {
          fail(new Error('Received malformed MCP server handshake'))
          return
        }
        if (message.type === 'registered') {
          registered = message
        } else if (message.type === 'state') {
          state = message
        }
        finish()
      }
      const handleClose = () => {
        fail(new Error('MCP server connection closed during handshake'))
      }
      const handleError = (event: Event) => {
        const error = getErrorEventMessage(event) ?? 'open failed'
        fail(new Error(error))
      }

      ws.addEventListener('message', handleMessage)
      ws.addEventListener('close', handleClose, { once: true })
      ws.addEventListener('error', handleError, { once: true })
    })
  }

  private attachSocket(ws: WebSocket): void {
    this.cleanupSocket()
    this.ws = ws
    ws.addEventListener('message', (event) => this.handleMessage(ws, event as MessageEvent<string>))
    ws.addEventListener('close', (event) => this.handleClose(ws, event as CloseEvent))
    ws.addEventListener('error', (event) => this.handleError(ws, event))
  }

  private handleMessage(ws: WebSocket, event: MessageEvent<string>): void {
    if (this.ws !== ws) return
    const message = parseHubMessage(event)
    if (!message) {
      this.errorMessage = 'Received malformed message from MCP server'
      this.emitSnapshot()
      return
    }
    this.handleHubMessage(message)
  }

  private handleHubMessage(message: MessageToExtension): void {
    switch (message.type) {
      case 'registered':
        this.registeredId = message.id
        break
      case 'state':
        this.activeId = message.activeId
        this.assetServerUrl = message.assetServerUrl
        this.status = 'connected'
        this.errorMessage = null
        this.emitSnapshot()
        break
      case 'toolCall':
        this.events.onToolCall?.(message)
        break
    }
  }

  private handleClose(ws: WebSocket, event: CloseEvent): void {
    if (this.ws !== ws) return
    this.cleanupSocket()
    this.activeId = null
    this.assetServerUrl = null
    this.registeredId = null
    this.status = 'connecting'
    this.errorMessage = event.wasClean ? null : 'MCP connection closed unexpectedly'
    this.emitSnapshot()
    this.scheduleReconnect()
  }

  private handleError(ws: WebSocket, event: Event): void {
    if (this.ws !== ws) return
    this.errorMessage = getErrorEventMessage(event) ?? 'MCP connection error'
    this.emitSnapshot()
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnected()
    }, RECONNECT_DELAY_MS)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private startKeepalive(): void {
    this.clearKeepaliveTimer()
    this.keepaliveTimer = setInterval(() => {
      this.sendJson({ type: 'ping' })
    }, KEEPALIVE_INTERVAL_MS)
  }

  private clearKeepaliveTimer(): void {
    if (!this.keepaliveTimer) return
    clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
  }

  private cleanupSocket(): void {
    this.clearKeepaliveTimer()
    const candidate = this.candidateSocket
    const current = this.ws
    this.candidateSocket = null
    this.ws = null
    closeWebSocket(candidate)
    closeWebSocket(current)
  }

  private sendJson(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }

  private emitSnapshot(): void {
    this.events.onSnapshot?.(this.getSnapshot())
  }
}

function parseHubMessage(event: Event): MessageToExtension | null {
  const data = (event as MessageEvent<unknown>).data
  return parseMessageToExtension(typeof data === 'string' ? data : '')
}

function closeWebSocket(ws: WebSocket | null): void {
  try {
    ws?.close()
  } catch {
    // Socket teardown is best effort.
  }
}

async function probeLocalHubPort(port: number): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PORT_PROBE_TIMEOUT_MS)
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      cache: 'no-store',
      signal: controller.signal
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function getErrorEventMessage(event: Event): string | null {
  if (
    typeof ErrorEvent !== 'undefined' &&
    event instanceof ErrorEvent &&
    typeof event.message === 'string' &&
    event.message
  ) {
    return event.message
  }
  return null
}
