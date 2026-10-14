import type { DesignTask } from '@tempad-dev/shared'

import { DesignTaskSchema } from '@tempad-dev/shared'

import { createSerialQueue } from './serial'

const KEY = 'tempad.design-reviews.v1'
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

  constructor(private readonly storage: Storage) {}

  get(fileKey: string): DesignTask | undefined {
    return this.tasks.get(fileKey)
  }

  ready(): Promise<void> {
    return this.serial(() => this.load())
  }

  restore(saved: DesignTask): Promise<void> {
    return this.serial(async () => {
      await this.load(saved)
      const previous = this.tasks.get(saved.target.fileKey)
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
    })
  }

  save(task: DesignTask): Promise<DesignTask> {
    return this.serial(async () => {
      await this.load(task)
      const previous = this.tasks.get(task.target.fileKey)
      if (previous?.taskId === task.taskId) {
        if (previous.reviewClosed) task = { ...task, reviewClosed: true }
        if (previous.status === 'cancelled')
          task = { ...task, status: 'cancelled', operation: null }
        if (!this.pendingStop && JSON.stringify(previous) === JSON.stringify(task)) return previous
      }
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
    await persist({ [KEY]: [...next.values()] })
    this.tasks.set(task.target.fileKey, task)
    this.pendingStop = false
    return task
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
        const parsed = DesignTaskSchema.strip().safeParse(value)
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
