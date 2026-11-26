import { z } from 'zod'

// Frozen receiver from extension 1.0.0 (9fca3182 and the release ZIP).
// ZIP SHA-256: e4fe0d6ce7a78291952e136b706b24254d6724a9cc5ea6e258e31efa9ac6376f.
// Keep independent of the current shared package so wire and argument drift fails the check.
export const releasedHello = {
  type: 'runtimeHello',
  protocolVersion: 15,
  extensionVersion: '1.0.0',
  extensionRuntimeFingerprint: '322a1a4661b746177d63b370aea7be6d02e543e499e7cdce16ccefd3ba7617f1'
}

export function releasedHelloAfterRegistration(registration) {
  return {
    ...releasedHello,
    ...(registration.terminalReceiptGeneration ? { terminalReceipts: true } : {}),
    ...(registration.durableTerminalReceipts ? { durableTerminalReceipts: true } : {})
  }
}

const DesignTaskIdSchema = z.string().min(1).max(128)
const DesignTaskParameterSchema = DesignTaskIdSchema.optional()

const FigmaSessionSchema = z
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

const DesignTaskTargetSchema = FigmaSessionSchema.omit({
  busy: true,
  tabId: true,
  documentId: true
})

const AgentClientKindSchema = z.enum([
  'codex-app',
  'codex-cli',
  'codex',
  'claude',
  'other',
  // Legacy tasks and persisted draft scopes retain their original identity.
  'unknown'
])

const AgentClientSchema = z
  .object({
    kind: AgentClientKindSchema,
    name: z.string().min(1).max(80),
    sessionId: z.string().min(1).max(256).optional()
  })
  .strict()

const AgentCapabilitiesSchema = z
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

const DesignTaskEpochSchema = z.number().int().nonnegative().optional()

const DesignActionResultSchema = z
  .object({
    requestId: z.string().uuid(),
    taskId: DesignTaskIdSchema,
    status: z.enum(['accepted', 'delivered', 'failed']),
    message: z.string().max(500)
  })
  .strict()

const DesignTaskSchema = z
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
    reviewClosed: z.boolean().optional(),
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

const DesignToolRouteSchema = z
  .object({
    sessionId: z.string().min(1),
    fileKey: z.string().min(1),
    gatewayId: z.string().min(1),
    taskId: DesignTaskIdSchema.optional(),
    epoch: z.number().int().nonnegative().optional()
  })
  .strict()

const RuntimeProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('release') }).strict(),
  z.object({ kind: z.literal('checkout'), id: z.string().regex(/^[a-f0-9]{16}$/) }).strict()
])

const RegisteredMessageSchema = z.object({
  type: z.literal('registered'),
  id: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  supportedProtocolVersions: z.array(z.number().int().positive()).min(1).optional(),
  runtimeProfile: RuntimeProfileSchema.optional(),
  terminalReceiptGeneration: z.string().min(1).max(128).optional(),
  durableTerminalReceipts: z.literal(true).optional()
})

const TerminalReceiptSchema = z
  .object({ generation: z.string().min(1).max(128), receiptId: z.string().min(1).max(128) })
  .strict()

const ToolCompletionMessageSchema = TerminalReceiptSchema.extend({
  type: z.literal('toolCompletion'),
  id: z.string().min(1).max(128)
}).strict()

const ToolCompletionAckMessageSchema = z.object({
  ...ToolCompletionMessageSchema.shape,
  type: z.literal('toolCompletionAck'),
  accepted: z.boolean()
})

const StateMessageSchema = z.object({
  type: z.literal('state'),
  activeId: z.string().nullable(),
  assetServerUrl: z.string().url()
})

const ToolCallPayloadSchema = z.object({
  name: z.string(),
  args: z.unknown()
})

const ToolCallMessageSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string().min(1),
  route: DesignToolRouteSchema.optional(),
  terminalReceipt: TerminalReceiptSchema.optional(),
  payload: ToolCallPayloadSchema
})

