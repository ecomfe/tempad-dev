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

export interface AssetRecord {
  hash: string
  filePath: string
  mimeType: string
  size: number
  uploadedAt: number
  lastAccess: number
  metadata?: {
    width?: number
    height?: number
  }
}
