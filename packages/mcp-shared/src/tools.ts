import type { ZodType } from 'zod'

import { z } from 'zod'

import { MCP_HASH_PATTERN } from './constants'

export const AssetDescriptorSchema = z.object({
  hash: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  resourceUri: z.string().regex(/^asset:\/\/tempad\/[a-f0-9]{8}$/i),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
})

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
      'Inline token values instead of references for quick renders; default false returns token metadata so you can map into your theming system. When true, values are resolved per-node (mode-aware).'
    )
    .optional()
})

export type GetCodeParametersInput = z.input<typeof GetCodeParametersSchema>
export type GetCodeWarning = {
  type: 'truncated' | 'auto-layout' | string
  message: string
  data?: Record<string, unknown>
}
export type GetCodeResult = {
  code: string
  lang: 'vue' | 'jsx'
  assets?: AssetDescriptor[]
  tokens?: GetTokenDefsResult
  codegen: {
    plugin: string
    config: {
      cssUnit: 'px' | 'rem'
      rootFontSize: number
      scale: number
    }
  }
  warnings?: GetCodeWarning[]
}

// get_token_defs
export const GetTokenDefsParametersSchema = z.object({
  names: z
    .array(z.string().regex(/^--[a-zA-Z0-9-_]+$/))
    .min(1)
    .describe(
      'Canonical token names (CSS variable form) from Object.keys(get_code.tokens) or your own list to resolve, e.g., --color-primary.'
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
}

export type GetTokenDefsResult = {
  [canonicalName: string]: TokenEntry
}

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

export type AssetDescriptor = z.infer<typeof AssetDescriptorSchema>

export type ToolResultMap = {
  get_code: GetCodeResult
  get_token_defs: GetTokenDefsResult
  get_screenshot: GetScreenshotResult
  get_structure: GetStructureResult
  get_assets: GetAssetsResult
}

export type ToolName = keyof ToolResultMap

export type ToolSchema<Name extends ToolName> = {
  name: Name
  description: string
  parameters: ZodType
  target: 'extension' | 'hub'
  outputSchema?: ZodType
  exposed?: boolean
}
