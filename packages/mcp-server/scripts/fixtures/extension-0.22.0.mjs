import { z } from 'zod'

import {
  DesignTaskSchema,
  DesignToolRouteSchema,
  DesignActionResultSchema,
  DesignTaskParameterSchema,
  DesignTaskEpochSchema
} from './protocol-13-design-task.mjs'

// Frozen receiving schemas from 126d307e (extension 0.22.0 / MCP 0.10.0).
// Preserve the released schemas; never derive this peer from the current shared package.
export const RegisteredMessageSchema = z.object({
  type: z.literal('registered'),
  id: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  supportedProtocolVersions: z.array(z.number().int().positive()).min(1).optional()
})

export const StateMessageSchema = z.object({
  type: z.literal('state'),
  activeId: z.string().nullable(),
  assetServerUrl: z.string().url()
})

export const ToolCallPayloadSchema = z.object({
  name: z.string(),
  args: z.unknown()
})

export const ToolCallMessageSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string().min(1),
  route: DesignToolRouteSchema.optional(),
  payload: ToolCallPayloadSchema
})

export const DesignTaskStateMessageSchema = z.object({
  type: z.literal('designTaskState'),
  task: DesignTaskSchema
})

export const DesignActionResultMessageSchema = z.object({
  type: z.literal('designActionResult'),
  sessionId: z.string().min(1),
  result: DesignActionResultSchema
})

export const MessageToExtensionSchema = z.discriminatedUnion('type', [
  DesignActionResultMessageSchema,
  RegisteredMessageSchema,
  StateMessageSchema,
  DesignTaskStateMessageSchema,
  ToolCallMessageSchema
])

export const CanvasStableKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w./:-]+$/, 'Use a stable key containing letters, numbers, ., /, :, _, or -.')

const ExactReadSessionParameterSchema = z
  .string()
  .min(1)
  .describe('Exact sessionId from list_design_sessions; omit for the active badge target.')
  .optional()

export const GetCodeParametersSchema = z.object({
  taskId: DesignTaskParameterSchema,
  taskEpoch: DesignTaskEpochSchema,
  sessionId: ExactReadSessionParameterSchema,
  nodeId: z
    .string()
    .describe('Optional exact target node id; omit to use the current single selection.')
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
      'Inline token values instead of references for quick renders; default false returns token metadata plus bounded repeated-unbound-color diagnostics so you can reconcile the theming system. When true, values are resolved per-node (mode-aware) and literal diagnostics are omitted.'
    )
    .optional(),
  vectorMode: z
    .enum(['smart', 'snapshot'])
    .describe(
      'Vector output mode. `smart` (default) emits `<svg data-src="...">` placeholders in code and preserves themeable instance color on the emitted SVG root markup for downstream adaptation; if asset upload fails after export, the tool may inline the SVG as a fallback to preserve source of truth. `snapshot` preserves vector assets for fidelity. Final vector delivery may still be adapted to the Host app’s SVG policy.'
    )
    .optional()
})

export const GetScreenshotParametersSchema = z.object({
  taskId: DesignTaskParameterSchema,
  taskEpoch: DesignTaskEpochSchema,
  sessionId: ExactReadSessionParameterSchema,
  nodeId: z
    .string()
    .describe('Optional exact node id to render; omit to use the current single selection.')
    .optional()
})

export const GetStructureParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: ExactReadSessionParameterSchema,
    nodeId: z
      .string()
      .describe(
        'Optional node id to outline; defaults to the current single selection when no page identity is supplied.'
      )
      .optional(),
    pageId: z.string().min(1).describe('Exact local page id to outline.').optional(),
    pageKey: CanvasStableKeySchema.describe(
      'Exact stable key of a local page authored through apply_canvas.'
    ).optional(),
    options: z
      .object({
        depth: z
          .number()
          .int()
          .positive()
          .describe(
            'Positive integer; 1 is the shallowest traversal (root plus direct children). Omit for the full tree, subject to safety caps.'
          )
          .optional(),
        native: z
          .boolean()
          .describe(
            'Include compact native read-back for masks, IMAGE paint hashes, layout grids, and frame guides.'
          )
          .optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    const identities = [value.nodeId, value.pageId, value.pageKey].filter(
      (identity) => identity !== undefined
    )
    if (identities.length <= 1) return
    context.addIssue({
      code: 'custom',
      message: 'Use only one of nodeId, pageId, or pageKey.'
    })
  })
