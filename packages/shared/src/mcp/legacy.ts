import { z } from 'zod'

// Extension 0.20.0 / MCP 0.7.1 contract, from 7cfcb877d673c0eb161bbac04fc87435a4ce4672.
// Freeze these fields rather than deriving them from evolving current tool schemas.
// Strict parsing deliberately rejects newer arguments instead of silently ignoring them.
export const LegacyToolCallPayloadSchema = z.discriminatedUnion('name', [
  z
    .object({
      name: z.literal('get_code'),
      args: z
        .object({
          nodeId: z.string().optional(),
          preferredLang: z.enum(['jsx', 'vue']).optional(),
          resolveTokens: z.boolean().optional(),
          vectorMode: z.enum(['smart', 'snapshot']).optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      name: z.literal('get_structure'),
      args: z
        .object({
          nodeId: z.string().optional(),
          options: z.object({ depth: z.number().int().positive().optional() }).strict().optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      name: z.literal('get_screenshot'),
      args: z.object({ nodeId: z.string().optional() }).strict()
    })
    .strict(),
  z
    .object({
      name: z.literal('get_token_defs'),
      args: z
        .object({
          names: z.array(z.string().regex(/^--[a-zA-Z0-9-_]+$/)).min(1),
          includeAllModes: z.boolean().optional()
        })
        .strict()
    })
    .strict()
])
