// Frozen receiving-schema dependencies from 126d307e (extension 0.22.0 / MCP 0.10.0).
// TypeScript types and unused definitions removed; retained schemas are unchanged.
// Do not replace these schemas with imports from current shared code.
import { z } from 'zod'

export const DesignTaskIdSchema = z.string().min(1).max(128)
export const DesignTaskParameterSchema = DesignTaskIdSchema.describe(
  'Task id returned by manage_design_task. Pass it on every call belonging to that design task; omit for independent reads.'
).optional()

export const FigmaSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    fileKey: z.string().min(1).max(256),
    fileName: z.string().max(256),
    pageId: z.string().min(1),
    busy: z.boolean(),
    tabId: z.number().int().nonnegative().optional(),
    documentId: z.string().min(1).optional()
  })
  .strict()

export const DesignTaskTargetSchema = FigmaSessionSchema.omit({
  busy: true,
  tabId: true,
  documentId: true
})

export const AgentClientKindSchema = z.enum([
  'codex-app',
  'codex-cli',
  'codex',
  'claude',
  'other',
  // Legacy tasks and persisted draft scopes retain their original identity.
  'unknown'
])

export const AgentClientSchema = z
  .object({
    kind: AgentClientKindSchema,
    name: z.string().min(1).max(80),
    sessionId: z.string().min(1).max(256).optional()
  })
  .strict()

export const AgentCapabilitiesSchema = z
  .object({
    // Keep older task payloads readable; the hook transport never enables these controls.
    interrupt: z.boolean(),
    queue: z.boolean(),
    steer: z.boolean(),
    continue: z.boolean(),
    queueDelivery: z.enum(['native', 'turn-end']).optional(),
    steerDelivery: z.enum(['native', 'next-tool']).optional(),
    reason: z.string().max(240).optional()
  })
  .strict()

export const DesignTaskEpochSchema = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe(
    'Lease epoch returned by manage_design_task. Required after resuming; stale epochs cannot write.'
  )

export const DesignActionResultSchema = z
  .object({
    requestId: z.string().uuid(),
    taskId: DesignTaskIdSchema,
    status: z.enum(['accepted', 'delivered', 'failed']),
    message: z.string().max(500)
  })
  .strict()

export const DesignTaskSchema = z
  .object({
    taskId: DesignTaskIdSchema,
    title: z.string().trim().min(1).max(120),
    target: DesignTaskTargetSchema,
    status: z.enum([
      'active',
      'stopping',
      'paused',
      'completed',
      'cancelled',
      'expired',
      'interrupted'
    ]),
    epoch: z.number().int().nonnegative().optional(),
    reviewClosed: z
      .boolean()
      .optional()
      .describe(
        'User closed this review with Done. A completed task remains resumable until then, while it is still the current task.'
      ),
    client: AgentClientSchema.optional(),
    capabilities: AgentCapabilitiesSchema.optional(),
    needsRead: z.boolean().optional(),
    result: z
      .object({
        nodeIds: z.array(z.string().min(1)).max(20),
        summary: z.string().trim().max(400).optional(),
        capturedAt: z.number().finite().nonnegative()
      })
      .strict()
      .optional(),
    operation: z.enum(['reading', 'writing']).nullable(),
    expiresAt: z.number().finite().nonnegative(),
    revision: z.number().int().nonnegative()
  })
  .strict()

// The broker and page both check this route. A new Hub connection or page runtime
// cannot inherit delayed requests from an earlier connection.
export const DesignToolRouteSchema = z
  .object({
    sessionId: z.string().min(1),
    fileKey: z.string().min(1),
    gatewayId: z.string().min(1),
    taskId: DesignTaskIdSchema.optional(),
    epoch: z.number().int().nonnegative().optional()
  })
  .strict()
