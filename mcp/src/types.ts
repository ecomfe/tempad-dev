import { type WebSocket } from 'ws'
import { z } from 'zod'

// Core Data Structures
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

// Messages Sent FROM Hub TO Extension
export interface RegisteredMessage {
  type: 'registered'
  id: string
}

export interface ActiveChangedMessage {
  type: 'activeChanged'
  activeId: string | null
}

export interface ToolCallMessage {
  type: 'toolCall'
  req: string
  name: string
  args: any
}

export type MessageToExtension = RegisteredMessage | ActiveChangedMessage | ToolCallMessage

// Messages Sent FROM Extension TO Hub
export const MessageFromExtensionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('activate') }),
  z.object({
    type: z.literal('toolResult'),
    req: z.string(),
    ok: z.boolean(),
    payload: z.unknown()
  })
])

export type MessageFromExtension = z.infer<typeof MessageFromExtensionSchema>
