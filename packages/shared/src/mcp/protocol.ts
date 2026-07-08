import type { ZodType } from 'zod'

import { z } from 'zod'

// Messages from hub to extension
export const RegisteredMessageSchema = z
  .object({
    type: z.literal('registered'),
    id: z.string()
  })
  .strict()

export const StateMessageSchema = z
  .object({
    type: z.literal('state'),
    activeId: z.string().nullable(),
    assetServerUrl: z.string().url()
  })
  .strict()

export const ToolCallPayloadSchema = z
  .object({
    name: z.string(),
    args: z.unknown()
  })
  .strict()

export const ToolCallMessageSchema = z
  .object({
    type: z.literal('toolCall'),
    id: z.string(),
    payload: ToolCallPayloadSchema
  })
  .strict()

export const MessageToExtensionSchema = z.discriminatedUnion('type', [
  RegisteredMessageSchema,
  StateMessageSchema,
  ToolCallMessageSchema
])

// Messages from extension to hub
export const ActivateMessageSchema = z
  .object({
    type: z.literal('activate')
  })
  .strict()

export const ToolResultMessageSchema = z
  .object({
    type: z.literal('toolResult'),
    id: z.string(),
    payload: z.unknown().optional(),
    error: z.unknown().optional()
  })
  .strict()

export const PingMessageSchema = z
  .object({
    type: z.literal('ping')
  })
  .strict()

export const MessageFromExtensionSchema = z.discriminatedUnion('type', [
  ActivateMessageSchema,
  ToolResultMessageSchema,
  PingMessageSchema
])

export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>
export type StateMessage = z.infer<typeof StateMessageSchema>
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>
export type ToolCallMessage = z.infer<typeof ToolCallMessageSchema>
export type MessageToExtension = z.infer<typeof MessageToExtensionSchema>
export type ActivateMessage = z.infer<typeof ActivateMessageSchema>
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>
export type MessageFromExtension = z.infer<typeof MessageFromExtensionSchema>

function parseJsonWithSchema<T>(data: string, schema: ZodType<T>): T | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const result = schema.safeParse(parsed)
  return result.success ? result.data : null
}

export function parseMessageToExtension(data: string): MessageToExtension | null {
  return parseJsonWithSchema(data, MessageToExtensionSchema)
}

export function parseMessageFromExtension(data: string): MessageFromExtension | null {
  return parseJsonWithSchema(data, MessageFromExtensionSchema)
}
