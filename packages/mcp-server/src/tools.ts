import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  AssetDescriptor,
  GetScreenshotResult,
  TempadMcpErrorCode,
  ToolName,
  ToolResultMap,
  ToolSchema
} from '@tempad-dev/mcp-shared'
import type { ZodType } from 'zod'

import {
  GetAssetsParametersSchema,
  GetAssetsResultSchema,
  GetCodeParametersSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  GetTokenDefsParametersSchema,
  TEMPAD_MCP_ERROR_CODES,
  type TempadMcpErrorPayload
} from '@tempad-dev/mcp-shared'

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
} from '@tempad-dev/mcp-shared'

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
      'High-fidelity code snapshot for nodeId/current single selection (omit nodeId to use selection): JSX/Vue markup + Tailwind-like classes, plus assets/tokens metadata and codegen config. Start here, then refactor into repo conventions while preserving values/intent; strip any data-hint-* attributes (hints only). If warnings include depth-cap, call get_code again for each listed nodeId. If warnings include auto-layout (inferred), use get_structure/get_screenshot to confirm hierarchy/overlap (do not derive numeric values from pixels). Tokens are keyed by canonical names like `--color-primary` (multi-mode keys use `${collection}:${mode}`; node overrides may appear as data-hint-variable-mode).',
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
    exposed: false
  }),
  extTool({
    name: 'get_screenshot',
    description:
      'Capture a rendered PNG screenshot for nodeId/current single selection for visual verification (layering/overlap/masks/effects).',
    parameters: GetScreenshotParametersSchema,
    target: 'extension',
    format: createScreenshotToolResponse
  }),
  extTool({
    name: 'get_structure',
    description:
      'Get a structural + geometry outline for nodeId/current single selection to understand hierarchy and layout intent.',
    parameters: GetStructureParametersSchema,
    target: 'extension'
  }),
  hubTool({
    name: 'get_assets',
    description:
      'Resolve asset hashes to downloadable URLs/URIs for assets referenced by tool responses (preserve vectors exactly).',
    parameters: GetAssetsParametersSchema,
    target: 'hub',
    outputSchema: GetAssetsResultSchema,
    exposed: false
  })
] as const

function extractToolErrorCode(error: unknown): TempadMcpErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') {
    return error.code as TempadMcpErrorCode
  }
  if ('cause' in error) {
    const cause = (error as { cause?: unknown }).cause
    if (cause && typeof cause === 'object') {
      const causeCode = (cause as { code?: unknown }).code
      if (typeof causeCode === 'string') {
        return causeCode as TempadMcpErrorCode
      }
    }
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

  const troubleshooting = (() => {
    const help: string[] = []

    const isConnectivityError =
      code === TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION ||
      code === TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT ||
      code === TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED ||
      code === TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED ||
      code === TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED ||
      /no active tempad dev extension/i.test(message) ||
      /asset server url is not configured/i.test(message) ||
      /mcp transport is not connected/i.test(message) ||
      /websocket/i.test(message)

    if (isConnectivityError) {
      help.push(
        'Troubleshooting:',
        '- In Figma, open TemPad Dev panel and enable MCP (Preferences → MCP server).',
        '- If multiple Figma tabs are open, click the MCP badge to activate this tab.',
        '- Keep the Figma tab active/foreground while running MCP tools.'
      )
    }

    const isSelectionError =
      code === TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION ||
      code === TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE ||
      /select exactly one visible node/i.test(message) ||
      /no visible node found/i.test(message)

    if (isSelectionError) {
      help.push('Tip: Select exactly one visible node, or pass nodeId.')
    }

    return help.length ? `\n\n${help.join('\n')}` : ''
  })()

  return {
    content: [
      {
        type: 'text' as const,
        text: `Tool "${toolName}" failed: ${message}${troubleshooting}`
      }
    ]
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function createCodeToolResponse(payload: ToolResultMap['get_code']): CallToolResult {
  if (!isCodeResult(payload)) {
    throw new Error('Invalid get_code payload received from extension.')
  }

  const summary: string[] = []
  const codeSize = Buffer.byteLength(payload.code, 'utf8')
  summary.push(`Generated \`${payload.lang}\` snippet (${formatBytes(codeSize)}).`)
  if (payload.warnings?.length) {
    const warningText = payload.warnings.map((warning) => warning.message).join(' ')
    summary.push(warningText)
  }
  summary.push(
    payload.assets?.length
      ? `Assets attached: ${payload.assets.length}. Fetch bytes via resources/read using resourceUri.`
      : 'No binary assets were attached to this response.'
  )
  const tokenCount = payload.tokens ? Object.keys(payload.tokens).length : 0
  if (tokenCount) {
    summary.push(`Token references included: ${tokenCount}.`)
  }
  summary.push('Read structuredContent for the full code string and asset metadata.')

  const assetLinks = payload.assets?.length
    ? payload.assets.map((asset) => createAssetResourceLinkBlock(asset))
    : []

  return {
    content: [
      {
        type: 'text' as const,
        text: summary.join('\n')
      },
      ...assetLinks
    ],
    structuredContent: payload
  }
}

export function createScreenshotToolResponse(
  payload: ToolResultMap['get_screenshot']
): CallToolResult {
  if (!isScreenshotResult(payload)) {
    throw new Error('Invalid get_screenshot payload received from extension.')
  }

  const descriptionBlock = {
    type: 'text' as const,
    text: describeScreenshot(payload)
  }

  return {
    content: [
      descriptionBlock,
      {
        type: 'text' as const,
        text: `![Screenshot](${payload.asset.url})`
      },
      createResourceLinkBlock(payload.asset, payload)
    ],
    structuredContent: payload
  }
}

function createResourceLinkBlock(asset: AssetDescriptor, result: GetScreenshotResult) {
  return {
    type: 'resource_link' as const,
    name: 'Screenshot',
    uri: asset.resourceUri,
    mimeType: asset.mimeType,
    description: `Screenshot ${result.width}x${result.height} @${result.scale}x - Download: ${asset.url}`
  }
}

function describeScreenshot(result: GetScreenshotResult): string {
  return `Screenshot ${result.width}x${result.height} @${result.scale}x (${formatBytes(result.bytes)})`
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

function createAssetResourceLinkBlock(asset: AssetDescriptor) {
  return {
    type: 'resource_link' as const,
    name: formatAssetResourceName(asset.hash),
    uri: asset.resourceUri,
    mimeType: asset.mimeType,
    description: `${describeAsset(asset)} - Download: ${asset.url}`
  }
}

function describeAsset(asset: AssetDescriptor): string {
  return `${asset.mimeType} (${formatBytes(asset.size)})`
}

function formatAssetResourceName(hash: string): string {
  return `asset:${hash.slice(0, 8)}`
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

export { createToolErrorResponse }
