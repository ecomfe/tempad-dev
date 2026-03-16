import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  GetAssetsResult,
  GetScreenshotResult,
  TempadMcpErrorCode,
  ToolName,
  ToolResponseLike,
  ToolResultMap,
  ToolSchema
} from '@tempad-dev/shared'
import type { ZodType } from 'zod'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetAssetsToolResult,
  buildGetCodeToolResult,
  buildGetScreenshotToolResult,
  buildGetStructureToolResult,
  buildGetTokenDefsToolResult,
  GetAssetsParametersSchema,
  GetAssetsResultSchema,
  GetCodeParametersSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  GetTokenDefsParametersSchema,
  TEMPAD_MCP_ERROR_CODES,
  measureCallToolResultBytes,
  type TempadMcpErrorPayload
} from '@tempad-dev/shared'

export type {
  AssetDescriptor,
  GetAssetsParametersInput,
  GetAssetsResult,
  GetCodeParametersInput,
  GetCodeResult,
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

const CONNECTIVITY_TROUBLESHOOTING_LINES = [
  'Troubleshooting:',
  '- In Figma, open TemPad Dev panel and enable MCP (Preferences → MCP server).',
  '- If multiple Figma tabs are open, click the MCP badge to activate this tab.',
  '- Keep the Figma tab active/foreground while running MCP tools.'
]

const SELECTION_TROUBLESHOOTING_LINE = 'Tip: Select exactly one visible node, or pass nodeId.'

function getRecordProperty(record: unknown, key: string): unknown {
  if (!record || typeof record !== 'object') {
    return undefined
  }
  return Reflect.get(record, key)
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
      'High-fidelity code snapshot for nodeId/current single selection (omit nodeId to use selection): JSX/Vue markup + Tailwind-like classes, plus assets/tokens metadata and codegen config. `vectorMode=smart` (default) emits `<svg data-src="...">` placeholders in code and preserves themeable instance color on the emitted SVG root markup for downstream adaptation; if asset upload fails after export, the tool may inline the SVG as a fallback to preserve source of truth. `vectorMode=snapshot` preserves vector assets for fidelity. Host apps should still refactor vector delivery to repo policy where needed (existing icon/component primitives, import-time SVG transforms, inline SVG, or asset-backed SVG usage). SVG asset metadata may include `themeable=true`, meaning the exported asset can safely adopt one contextual color channel. Start here, then refactor into repo conventions while preserving values/intent; strip any data-hint-* attributes (hints only). If warnings include depth-cap, call get_code again for each listed nodeId. If warnings include shell, read the inline comment for omitted direct child ids and fetch them in order. If warnings include auto-layout (inferred), use get_structure to confirm hierarchy/overlap (do not derive numeric values from pixels). Tokens are keyed by canonical names like `--color-primary` (multi-mode keys use `${collection}:${mode}`; node overrides may appear as data-hint-variable-mode).',
    parameters: GetCodeParametersSchema,
    target: 'extension',
    format: createCodeToolResponse
  }),
  extTool({
    name: 'get_token_defs',
    description:
      'Resolve canonical token names to literal values (optionally including all modes) for tokens referenced by get_code.',
    parameters: GetTokenDefsParametersSchema,
    target: 'extension',
    format: createTokenDefsToolResponse,
    exposed: false
  }),
  extTool({
    name: 'get_screenshot',
    description:
      'Capture a rendered PNG screenshot for nodeId/current single selection for visual verification (layering/overlap/masks/effects).',
    parameters: GetScreenshotParametersSchema,
    target: 'extension',
    format: createScreenshotToolResponse,
    exposed: false
  }),
  extTool({
    name: 'get_structure',
    description:
      'Get a compact structural + geometry outline for nodeId/current single selection to understand hierarchy and layout intent.',
    parameters: GetStructureParametersSchema,
    target: 'extension',
    format: createStructureToolResponse
  }),
  hubTool({
    name: 'get_assets',
    description:
      'Resolve asset hashes to downloadable URLs and metadata for assets referenced by tool responses. SVG asset metadata may include `themeable=true` when the underlying vector can safely adopt one contextual color channel.',
    parameters: GetAssetsParametersSchema,
    target: 'hub',
    outputSchema: GetAssetsResultSchema,
    exposed: false
  })
] as const

