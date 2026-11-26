import type { DesignTask } from '@tempad-dev/shared'

import {
  AgentCapabilitiesSchema,
  AgentClientSchema,
  DesignTaskSchema,
  DesignTaskTargetSchema
} from '@tempad-dev/shared'

import { createSerialQueue } from './serial'

const KEY = 'tempad.design-reviews.v1'
// Storage may contain additive fields from a newer version. Wire schemas stay strict.
const StoredTaskSchema = DesignTaskSchema.strip().extend({
  target: DesignTaskTargetSchema.strip(),
  client: AgentClientSchema.strip().optional(),
  capabilities: AgentCapabilitiesSchema.strip().optional()
})
type StoredReview = { value: unknown; task?: DesignTask }
type Storage = {
  get(key: string): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}

/** Latest review per file, including offline Done. Never contains write authority. */
export class DesignReviews {
  private readonly serial = createSerialQueue()
  private loaded = false
  private pendingStop = false
  private readonly tasks = new Map<string, DesignTask>()
  private readonly restoringStops = new Set<DesignTask>()
  private stored: StoredReview[] = []

  constructor(
    private readonly storage: Storage,
    private readonly liveTask?: (fileKey: string) => DesignTask | undefined
  ) {}

  get(fileKey: string, taskId = this.liveTask?.(fileKey)?.taskId): DesignTask | undefined {
    const latest = this.tasks.get(fileKey)
    const id = taskId ?? latest?.taskId
    const task = latest?.taskId === id ? latest : undefined
    for (const stop of this.restoringStops) {
      if (stop.target.fileKey === fileKey && (!id || stop.taskId === id))
        return {
          ...(task ?? stop),
          status: 'cancelled',
          operation: null,
          reviewClosed: task?.reviewClosed
        }
    }
    return task
  }

  preserveFences(task: DesignTask): DesignTask {
    const previous = this.get(task.target.fileKey, task.taskId)
    if (previous?.reviewClosed) task = { ...task, reviewClosed: true }
    if (previous?.status === 'cancelled') task = { ...task, status: 'cancelled', operation: null }
    return task
  }

  ready(): Promise<void> {
    return this.serial(() => this.load())
  }

  restore(saved: DesignTask): Promise<void> {
    const fileKey = saved.target.fileKey
    // The enable message is also the surviving page's Stop receipt. Apply its fence before
    // the first session inventory, including while earlier storage operations are in flight.
    if (saved.status === 'cancelled') this.restoringStops.add(saved)
    return this.serial(async () => {
      const current = this.liveTask?.(fileKey)
      if (current && current.taskId !== saved.taskId) return
      await this.load(saved)
      const stored = this.tasks.get(fileKey)
      // A newer Hub task may be live even though its storage write failed.
      const live = this.liveTask?.(fileKey)
      const previous = live && live.taskId !== stored?.taskId ? live : stored
      // A stale page cannot override the durable latest review or its Done fence.
      if (!previous) {
        await this.commit(saved)
      } else if (previous.taskId === saved.taskId && saved.status === 'cancelled') {
        await this.commit({
          ...previous,
          status: 'cancelled',
          operation: null
        })
      }
    }).finally(() => this.restoringStops.delete(saved))
  }

  save(task: DesignTask): Promise<DesignTask> {
    return this.serial(async () => {
      await this.load(task)
      const previous = this.tasks.get(task.target.fileKey)
      task = this.preserveFences(task)
      if (
        previous?.taskId === task.taskId &&
        !this.pendingStop &&
        JSON.stringify(previous) === JSON.stringify(task)
      )
        return previous
      return this.commit(task)
    })
  }

  close(
    task: DesignTask,
    persist?: (values: Record<string, unknown>) => Promise<void>
  ): Promise<DesignTask> {
    return this.serial(async () => {
      await this.load()
      const previous = this.tasks.get(task.target.fileKey)
      if (previous && previous.taskId !== task.taskId)
        throw new Error('This review has been replaced by a newer task.')
      if (previous?.status === 'cancelled') task = { ...task, status: 'cancelled', operation: null }
      return this.commit({ ...task, reviewClosed: true }, persist)
    })
  }

  private async commit(
    task: DesignTask,
    persist: (values: Record<string, unknown>) => Promise<void> = (values) =>
      this.storage.set(values)
  ): Promise<DesignTask> {
    // Stop remains fenced in this worker even if storage fails. Done still needs a durable receipt.
    this.rememberStop(task)
    const next = new Map(this.tasks).set(task.target.fileKey, task)
    const written = new Set<string>()
    const stored = this.stored.flatMap((entry): StoredReview[] => {
      if (!entry.task) return [entry]
      const updated = next.get(entry.task.target.fileKey)!
      if (updated.taskId !== entry.task.taskId) return []
      written.add(updated.target.fileKey)
      return [{ task: updated, value: mergeStoredTask(updated, entry.value) }]
    })
    for (const updated of next.values())
      if (!written.has(updated.target.fileKey)) stored.push({ task: updated, value: updated })
    await persist({ [KEY]: stored.map(({ value }) => value) })
    this.stored = stored
    this.tasks.set(task.target.fileKey, task)
    this.pendingStop = false
    return this.get(task.target.fileKey, task.taskId)!
  }

  private rememberStop(task: DesignTask): void {
    if (task.status !== 'cancelled') return
    const previous = this.tasks.get(task.target.fileKey)
    const stopped = {
      ...task,
      operation: null,
      reviewClosed: previous?.taskId === task.taskId ? previous.reviewClosed : undefined
    }
    if (JSON.stringify(previous) !== JSON.stringify(stopped)) this.pendingStop = true
    this.tasks.set(task.target.fileKey, stopped)
  }

  private async load(pending?: DesignTask): Promise<void> {
    if (this.loaded) return
    let values: unknown
    try {
      values = (await this.storage.get(KEY))[KEY]
    } catch (error) {
      if (pending) this.rememberStop(pending)
      throw error
    }
    if (Array.isArray(values))
      for (const value of values) {
        const parsed = StoredTaskSchema.safeParse(value)
        this.stored.push({ value, ...(parsed.success ? { task: parsed.data } : {}) })
        if (!parsed.success) continue
        const task = parsed.data
        const local = this.tasks.get(task.target.fileKey)
        this.tasks.set(
          task.target.fileKey,
          local?.taskId === task.taskId && local.status === 'cancelled'
            ? { ...task, status: 'cancelled', operation: null }
            : task
        )
      }
    this.loaded = true
  }
}

function extraFields(value: unknown, known: object): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => !Object.hasOwn(known, key)))
}

function mergeStoredTask(task: DesignTask, raw: unknown): unknown {
  const previous = raw as Record<string, unknown>
  return {
    ...extraFields(previous, DesignTaskSchema.shape),
    ...task,
    target: { ...extraFields(previous.target, DesignTaskTargetSchema.shape), ...task.target },
    ...(task.client
      ? { client: { ...extraFields(previous.client, AgentClientSchema.shape), ...task.client } }
      : {}),
    ...(task.capabilities
      ? {
          capabilities: {
            ...extraFields(previous.capabilities, AgentCapabilitiesSchema.shape),
            ...task.capabilities
          }
        }
      : {})
  }
}
