import { FigmaSessionSchema, TerminalReceiptSchema } from '@tempad-dev/shared'
import { z } from 'zod'

export const ExecutionSchema = z.object({
  id: z.string().min(1),
  revision: z.uuid(),
  recordedAt: z.number().nonnegative(),
  receipt: TerminalReceiptSchema,
  extensionId: z.string(),
  browserId: z.string(),
  origin: z.string(),
  session: FigmaSessionSchema,
  taskId: z.string().optional(),
  epoch: z.number().int().nonnegative().optional(),
  handoff: z.boolean(),
  abandonedAt: z.number().nonnegative().optional()
})
export type Execution = z.infer<typeof ExecutionSchema>

// Older readers retain an incompatible per-file fence instead of forgetting
// that JavaScript may still be running in a disconnected browser.
export const ExecutionMarkerSchema = z
  .object({
    execution: ExecutionSchema,
    task: z.object({ target: z.object({ fileKey: z.string().min(1) }) })
  })
  .refine(({ execution, task }) => execution.session.fileKey === task.target.fileKey)