function extractToolErrorCode(error: unknown): TempadMcpErrorCode | undefined {
  const code = getRecordProperty(error, 'code')
  if (typeof code === 'string') {
    return code as TempadMcpErrorCode
  }
  const cause = getRecordProperty(error, 'cause')
  const causeCode = getRecordProperty(cause, 'code')
  if (typeof causeCode === 'string') {
    return causeCode as TempadMcpErrorCode
  }
  return undefined
}

function extractToolErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error occurred.'
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const candidate = error as Partial<TempadMcpErrorPayload & Record<string, unknown>>
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message
  }
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
    /mcp transport is not connected/i.test(message) ||
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
  if (!isCodeResult(payload)) {
    throw new Error('Invalid get_code payload received from extension.')
  }

  return toCallToolResult(buildGetCodeToolResult(payload))
}

export function createStructureToolResponse(
  payload: ToolResultMap['get_structure']
): CallToolResult {
  if (!isStructureResult(payload)) {
    throw new Error('Invalid get_structure payload received from extension.')
  }

  return toCallToolResult(buildGetStructureToolResult(payload))
}

export function createTokenDefsToolResponse(
  payload: ToolResultMap['get_token_defs']
): CallToolResult {
  if (!isTokenDefsResult(payload)) {
    throw new Error('Invalid get_token_defs payload received from extension.')
  }

  return toCallToolResult(buildGetTokenDefsToolResult(payload))
}

export function createScreenshotToolResponse(
  payload: ToolResultMap['get_screenshot']
): CallToolResult {
  if (!isScreenshotResult(payload)) {
    throw new Error('Invalid get_screenshot payload received from extension.')
  }

  return toCallToolResult(buildGetScreenshotToolResult(payload))
}

function isScreenshotResult(payload: unknown): payload is GetScreenshotResult {
  if (typeof payload !== 'object' || !payload) return false
  const candidate = payload as Partial<GetScreenshotResult & Record<string, unknown>>
  return (
    typeof candidate.asset === 'object' &&
    candidate.asset !== null &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    typeof candidate.scale === 'number' &&
    typeof candidate.bytes === 'number' &&
    typeof candidate.format === 'string'
  )
}

function isCodeResult(payload: unknown): payload is ToolResultMap['get_code'] {
  if (typeof payload !== 'object' || !payload) return false
  const candidate = payload as Partial<ToolResultMap['get_code'] & Record<string, unknown>>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.lang === 'string' &&
    (candidate.assets === undefined || Array.isArray(candidate.assets))
  )
}

function isStructureResult(payload: unknown): payload is ToolResultMap['get_structure'] {
  if (typeof payload !== 'object' || !payload) return false
  const candidate = payload as Partial<ToolResultMap['get_structure'] & Record<string, unknown>>
  return Array.isArray(candidate.roots)
}

function isTokenDefsResult(payload: unknown): payload is ToolResultMap['get_token_defs'] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') return false
    const token = value as Partial<Record<'kind' | 'value', unknown>>
    if (typeof token.kind !== 'string') return false
    if (token.value === undefined) return false
  }
  return true
}

export function coercePayloadToToolResponse(payload: unknown): CallToolResult {
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as CallToolResult).content)
  ) {
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
    case 'get_code':
      return 'Reduce selection size or request a smaller nodeId subtree and retry.'
    case 'get_structure':
      return 'Reduce selection size or pass a smaller depth and retry.'
    case 'get_token_defs':
      return 'Reduce requested names or split them into smaller batches and retry.'
    case 'get_screenshot':
      return 'Reduce selection size or scale and retry.'
    case 'get_assets':
      return 'Request fewer hashes in a single call and retry.'
    default:
      return 'Retry with a narrower request.'
  }
}

export { createToolErrorResponse }
