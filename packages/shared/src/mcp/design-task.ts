import { z } from 'zod'

// Only task work renews this lease. Transport pings and UI polling never do.
export const MCP_DESIGN_TASK_LEASE_MS = 5 * 60_000

export const DesignTaskIdSchema = z.string().min(1).max(128)
export const DesignTaskParameterSchema = DesignTaskIdSchema.describe(
  'Task id returned by begin_design. Pass it on every call belonging to that design task; omit for independent reads.'
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
export type AgentClientKind = z.infer<typeof AgentClientKindSchema>

// Integration support is stable; live capabilities decide whether an action can run now.
export const AGENT_CLIENTS = {
  'codex-app': { name: 'Codex App', feedback: true },
  'codex-cli': { name: 'Codex CLI', feedback: false },
  codex: { name: 'Codex', feedback: true },
  claude: { name: 'Claude', feedback: false },
  other: { name: 'Agent', feedback: false },
  unknown: { name: 'Agent', feedback: false }
} as const satisfies Record<AgentClientKind, { name: string; feedback: boolean }>

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
    'Lease epoch returned by begin_design or resume_design. Required after resuming; stale epochs cannot write.'
  )

export const MCP_DESIGN_FEEDBACK_MAX_ITEMS = 20
export const MCP_DESIGN_FEEDBACK_MAX_TEXT = 32000
const FeedbackCommentSchema = z.string().trim().max(8000)

export const DesignFeedbackItemSchema = z
  .object({
    nodeId: z.string().min(1).max(128),
    nodeName: z.string().max(256),
    pageId: z.string().min(1).max(256),
    pageName: z.string().max(256).optional(),
    frame: z
      .object({
        nodeId: z.string().min(1).max(128),
        nodeName: z.string().max(256)
      })
      .strict()
      .optional(),
    text: z.string().trim().min(1).max(8000),
    createdAt: z.number().finite().nonnegative()
  })
  .strict()

export const DesignFeedbackSchema = z
  .object({
    id: z.string().uuid(),
    // Legacy submissions can contain Continue; restoring them must not discard saved drafts.
    mode: z.enum(['queue', 'steer', 'continue']),
    fileKey: z.string().min(1).max(256),
    comment: FeedbackCommentSchema.min(1).optional(),
    items: z.array(DesignFeedbackItemSchema).max(MCP_DESIGN_FEEDBACK_MAX_ITEMS),
    createdAt: z.number().finite().nonnegative()
  })
  .strict()
  .refine((value) => value.items.length > 0 || !!value.comment, {
    message: 'Add a general comment or at least one element comment.'
  })
  .refine((value) => new Set(value.items.map((item) => item.nodeId)).size === value.items.length, {
    message: 'Each element can appear only once in a feedback batch.'
  })
  .refine(
    (value) =>
      value.items.reduce((length, item) => length + item.text.length, value.comment?.length ?? 0) <=
      MCP_DESIGN_FEEDBACK_MAX_TEXT,
    { message: 'The feedback batch is too long.' }
  )

export const FeedbackDraftScopeSchema = z
  .object({
    taskId: DesignTaskIdSchema,
    fileKey: z.string().min(1).max(256),
    clientKind: AgentClientSchema.shape.kind,
    conversationId: z.string().min(1).max(256)
  })
  .strict()

export const FeedbackDraftSnapshotSchema = z
  .object({
    items: z.array(DesignFeedbackItemSchema).max(MCP_DESIGN_FEEDBACK_MAX_ITEMS),
    comment: FeedbackCommentSchema.min(1).optional(),
    submission: DesignFeedbackSchema.optional()
  })
  .strict()

export const FeedbackDraftRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('load'), scope: FeedbackDraftScopeSchema }).strict(),
  z.object({ operation: z.literal('clear'), scope: FeedbackDraftScopeSchema }).strict(),
  z
    .object({
      operation: z.literal('comment'),
      scope: FeedbackDraftScopeSchema,
      comment: FeedbackCommentSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('save'),
      scope: FeedbackDraftScopeSchema,
      item: DesignFeedbackItemSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('remove'),
      scope: FeedbackDraftScopeSchema,
      nodeId: z.string().min(1).max(128)
    })
    .strict()
])

