import type { WebSocket } from 'ws'

export interface ExtensionConnection {
  id: string
  ws: WebSocket
  active: boolean
}

export interface PendingToolCall {
  resolve: (value: unknown) => void
  reject: (reason?: Error) => void
  timer: NodeJS.Timeout
  extensionId: string
}
