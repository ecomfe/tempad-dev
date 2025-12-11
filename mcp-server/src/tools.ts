import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZodType } from 'zod'

import { z } from 'zod'

import type { AssetDescriptor } from '../../mcp/shared/types'

import { MCP_HASH_PATTERN } from '../../mcp/shared/constants'

export type { AssetDescriptor }

// get_code
export const GetCodeParametersSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'Optional target node id; omit to use the current single selection when pulling the baseline snapshot.'
    )
    .optional(),
  preferredLang: z
    .enum(['jsx', 'vue'])
    .describe(
      'Preferred output language to bias the snapshot; otherwise uses the design’s hint/detected language, then falls back to JSX.'
    )
    .optional(),
  resolveTokens: z
    .boolean()
    .describe(
      'Inline token values instead of references for quick renders; default false returns token metadata so you can map into your theming system.'
    )
    .optional()
})

export type GetCodeParametersInput = z.input<typeof GetCodeParametersSchema>
export type GetCodeResult = {
  code: string
  lang: 'vue' | 'jsx'
  message?: string
  usedTokens?: GetTokenDefsResult
  assets: AssetDescriptor[]
  codegen: {
    preset: string
    config: {
      cssUnit: 'px' | 'rem'
      rootFontSize: number
      scale: number
    }
  }
}

// get_token_defs
export const GetTokenDefsParametersSchema = z.object({
  names: z
    .array(z.string().regex(/^--[a-zA-Z0-9-_]+$/))
    .min(1)
    .describe(
      'Canonical token names (CSS variable form) from get_code.usedTokens or your own list to resolve, e.g., --color-primary.'
    ),
  includeAllModes: z
    .boolean()
    .describe(
      'Include all token modes (light/dark/etc.) instead of just the active one to mirror responsive tokens; default false.'
    )
    .optional()
})

export type GetTokenDefsParametersInput = z.input<typeof GetTokenDefsParametersSchema>
export type TokenEntry = {
  kind: 'color' | 'number' | 'string' | 'boolean'
  value: string | Record<string, string> // single mode -> string; multi-mode -> map (mode name -> literal or alias)
  resolvedValue: string // value for the active mode (or the single mode)
  activeMode?: string // only present when multi-mode map is returned
}

export type GetTokenDefsResult = {
  tokens: Record<string, TokenEntry>
}

export const AssetDescriptorSchema = z.object({
  hash: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  resourceUri: z.string().regex(/^asset:\/\/tempad\/[a-f0-9]{8}$/i),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
})

// get_screenshot
export const GetScreenshotParametersSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'Optional node id to screenshot; defaults to the current single selection. Useful when layout/overlap is uncertain (auto-layout none/inferred).'
    )
    .optional()
})

export type GetScreenshotParametersInput = z.input<typeof GetScreenshotParametersSchema>
export type GetScreenshotResult = {
  format: 'png'
  width: number
  height: number
  scale: number
  bytes: number
  asset: AssetDescriptor
}

// get_structure
export const GetStructureParametersSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'Optional node id to outline; defaults to the current single selection. Useful when auto-layout hints are none/inferred or you need explicit geometry for refactors.'
    )
    .optional(),
  options: z
    .object({
      depth: z
        .number()
        .int()
        .positive()
        .describe('Limit traversal depth; defaults to full tree (subject to safety caps).')
        .optional()
    })
    .optional()
})

export type GetStructureParametersInput = z.input<typeof GetStructureParametersSchema>
export type OutlineNode = {
  id: string
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  children?: OutlineNode[]
}
export type GetStructureResult = {
  roots: OutlineNode[]
}

// get_assets (hub only)
export const GetAssetsParametersSchema = z.object({
  hashes: z
    .array(z.string().regex(MCP_HASH_PATTERN))
    .min(1)
    .describe(
      'Asset hashes returned from get_code (or other tools) to download/resolve exact bytes for rasterized images or SVGs before routing through your asset pipeline.'
    )
})

export const GetAssetsResultSchema = z.object({
  assets: z.array(AssetDescriptorSchema),
  missing: z.array(z.string().min(1))
})

export type GetAssetsParametersInput = z.input<typeof GetAssetsParametersSchema>
export type GetAssetsResult = z.infer<typeof GetAssetsResultSchema>

export type ToolResultMap = {
  get_code: GetCodeResult
  get_token_defs: GetTokenDefsResult
  get_screenshot: GetScreenshotResult
  get_structure: GetStructureResult
  get_assets: GetAssetsResult
}

export type ToolName = keyof ToolResultMap

export { default as MCP_INSTRUCTIONS } from './instructions.md'

type BaseToolMetadata<Name extends ToolName, Schema extends ZodType> = {
  name: Name
  description: string
  parameters: Schema
  exposed?: boolean
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
      'Get a high-fidelity code snapshot for a nodeId/current selection, including assets/usedTokens and codegen preset/config. Start here, then refactor into your component/styling/file/naming conventions; strip any data-* hints. If no data-hint-auto-layout is present, layout is explicit; if any hint is none/inferred, pair with get_structure/get_screenshot to confirm hierarchy/overlap. Use data-hint-component plus repetition to decide on reusable components. Replace resource URIs with your canonical asset system as needed.',
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
  if (payload.message) {
    summary.push(payload.message)
  }
  summary.push(
    payload.assets.length
      ? `Assets attached: ${payload.assets.length}. Fetch bytes via resources/read using resourceUri.`
      : 'No binary assets were attached to this response.'
  )
  const tokenCount = payload.usedTokens ? Object.keys(payload.usedTokens.tokens ?? {}).length : 0
  if (tokenCount) {
    summary.push(`Token references included: ${tokenCount}.`)
  }
  summary.push('Read structuredContent for the full code string and asset metadata.')

  const assetLinks =
    payload.assets.length > 0
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
    Array.isArray(candidate.assets)
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