export const DesignActionSchema = z
  .object({
    requestId: z.string().uuid(),
    taskId: DesignTaskIdSchema,
    epoch: z.number().int().nonnegative(),
    action: z.enum(['stop', 'done', 'feedback', 'steer']),
    feedback: DesignFeedbackSchema.optional(),
    feedbackId: z.string().uuid().optional()
  })
  .strict()
  .refine((value) => (value.action === 'feedback') === !!value.feedback, {
    message: 'Feedback is required only for a feedback action.'
  })
  .refine((value) => !value.feedback || value.feedback.id === value.requestId, {
    message: 'Feedback and delivery must use the same request identity.'
  })
  .refine((value) => (value.action === 'steer') === !!value.feedbackId, {
    message: 'A queued feedback identity is required only when switching to Steer.'
  })
  .refine((value) => value.feedbackId !== value.requestId, {
    message: 'A delivery timing change must have its own request identity.'
  })

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

export const BeginDesignParametersSchema = z
  .object({
    title: z.string().trim().min(1).max(120).describe('Short task title for the Figma UI.'),
    sessionId: z
      .string()
      .min(1)
      .optional()
      .describe('Exact target from list_design_sessions; omit to use the activated Figma session.'),
    requestId: z
      .string()
      .uuid()
      .describe(
        'Generate a fresh UUID for this task. Reuse it only to retry the same begin request.'
      )
  })
  .strict()

export const ResumeDesignParametersSchema = z
  .object({
    taskId: DesignTaskIdSchema.describe(
      'Current task to continue after pause, expiry, interruption, or completion awaiting review. Closed, cancelled, and replaced tasks cannot resume.'
    ),
    epoch: z.number().int().nonnegative()
  })
  .strict()

export const SetDesignAnchorParametersSchema = z
  .object({
    taskId: DesignTaskIdSchema,
    taskEpoch: DesignTaskEpochSchema,
    nodeId: z
      .string()
      .min(1)
      .describe(
        'Exact existing Frame to use as this task’s stable design region. Does not select, move, or modify it.'
      )
  })
  .strict()

export const DesignAnchorSchema = z
  .object({ nodeId: z.string().min(1), pageId: z.string().min(1) })
  .strict()
export type DesignAnchor = z.infer<typeof DesignAnchorSchema>

export const EndDesignParametersSchema = z
  .object({
    taskId: DesignTaskIdSchema,
    taskEpoch: DesignTaskEpochSchema,
    outcome: z.enum(['completed', 'cancelled']).default('completed'),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .optional()
      .describe(
        'Optional brief explanation of the result for the user. Describe applied changes, not a proposal or live progress.'
      )
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

export type FigmaSession = z.infer<typeof FigmaSessionSchema>
export type DesignTask = z.infer<typeof DesignTaskSchema>
/** A task in one of these statuses can be resumed; the Hub and the canvas UI gate on the same set. */
export const RESUMABLE_DESIGN_TASK_STATUSES: readonly DesignTask['status'][] = [
  'paused',
  'expired',
  'interrupted',
  'completed'
]
export type DesignTaskTarget = z.infer<typeof DesignTaskTargetSchema>
export type DesignToolRoute = z.infer<typeof DesignToolRouteSchema>
export type BeginDesignParameters = z.infer<typeof BeginDesignParametersSchema>
export type EndDesignParameters = z.infer<typeof EndDesignParametersSchema>

export type AgentClient = z.infer<typeof AgentClientSchema>
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>
export type DesignFeedback = z.infer<typeof DesignFeedbackSchema>
export type DesignFeedbackItem = z.infer<typeof DesignFeedbackItemSchema>
export type FeedbackDraftScope = z.infer<typeof FeedbackDraftScopeSchema>
export type FeedbackDraftSnapshot = z.infer<typeof FeedbackDraftSnapshotSchema>
export type FeedbackDraftRequest = z.infer<typeof FeedbackDraftRequestSchema>
export type DesignAction = z.infer<typeof DesignActionSchema>
export type DesignActionResult = z.infer<typeof DesignActionResultSchema>
export type ResumeDesignParameters = z.infer<typeof ResumeDesignParametersSchema>

export function formatDesignFeedback(feedback: DesignFeedback): string {
  // Names are captured context; comments are the user's own Markdown.
  const label = (text: string) => text.replace(/\r\n|\r|\n/g, ' ').replace(/[\\[\]`*_<>&]/g, '\\$&')
  const encode = (text: string) =>
    encodeURIComponent(text).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
  const sections = feedback.comment ? [feedback.comment] : []
  feedback.items.forEach((item, index) => {
    const prefix = `${index + 1}. `
    const url = `https://www.figma.com/design/${encode(feedback.fileKey)}?node-id=${encode(item.nodeId)}&page-id=${encode(item.pageId)}`
    const comment = item.text
      .split(/\r\n|\r|\n/)
      .map((line) => `${' '.repeat(prefix.length)}${line}`)
      .join('\n')
    sections.push(`${prefix}[${label(item.nodeName) || 'Unnamed element'}](${url})\n\n${comment}`)
  })
  return sections.join('\n\n')
}
