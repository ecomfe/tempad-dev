import type { ZodObject, ZodRawShape, ZodType } from 'zod'

import { z } from 'zod'

import { MCP_HASH_PATTERN, MCP_MAX_ASSET_BYTES } from './constants'
import { TEMPAD_MCP_ERROR_CODES } from './errors'

export const TEMPAD_MCP_BROWSER_SOURCE = 'tempad-dev:mcp'
export const TEMPAD_MCP_BROWSER_PROTOCOL_VERSION = 1
export const TEMPAD_MCP_SESSION_PORT_NAME = 'tempad-mcp-session'
export const TEMPAD_MCP_FIGMA_ORIGIN = 'https://www.figma.com'

const MCP_MAX_ASSET_BASE64_LENGTH = 4 * Math.ceil(MCP_MAX_ASSET_BYTES / 3)

const MessageBaseSchema = z
  .object({
    source: z.literal(TEMPAD_MCP_BROWSER_SOURCE),
    version: z.literal(TEMPAD_MCP_BROWSER_PROTOCOL_VERSION)
  })
  .strict()

const PageMessageBaseSchema = MessageBaseSchema.extend({
  sessionId: z.string().min(1)
}).strict()

function messageSchema<
  BaseShape extends ZodRawShape,
  const Type extends string,
  Shape extends ZodRawShape
>(base: ZodObject<BaseShape>, type: Type, shape: Shape) {
  return base
    .extend({
      type: z.literal(type),
      ...shape
    })
    .strict()
}

const ToolErrorSchema = z
  .object({
    code: z.enum(TEMPAD_MCP_ERROR_CODES).optional(),
    message: z.string()
  })
  .strict()

const AssetMetadataSchema = z
  .object({
    height: z.number().int().positive().optional(),
    themeable: z.boolean().optional(),
    width: z.number().int().positive().optional()
  })
  .strict()

const AssetUploadPayloadSchema = z
  .object({
    base64: z.string().min(1).max(MCP_MAX_ASSET_BASE64_LENGTH),
    hash: z.string().regex(MCP_HASH_PATTERN),
    metadata: AssetMetadataSchema.optional(),
    mimeType: z.string().min(1)
  })
  .strict()

const PageEnableMessageSchema = messageSchema(PageMessageBaseSchema, 'mcp.enable', {})

const PageDisableMessageSchema = messageSchema(PageMessageBaseSchema, 'mcp.disable', {})

const PageActivateSessionMessageSchema = messageSchema(
  PageMessageBaseSchema,
  'mcp.activateSession',
  {}
)

const PageToolResultMessageSchema = messageSchema(PageMessageBaseSchema, 'mcp.toolResult', {
  callId: z.string().min(1),
  error: ToolErrorSchema.optional(),
  payload: z.unknown().optional()
})

const PageAssetUploadMessageSchema = messageSchema(PageMessageBaseSchema, 'mcp.uploadAsset', {
  payload: AssetUploadPayloadSchema,
  requestId: z.string().min(1)
})

export const PageToBridgeMessageSchema = z.discriminatedUnion('type', [
  PageEnableMessageSchema,
  PageDisableMessageSchema,
  PageActivateSessionMessageSchema,
  PageToolResultMessageSchema,
  PageAssetUploadMessageSchema
])

const McpBrowserStateStatusSchema = z.enum(['disabled', 'connecting', 'connected', 'error'])

export const McpBrowserStatePayloadSchema = z
  .object({
    activeSessionId: z.string().nullable(),
    assetServerUrl: z.string().nullable().optional(),
    errorMessage: z.string().nullable(),
    sessionCount: z.number().nonnegative(),
    sessionId: z.string(),
    status: McpBrowserStateStatusSchema
  })
  .strict()

const BridgeStateMessageSchema = messageSchema(MessageBaseSchema, 'mcp.state', {
  payload: McpBrowserStatePayloadSchema
})

const BridgeToolCallMessageSchema = messageSchema(MessageBaseSchema, 'mcp.toolCall', {
  callId: z.string().min(1),
  payload: z
    .object({
      args: z.unknown().optional(),
      name: z.string()
    })
    .strict()
})

const BridgeAssetUploadResultMessageSchema = messageSchema(
  MessageBaseSchema,
  'mcp.assetUploadResult',
  {
    error: ToolErrorSchema.optional(),
    requestId: z.string().min(1),
    sessionId: z.string().min(1)
  }
)

export const BridgeToPageMessageSchema = z.discriminatedUnion('type', [
  BridgeStateMessageSchema,
  BridgeToolCallMessageSchema,
  BridgeAssetUploadResultMessageSchema
])

export type PageToBridgeMessage = z.infer<typeof PageToBridgeMessageSchema>
export type McpBrowserStatePayload = z.infer<typeof McpBrowserStatePayloadSchema>
export type BridgeToPageMessage = z.infer<typeof BridgeToPageMessageSchema>

function createParser<T>(schema: ZodType<T>): (data: unknown) => T | null {
  return (data) => {
    const result = schema.safeParse(data)
    return result.success ? result.data : null
  }
}

export const parsePageToBridgeMessage = createParser(PageToBridgeMessageSchema)

export const parseBridgeToPageMessage = createParser(BridgeToPageMessageSchema)
