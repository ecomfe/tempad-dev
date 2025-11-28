import { z } from 'zod'

// get_code
export const GetCodeParametersSchema = z.object({
  nodeId: z.string().optional(),
  preferredLang: z.enum(['jsx', 'vue']).optional()
})

export type GetCodeParametersInput = z.input<typeof GetCodeParametersSchema>
export type GetCodeResult = {
  code: string
  lang: 'vue' | 'jsx'
  message?: string
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
  dataUrl: string
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
