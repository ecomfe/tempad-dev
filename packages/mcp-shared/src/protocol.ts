import { z } from 'zod'

// Messages from hub to extension
export const RegisteredMessageSchema = z.object({
  type: z.literal('registered'),
  id: z.string()
})

export const StateMessageSchema = z.object({
  type: z.literal('state'),
  activeId: z.string().nullable(),
  count: z.number().nonnegative(),
  port: z.number().positive(),
  assetServerUrl: z.string().url()
})

export const ToolCallPayloadSchema = z.object({
  name: z.string(),
  args: z.unknown()
})

export const ToolCallMessageSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string(),
  payload: ToolCallPayloadSchema
})

export const MessageToExtensionSchema = z.discriminatedUnion('type', [
  RegisteredMessageSchema,
  StateMessageSchema,
  ToolCallMessageSchema
])

// Messages from extension to hub
export const ActivateMessageSchema = z.object({
  type: z.literal('activate')
})

export const ToolResultMessageSchema = z.object({
  type: z.literal('toolResult'),
  id: z.string(),
  payload: z.unknown().optional(),
  error: z.unknown().optional()
})

export const MessageFromExtensionSchema = z.discriminatedUnion('type', [
  ActivateMessageSchema,
  ToolResultMessageSchema
])

export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>
export type StateMessage = z.infer<typeof StateMessageSchema>
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>
export type ToolCallMessage = z.infer<typeof ToolCallMessageSchema>
export type MessageToExtension = z.infer<typeof MessageToExtensionSchema>
export type ActivateMessage = z.infer<typeof ActivateMessageSchema>
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>
export type MessageFromExtension = z.infer<typeof MessageFromExtensionSchema>

export function parseMessageToExtension(data: string): MessageToExtension | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const result = MessageToExtensionSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export function parseMessageFromExtension(data: string): MessageFromExtension | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const result = MessageFromExtensionSchema.safeParse(parsed)
  return result.success ? result.data : null
}
