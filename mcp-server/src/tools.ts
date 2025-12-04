import { z } from 'zod'

import type { AssetDescriptor } from '../../mcp/shared/types'

import { MCP_HASH_PATTERN } from '../../mcp/shared/constants'

export type { AssetDescriptor }

// get_code
export const GetCodeParametersSchema = z.object({
  nodeId: z.string().optional(),
  preferredLang: z.enum(['jsx', 'vue']).optional(),
  resolveTokens: z.boolean().optional()
})

export type GetCodeParametersInput = z.input<typeof GetCodeParametersSchema>
export type GetCodeResult = {
  code: string
  lang: 'vue' | 'jsx'
  message?: string
  usedTokens?: GetTokenDefsResult['tokens']
  assets: AssetDescriptor[]
}

// get_token_defs
export const GetTokenDefsParametersSchema = z.object({
  nodeId: z.string().optional()
})

export type GetTokenDefsParametersInput = z.input<typeof GetTokenDefsParametersSchema>
export type GetTokenDefsResult = {
  tokens: Array<{
    name: string
    value: string | Record<string, unknown>
    kind: 'color' | 'spacing' | 'typography' | 'effect' | 'other'
  }>
}

export const AssetDescriptorSchema = z.object({
  hash: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  resourceUri: z.string().regex(/^asset:\/\/tempad\/[a-f0-9]{64}$/i),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
})

// get_screenshot
export const GetScreenshotParametersSchema = z.object({
  nodeId: z.string().optional()
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
  nodeId: z.string().optional(),
  options: z
    .object({
      depth: z.number().int().positive().optional()
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
  hashes: z.array(z.string().regex(MCP_HASH_PATTERN)).min(1)
})

export const GetAssetsResultSchema = z.object({
  assets: z.array(AssetDescriptorSchema),
  missing: z.array(z.string().min(1))
})

export type GetAssetsParametersInput = z.input<typeof GetAssetsParametersSchema>
export type GetAssetsResult = z.infer<typeof GetAssetsResultSchema>

export const TOOLS = [
  {
    name: 'get_code',
    description: 'High fidelity code snapshot for the current selection or provided node ids.',
    parameters: GetCodeParametersSchema
  },
  {
    name: 'get_token_defs',
    description: 'Token definitions referenced by the current selection or provided node ids.',
    parameters: GetTokenDefsParametersSchema
  },
  {
    name: 'get_screenshot',
    description: 'Rendered screenshot for the requested node.',
    parameters: GetScreenshotParametersSchema
  },
  {
    name: 'get_structure',
    description: 'Structural outline of the current selection or provided node ids.',
    parameters: GetStructureParametersSchema
  }
] as const

export type ToolName = (typeof TOOLS)[number]['name']

export type ToolResultMap = {
  get_code: GetCodeResult
  get_token_defs: GetTokenDefsResult
  get_screenshot: GetScreenshotResult
  get_structure: GetStructureResult
}
