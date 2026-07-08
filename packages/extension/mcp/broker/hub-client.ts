import type { MessageToExtension, ToolCallMessage, ToolResultMessage } from '@tempad-dev/shared'

import { MCP_PORT_CANDIDATES, parseMessageToExtension } from '@tempad-dev/shared'

const RECONNECT_DELAY_MS = 3000
const KEEPALIVE_INTERVAL_MS = 20000
const PORT_PROBE_TIMEOUT_MS = 500
const LOCAL_HUB_UNREACHABLE_MESSAGE =
  'MCP server is not running. Start your agent or copy the MCP configuration from Agent integration.'

export type HubConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

export type HubClientSnapshot = {
  activeId: string | null
  assetServerUrl: string | null
  errorMessage: string | null
  registeredId: string | null
  status: HubConnectionStatus
}

type TimerHandle = ReturnType<typeof setTimeout>
type IntervalHandle = ReturnType<typeof setInterval>

export type McpHubClientEvents = {
  onSnapshot?: (snapshot: HubClientSnapshot) => void
  onToolCall?: (message: ToolCallMessage) => void
}

export type WebSocketFactory = (url: string) => WebSocket

export type McpHubClientOptions = {
  keepaliveIntervalMs?: number
  reconnectDelayMs?: number
  webSocketFactory?: WebSocketFactory
}

export class McpHubClient {
  private activeId: string | null = null
  private assetServerUrl: string | null = null
  private connectPromise: Promise<void> | null = null
  private connectionEpoch = 0
  private enabled = false
  private errorMessage: string | null = null
  private keepaliveTimer: IntervalHandle | null = null
  private lastSuccessfulPort: number | null = null
  private readonly keepaliveIntervalMs: number
  private reconnectTimer: TimerHandle | null = null
  private readonly reconnectDelayMs: number
  private registeredId: string | null = null
  private status: HubConnectionStatus = 'idle'
  private ws: WebSocket | null = null
  private readonly webSocketFactory: WebSocketFactory

  constructor(
    private readonly events: McpHubClientEvents = {},
    options: McpHubClientOptions = {}
  ) {
    this.keepaliveIntervalMs = options.keepaliveIntervalMs ?? KEEPALIVE_INTERVAL_MS
    this.reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url))
  }

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

  ensureConnected(): void {
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

        const ws = await this.openWebSocket(candidatePort)
        if (!this.isCurrentConnection(epoch)) {
          ws.close()
          return
        }
        this.attachSocket(ws)
        this.lastSuccessfulPort = candidatePort
        this.errorMessage = null
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

  private openWebSocket(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = this.webSocketFactory(`ws://127.0.0.1:${port}`)

      const cleanup = () => {
        ws.removeEventListener('open', handleOpen)
        ws.removeEventListener('error', handleError)
      }
      const handleOpen = () => {
        cleanup()
        resolve(ws)
      }
      const handleError = (event: Event) => {
        cleanup()
        try {
          ws.close()
        } catch {
          // Ignore close failures while probing candidate ports.
        }
        const error = getErrorEventMessage(event) ?? 'open failed'
        reject(new Error(error))
      }

      ws.addEventListener('open', handleOpen, { once: true })
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
    const payload = typeof event.data === 'string' ? event.data : ''
    const message = parseMessageToExtension(payload)
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
        this.emitSnapshot()
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

    if (!this.enabled) {
      this.status = 'idle'
      this.errorMessage = null
      this.emitSnapshot()
      return
    }

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
    }, this.reconnectDelayMs)
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
    }, this.keepaliveIntervalMs)
  }

  private clearKeepaliveTimer(): void {
    if (!this.keepaliveTimer) return
    clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
  }

  private cleanupSocket(): void {
    this.clearKeepaliveTimer()
    const current = this.ws
    this.ws = null
    if (!current) return
    try {
      current.close()
    } catch {
      // Ignore close failures while tearing down service-worker state.
    }
  }

  private sendJson(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }

  private emitSnapshot(): void {
    this.events.onSnapshot?.(this.getSnapshot())
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
