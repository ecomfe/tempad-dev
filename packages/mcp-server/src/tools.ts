import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type {
  GetAssetsResult,
  TempadMcpErrorCode,
  ToolName,
  ToolResponseLike,
  ToolResultMap,
  ToolSchema
} from '@tempad-dev/shared'
import type { ZodType } from 'zod'

import {
  ApplyCanvasParametersSchema,
  ApplyCanvasResultSchema,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildApplyCanvasToolResult,
  buildGetAssetsToolResult,
  buildGetCodeToolResult,
  buildGetDesignSystemToolResult,
  buildGetScreenshotToolResult,
  buildGetStructureToolResult,
  buildGetTokenDefsToolResult,
  GetAssetsParametersSchema,
  GetAssetsResultSchema,
  GetCodeParametersSchema,
  GetDesignSystemParametersSchema,
  GetDesignSystemResultSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  GetTokenDefsParametersSchema,
  TEMPAD_MCP_ERROR_CODES,
  measureCallToolResultBytes
} from '@tempad-dev/shared'

import { getRecordProperty } from './shared'

export type {
  ApplyCanvasParametersInput,
  ApplyCanvasResult,
  AssetDescriptor,
  GetAssetsParametersInput,
  GetAssetsResult,
  GetCodeParametersInput,
  GetCodeResult,
  GetDesignSystemParametersInput,
  GetDesignSystemResult,
  GetScreenshotParametersInput,
  GetScreenshotResult,
  GetStructureParametersInput,
  GetStructureResult,
  GetTokenDefsParametersInput,
  GetTokenDefsResult,
  TokenEntry,
  ToolName,
  ToolResultMap,
  ToolSchema
} from '@tempad-dev/shared'

type BaseToolMetadata<Name extends ToolName, Schema extends ZodType> = ToolSchema<Name> & {
  annotations: ToolAnnotations
  parameters: Schema
  format?: (payload: ToolResultMap[Name]) => CallToolResult
}

type ExtensionToolMetadata<Name extends ToolName, Schema extends ZodType> = BaseToolMetadata<
  Name,
  Schema
> & {
  target: 'extension'
}

type HubToolMetadata<Name extends ToolName, Schema extends ZodType> = BaseToolMetadata<
  Name,
  Schema
> & {
  target: 'hub'
  outputSchema?: ZodType
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} satisfies ToolAnnotations

const CANVAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

const CONNECTIVITY_ERROR_CODES = new Set<TempadMcpErrorCode>([
  TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
  TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT,
  TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
  TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
  TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED
])

const SELECTION_ERROR_CODES = new Set<TempadMcpErrorCode>([
  TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION,
  TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE
])
const KNOWN_ERROR_CODES = new Set<string>(Object.values(TEMPAD_MCP_ERROR_CODES))

const CONNECTIVITY_TROUBLESHOOTING_LINES = [
  'Troubleshooting:',
  '- In Figma, open TemPad Dev panel and enable the MCP server in Preferences → Agent integration.',
  "- If multiple Figma tabs are open, click the intended tab's MCP badge; foregrounding it alone does not activate it."
]

const SELECTION_TROUBLESHOOTING_LINE = 'Tip: Select exactly one visible node, or pass nodeId.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function extTool<Name extends ToolName, Schema extends ZodType>(
  definition: ExtensionToolMetadata<Name, Schema>
): ExtensionToolMetadata<Name, Schema> {
  return definition
}

function hubTool<Name extends ToolName, Schema extends ZodType>(
  definition: HubToolMetadata<Name, Schema>
): HubToolMetadata<Name, Schema> {
  return definition
}