const DesignTaskStateMessageSchema = z.object({
  type: z.literal('designTaskState'),
  task: DesignTaskSchema
})

const DesignActionResultMessageSchema = z.object({
  type: z.literal('designActionResult'),
  sessionId: z.string().min(1),
  result: DesignActionResultSchema
})

export const MessageToExtensionSchema = z.discriminatedUnion('type', [
  ToolCompletionAckMessageSchema,
  DesignActionResultMessageSchema,
  RegisteredMessageSchema,
  StateMessageSchema,
  DesignTaskStateMessageSchema,
  ToolCallMessageSchema
])

const NodeIdParameterSchema = z.string().min(1).optional()
const NodeIdsParameterSchema = z.array(z.string().min(1)).min(1).optional()

function validateNodeTargets(value, context) {
  if (value.nodeId !== undefined && value.nodeIds !== undefined) {
    context.addIssue({ code: 'custom', message: 'Use only one of nodeId or nodeIds.' })
  }
}

const CanvasStableKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w./:-]+$/)

const ExactReadSessionParameterSchema = z.string().min(1).optional()

export const GetCodeParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: ExactReadSessionParameterSchema,
    nodeId: NodeIdParameterSchema,
    nodeIds: NodeIdsParameterSchema,
    preferredLang: z.enum(['jsx', 'vue']).optional(),
    resolveTokens: z.boolean().optional(),
    vectorMode: z.enum(['smart', 'snapshot']).optional()
  })
  .superRefine(validateNodeTargets)

export const GetScreenshotParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: ExactReadSessionParameterSchema,
    nodeId: NodeIdParameterSchema,
    nodeIds: NodeIdsParameterSchema
  })
  .superRefine(validateNodeTargets)

export const GetStructureParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: ExactReadSessionParameterSchema,
    nodeId: NodeIdParameterSchema,
    nodeIds: NodeIdsParameterSchema,
    pageId: z.string().min(1).optional(),
    pageKey: CanvasStableKeySchema.optional(),
    options: z
      .object({
        depth: z.number().int().nonnegative().optional(),
        native: z.boolean().optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    const identities = [value.nodeId, value.nodeIds, value.pageId, value.pageKey].filter(
      (identity) => identity !== undefined
    )
    if (identities.length <= 1) return
    context.addIssue({
      code: 'custom',
      message: 'Use only one of nodeId, nodeIds, pageId, or pageKey.'
    })
  })

export const GetDesignSystemParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: ExactReadSessionParameterSchema,
    scope: z.enum(['resources', 'fonts', 'pages']).optional(),
    pageId: z.string().min(1).optional(),
    query: z.string().trim().min(1).max(100).optional(),
    families: z.array(z.string().min(1)).min(1).max(8).optional(),
    catalogId: z.string().min(1).optional(),
    cursor: z.number().int().nonnegative().optional(),
    ref: z.string().min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (message, path) => context.addIssue({ code: 'custom', message, path: [path] })
    if (value.scope === 'pages') {
      if (value.catalogId || value.ref || value.pageId || value.query || value.families)
        issue('Page listing accepts only scope and cursor.', 'pageId')
      return
    }
    if (value.scope === 'fonts') {
      if (value.catalogId || value.ref)
        issue('Font queries cannot use resource catalog refs.', 'catalogId')
      if (value.pageId) issue('Font queries cannot use a component page.', 'pageId')
      if (value.query && value.families) issue('Use query or families, not both.', 'query')
      return
    }
    if (value.query || value.families) issue('Font filters require scope: fonts.', 'query')
    if (!value.catalogId) {
      if (value.cursor !== undefined) issue('cursor requires catalogId.', 'cursor')
      if (value.ref !== undefined) issue('ref requires catalogId.', 'ref')
      return
    }
    if ((value.cursor === undefined) === (value.ref === undefined)) {
      issue('Catalog reuse requires exactly one of cursor or ref.', 'catalogId')
    }
    if (value.pageId) issue('A component page cannot be changed within a catalog.', 'pageId')
  })
