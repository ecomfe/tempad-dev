import type { ZodType } from 'zod'

import { z } from 'zod'

import {
  DesignTaskSchema,
  DesignToolRouteSchema,
  FigmaSessionSchema,
  DesignActionSchema,
  DesignActionResultSchema
} from './design-task'
import { TempadMcpErrorPayloadSchema } from './errors'
import { hasToolResultOutcome, TOOL_RESULT_OUTCOME_ERROR } from './tool-result'

// Messages from hub to extension. These stay open to unknown keys: a newer Hub reaches an older
// installed extension, and rejecting an added field would break that extension's whole session.
// The extension decides compatibility from the announced versions, not from the message shape.
export const RegisteredMessageSchema = z.object({
  type: z.literal('registered'),
  id: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  supportedProtocolVersions: z.array(z.number().int().positive()).min(1).optional()
})

export const StateMessageSchema = z.object({
  type: z.literal('state'),
  activeId: z.string().nullable(),
  assetServerUrl: z.string().url()
})

export const ToolCallPayloadSchema = z.object({
  name: z.string(),
  args: z.unknown()
})

export const ToolCallMessageSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string().min(1),
  route: DesignToolRouteSchema.optional(),
  payload: ToolCallPayloadSchema
})

export const DesignTaskStateMessageSchema = z.object({
  type: z.literal('designTaskState'),
  task: DesignTaskSchema
})

export const DesignActionResultMessageSchema = z.object({
  type: z.literal('designActionResult'),
  sessionId: z.string().min(1),
  result: DesignActionResultSchema
})

export const DesignActionMessageSchema = z
  .object({
    type: z.literal('designAction'),
    sessionId: z.string().min(1),
    action: DesignActionSchema
  })
  .strict()

export const MessageToExtensionSchema = z.discriminatedUnion('type', [
  DesignActionResultMessageSchema,
  RegisteredMessageSchema,
  StateMessageSchema,
  DesignTaskStateMessageSchema,
  ToolCallMessageSchema
])

// Messages from extension to hub. These stay strict: the Hub updates on every launch, so an
// unexpected field means a real mismatch rather than an older peer.
export const ActivateMessageSchema = z
  .object({
    type: z.literal('activate')
  })
  .strict()

export const ToolResultMessageSchema = z
  .object({
    type: z.literal('toolResult'),
    id: z.string().min(1),
    payload: z.unknown().optional(),
    error: TempadMcpErrorPayloadSchema.optional()
  })
  .strict()
  .refine(hasToolResultOutcome, { message: TOOL_RESULT_OUTCOME_ERROR })

export const PingMessageSchema = z
  .object({
    type: z.literal('ping')
  })
  .strict()

export const RuntimeHelloMessageSchema = z
  .object({
    type: z.literal('runtimeHello'),
    extensionVersion: z.string().min(1),
    extensionRuntimeFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

export const FigmaSessionsMessageSchema = z
  .object({
    type: z.literal('sessions'),
    browserId: z.string().min(1),
    activeSessionId: z.string().nullable(),
    sessions: z.array(FigmaSessionSchema).max(128),
    reviews: z
      .array(z.object({ sessionId: z.string().min(1), task: DesignTaskSchema }).strict())
      .max(128)
      .optional(),
    openTabIds: z.array(z.number().int().nonnegative()).max(10000).optional()
  })
  .strict()

export const MessageFromExtensionSchema = z.union([
  DesignActionMessageSchema,
  ActivateMessageSchema,
  ToolResultMessageSchema,
  RuntimeHelloMessageSchema,
  FigmaSessionsMessageSchema,
  PingMessageSchema
])

export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>
export type StateMessage = z.infer<typeof StateMessageSchema>
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>
export type ToolCallMessage = z.infer<typeof ToolCallMessageSchema>
export type MessageToExtension = z.infer<typeof MessageToExtensionSchema>
export type ActivateMessage = z.infer<typeof ActivateMessageSchema>
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>
export type RuntimeHelloMessage = z.infer<typeof RuntimeHelloMessageSchema>
export type FigmaSessionsMessage = z.infer<typeof FigmaSessionsMessageSchema>
export type DesignTaskStateMessage = z.infer<typeof DesignTaskStateMessageSchema>
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

export type DesignActionMessage = z.infer<typeof DesignActionMessageSchema>
export type DesignActionResultMessage = z.infer<typeof DesignActionResultMessageSchema>