export const TOOL_DEFS = [
  extTool({
    name: 'get_code',
    description:
      'Read implementation evidence for an existing Figma node or the current single selection as JSX/Vue markup, classes, tokens, assets, codegen facts, and bounded warnings.',
    annotations: READ_ONLY_ANNOTATIONS,
    parameters: GetCodeParametersSchema,
    target: 'extension',
    format: createCodeToolResponse
  }),
  extTool({
    name: 'get_design_system',
    description:
      'Discover a bounded deterministic catalog of accessible components, variables, styles, and shaders when existing-resource reuse is permitted and relevant. Start without arguments; continue the same catalog by cursor or inspect one returned ref.',
    annotations: READ_ONLY_ANNOTATIONS,
    parameters: GetDesignSystemParametersSchema,
    target: 'extension',
    format: createDesignSystemToolResponse
  }),
  extTool({
    name: 'apply_canvas',
    description:
      'Create or reconcile one managed Figma root from Canvas HTML plus optional typed native resources and bindings. Create auto-places the new root; update targets an exact node, matches stable data-key identities, preserves omitted live state, and removes explicit removeKeys. TemPad Dev validates, applies one undoable patch, and verifies the result.',
    annotations: CANVAS_WRITE_ANNOTATIONS,
    parameters: ApplyCanvasParametersSchema,
    target: 'extension',
    format: createApplyCanvasToolResponse
  }),
  extTool({
    name: 'get_token_defs',
    description:
      'Resolve canonical token names to literal values (optionally including all modes) for tokens referenced by get_code.',
    annotations: READ_ONLY_ANNOTATIONS,
    parameters: GetTokenDefsParametersSchema,
    target: 'extension',
    format: createTokenDefsToolResponse,
    exposed: false
  }),
  extTool({
    name: 'get_screenshot',
    description:
      'Capture one bounded rendered PNG asset for an exact node or the current single selection.',
    annotations: READ_ONLY_ANNOTATIONS,
    parameters: GetScreenshotParametersSchema,
    target: 'extension',
    format: createScreenshotToolResponse
  }),
  extTool({
    name: 'get_structure',
    description:
      'Read a compact hierarchy and page-space geometry outline for an exact node or the current single selection, including stable keys on TemPad-managed nodes; it does not provide rendered pixels or appearance.',
    annotations: READ_ONLY_ANNOTATIONS,
    parameters: GetStructureParametersSchema,
    target: 'extension',
    format: createStructureToolResponse
  }),
  hubTool({
    name: 'get_assets',
    description:
      'Resolve asset hashes to downloadable URLs and metadata for assets referenced by tool responses. SVG asset metadata may include `themeable=true` when the underlying vector can safely adopt one contextual color channel.',
    annotations: READ_ONLY_ANNOTATIONS,
    parameters: GetAssetsParametersSchema,
    target: 'hub',
    outputSchema: GetAssetsResultSchema,
    exposed: false
  })
] as const

function extractToolErrorCode(error: unknown): TempadMcpErrorCode | undefined {
  const code = getRecordProperty(error, 'code')
  if (isTempadMcpErrorCode(code)) return code
  const cause = getRecordProperty(error, 'cause')
  const causeCode = getRecordProperty(cause, 'code')
  if (isTempadMcpErrorCode(causeCode)) return causeCode
  return undefined
}

function isTempadMcpErrorCode(value: unknown): value is TempadMcpErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value)
}

function extractToolErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error occurred.'
  if (typeof error === 'string') return error
  const message = getRecordProperty(error, 'message')
  if (typeof message === 'string' && message.trim()) return message
  return 'Unknown error occurred.'
}

