import type { ZodType } from 'zod'

import { z } from 'zod'

import { MCP_CHECKOUT_PORT_CANDIDATES, MCP_PORT_CANDIDATES } from './constants'
import {
  DesignTaskSchema,
  DesignToolRouteSchema,
  FigmaSessionSchema,
  DesignActionSchema,
  DesignActionResultSchema
} from './design-task'
import { TempadMcpErrorPayloadSchema } from './errors'
import { hasToolResultOutcome, TOOL_RESULT_OUTCOME_ERROR } from './tool-result'

export const RuntimeProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('release') }).strict(),
  z.object({ kind: z.literal('checkout'), id: z.string().regex(/^[a-f0-9]{16}$/) }).strict()
])
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>

export function sameRuntimeProfile(left?: RuntimeProfile, right?: RuntimeProfile): boolean {
  if (left?.kind === 'checkout') return right?.kind === 'checkout' && left.id === right.id
  return right?.kind !== 'checkout'
}

export function runtimePortCandidates(profile?: RuntimeProfile): readonly number[] {
  return profile?.kind === 'checkout' ? MCP_CHECKOUT_PORT_CANDIDATES : MCP_PORT_CANDIDATES
}

// Messages from hub to extension. These envelopes stay open to unknown keys: a newer Hub reaches an
// older installed extension, and rejecting an added envelope field would drop the whole message.
// The extension decides compatibility from the announced versions, not from the envelope shape.
// The payloads below stay strict, so a field added inside `task`, `route` or `result` is NOT
// covered: announcing an older version obliges the Hub to keep sending a shape that version reads.
export const RegisteredMessageSchema = z.object({
  type: z.literal('registered'),
  id: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  supportedProtocolVersions: z.array(z.number().int().positive()).min(1).optional(),
  runtimeProfile: RuntimeProfileSchema.optional(),
  terminalReceiptGeneration: z.string().min(1).max(128).optional(),
  durableTerminalReceipts: z.literal(true).optional()
})

export const TerminalReceiptSchema = z
  .object({ generation: z.string().min(1).max(128), receiptId: z.string().min(1).max(128) })
  .strict()

export const ToolCompletionMessageSchema = TerminalReceiptSchema.extend({
  type: z.literal('toolCompletion'),
  id: z.string().min(1).max(128)
}).strict()

export const ToolCompletionAckMessageSchema = z.object({
  ...ToolCompletionMessageSchema.shape,
  type: z.literal('toolCompletionAck'),
  accepted: z.boolean()
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
  terminalReceipt: TerminalReceiptSchema.optional(),
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
  ToolCompletionAckMessageSchema,
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
    runtimeProfile: RuntimeProfileSchema.optional(),
    // Released protocol 13 peers omit this field. The Hub treats omission conservatively as 13.
    protocolVersion: z.number().int().positive().optional(),
    terminalReceipts: z.literal(true).optional(),
    durableTerminalReceipts: z.literal(true).optional(),
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
  ToolCompletionMessageSchema,
  DesignActionMessageSchema,
  ActivateMessageSchema,
  ToolResultMessageSchema,
  RuntimeHelloMessageSchema,
  FigmaSessionsMessageSchema,
  PingMessageSchema
])

// Unversioned clients cannot publish sessions, runtime identity, or design actions.
export const LegacyMessageFromExtensionSchema = z.union([
  ActivateMessageSchema,
  ToolResultMessageSchema,
  PingMessageSchema
])

export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>
export type TerminalReceipt = z.infer<typeof TerminalReceiptSchema>
export type ToolCompletionMessage = z.infer<typeof ToolCompletionMessageSchema>
export type ToolCompletionAckMessage = z.infer<typeof ToolCompletionAckMessageSchema>
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
