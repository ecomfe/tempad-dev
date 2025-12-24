import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  AssetDescriptor,
  GetScreenshotResult,
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
  GetTokenDefsParametersSchema
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
      'Get a high-fidelity code snapshot for a nodeId/current selection, including assets/tokens and codegen plugin/config. Start here, then refactor into your component/styling/file/naming conventions; strip any data-* hints. If no data-hint-auto-layout is present, layout is explicit; if any hint is none/inferred, pair with get_structure/get_screenshot to confirm hierarchy/overlap. Use data-hint-component plus repetition to decide on reusable components. Replace resource URIs with your canonical asset system as needed.',
    parameters: GetCodeParametersSchema,
    target: 'extension',
    format: createCodeToolResponse
  }),
  extTool({
    name: 'get_token_defs',
    description:
      'Resolve canonical token names to values (including modes) for tokens referenced by get_code. Use this to map into your design token/theming system, including responsive tokens.',
    parameters: GetTokenDefsParametersSchema,
    target: 'extension',
    exposed: false
  }),
  extTool({
    name: 'get_screenshot',
    description:
      'Capture a rendered screenshot for a nodeId/current selection for visual verification. Useful for confirming layering/overlap/masks/shadows/translucency when auto-layout hints are none/inferred.',
    parameters: GetScreenshotParametersSchema,
    target: 'extension',
    format: createScreenshotToolResponse
  }),
  extTool({
    name: 'get_structure',
    description:
      'Get a structural + geometry outline for a nodeId/current selection to understand hierarchy and layout intent. Use when auto-layout hints are none/inferred or you need explicit bounds for refactors/component extraction.',
    parameters: GetStructureParametersSchema,
    target: 'extension'
  }),
  hubTool({
    name: 'get_assets',
    description:
      'Resolve asset hashes to downloadable URLs/URIs for assets referenced by get_code, preserving vectors exactly. Pull bytes before routing through your asset/icon pipeline.',
    parameters: GetAssetsParametersSchema,
    target: 'hub',
    outputSchema: GetAssetsResultSchema,
    exposed: false
  })
] as const

function createToolErrorResponse(toolName: string, error: unknown): CallToolResult {
  const message =
    error instanceof Error
      ? error.message || 'Unknown error occurred.'
      : typeof error === 'string'
        ? error
        : 'Unknown error occurred.'
  return {
    content: [
      {
        type: 'text' as const,
        text: `Tool "${toolName}" failed: ${message}`
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
  const usedTokenCount = payload.tokens?.used ? Object.keys(payload.tokens.used).length : 0
  const resolvedTokenCount = payload.tokens?.resolved
    ? Object.keys(payload.tokens.resolved).length
    : 0
  if (usedTokenCount) {
    summary.push(`Token references included: ${usedTokenCount}.`)
  }
  if (resolvedTokenCount) {
    summary.push(`Resolved token values included: ${resolvedTokenCount}.`)
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