function createToolErrorResponse(toolName: string, error: unknown): CallToolResult {
  const message = extractToolErrorMessage(error)
  const code = extractToolErrorCode(error)
  const codeLabel = code ? ` [${code}]` : ''
  const troubleshooting = buildTroubleshootingText(code, message)

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Tool "${toolName}" failed${codeLabel}: ${message}${troubleshooting}`
      }
    ]
  }
}

function buildTroubleshootingText(code: TempadMcpErrorCode | undefined, message: string): string {
  const help: string[] = []

  if (isConnectivityToolError(code, message)) {
    help.push(...CONNECTIVITY_TROUBLESHOOTING_LINES)
  }

  if (isSelectionToolError(code, message)) {
    help.push(SELECTION_TROUBLESHOOTING_LINE)
  }

  return help.length ? `\n\n${help.join('\n')}` : ''
}

function isConnectivityToolError(code: TempadMcpErrorCode | undefined, message: string): boolean {
  return (
    (code ? CONNECTIVITY_ERROR_CODES.has(code) : false) ||
    /no active tempad dev extension/i.test(message) ||
    /asset server url is not configured/i.test(message) ||
    /websocket/i.test(message)
  )
}

function isSelectionToolError(code: TempadMcpErrorCode | undefined, message: string): boolean {
  return (
    (code ? SELECTION_ERROR_CODES.has(code) : false) ||
    /select exactly one visible node/i.test(message) ||
    /no visible node found/i.test(message)
  )
}

export function createCodeToolResponse(payload: ToolResultMap['get_code']): CallToolResult {
  return formatToolResult('get_code', payload, isCodeResult, buildGetCodeToolResult)
}

export function createDesignSystemToolResponse(
  payload: ToolResultMap['get_design_system']
): CallToolResult {
  return formatToolResult(
    'get_design_system',
    payload,
    isDesignSystemResult,
    buildGetDesignSystemToolResult
  )
}

export function createApplyCanvasToolResponse(
  payload: ToolResultMap['apply_canvas']
): CallToolResult {
  return formatToolResult('apply_canvas', payload, isApplyCanvasResult, buildApplyCanvasToolResult)
}

export function createStructureToolResponse(
  payload: ToolResultMap['get_structure']
): CallToolResult {
  return formatToolResult('get_structure', payload, isStructureResult, buildGetStructureToolResult)
}

export function createTokenDefsToolResponse(
  payload: ToolResultMap['get_token_defs']
): CallToolResult {
  return formatToolResult('get_token_defs', payload, isTokenDefsResult, buildGetTokenDefsToolResult)
}

export function createScreenshotToolResponse(
  payload: ToolResultMap['get_screenshot']
): CallToolResult {
  return formatToolResult(
    'get_screenshot',
    payload,
    isScreenshotResult,
    buildGetScreenshotToolResult
  )
}

function formatToolResult<Result>(
  toolName: ToolName,
  payload: Result,
  isValid: (payload: unknown) => payload is Result,
  build: (payload: Result) => ToolResponseLike
): CallToolResult {
  if (!isValid(payload)) throw new Error(`Invalid ${toolName} payload received from extension.`)
  return toCallToolResult(build(payload))
}

function isScreenshotResult(payload: unknown): payload is ToolResultMap['get_screenshot'] {
  return (
    isRecord(payload) &&
    isRecord(payload.asset) &&
    typeof payload.width === 'number' &&
    typeof payload.height === 'number' &&
    typeof payload.scale === 'number' &&
    typeof payload.bytes === 'number' &&
    typeof payload.format === 'string'
  )
}

function isDesignSystemResult(payload: unknown): payload is ToolResultMap['get_design_system'] {
  return GetDesignSystemResultSchema.safeParse(payload).success
}

function isApplyCanvasResult(payload: unknown): payload is ToolResultMap['apply_canvas'] {
  return ApplyCanvasResultSchema.safeParse(payload).success
}

function isCodeResult(payload: unknown): payload is ToolResultMap['get_code'] {
  return (
    isRecord(payload) &&
    typeof payload.code === 'string' &&
    typeof payload.lang === 'string' &&
    (payload.assets === undefined || Array.isArray(payload.assets))
  )
}

function isStructureResult(payload: unknown): payload is ToolResultMap['get_structure'] {
  return isRecord(payload) && Array.isArray(payload.roots)
}

function isTokenDefsResult(payload: unknown): payload is ToolResultMap['get_token_defs'] {
  if (!isRecord(payload)) return false
  for (const token of Object.values(payload)) {
    if (!isRecord(token) || typeof token.kind !== 'string' || token.value === undefined)
      return false
  }
  return true
}

export function coercePayloadToToolResponse(payload: unknown): CallToolResult {
  if (isRecord(payload) && Array.isArray(payload.content)) {
    return payload as CallToolResult
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      }
    ]
  }
}

export function createAssetsToolResponse(payload: GetAssetsResult): CallToolResult {
  return toCallToolResult(buildGetAssetsToolResult(payload))
}

export function createInlineBudgetExceededToolResponse(
  toolName: ToolName,
  actualBytes: number
): CallToolResult {
  const guidance = getBudgetRetryGuidance(toolName)
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Tool "${toolName}" exceeded the 64 KiB inline budget (${actualBytes} UTF-8 bytes > ${MCP_TOOL_INLINE_BUDGET_BYTES}). ${guidance}`
      }
    ]
  }
}

export function isWithinInlineBudget(result: ToolResponseLike): boolean {
  return measureCallToolResultBytes(result) <= MCP_TOOL_INLINE_BUDGET_BYTES
}

function toCallToolResult(result: ToolResponseLike): CallToolResult {
  return result as CallToolResult
}

function getBudgetRetryGuidance(toolName: ToolName): string {
  switch (toolName) {
    case 'apply_canvas':
      return 'Submit a smaller desired subtree and retry.'
    case 'get_code':
      return 'Reduce selection size or request a smaller nodeId subtree and retry.'
    case 'get_design_system':
      return 'Continue from another catalog cursor or avoid the oversized exact definition.'
    case 'get_structure':
      return 'Reduce selection size or pass a smaller depth and retry.'
    case 'get_token_defs':
      return 'Reduce requested names or split them into smaller batches and retry.'
    case 'get_screenshot':
      return 'Pass a smaller nodeId and retry.'
    case 'get_assets':
      return 'Request fewer hashes in a single call and retry.'
  }
}

export { createToolErrorResponse }
