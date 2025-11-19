import { z } from 'zod'

export const GetCodeParametersSchema = z.object({
  output: z.enum(['css', 'js']).optional().default('css')
})

export type GetCodeParametersInput = z.input<typeof GetCodeParametersSchema>
export type GetCodeResult = {
  code: Record<string, string>
}

export const TOOLS = [
  {
    name: 'get_code',
    description: 'Returns generated code for the currently selected node.',
    parameters: GetCodeParametersSchema
  }
] as const
