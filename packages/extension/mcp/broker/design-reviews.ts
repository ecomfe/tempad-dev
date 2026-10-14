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
      await this.load()
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
      await this.load()
      const previous = this.tasks.get(task.target.fileKey)
      if (previous?.taskId === task.taskId) {
        if (previous.reviewClosed) task = { ...task, reviewClosed: true }
        if (previous.status === 'cancelled')
          task = { ...task, status: 'cancelled', operation: null }
        if (JSON.stringify(previous) === JSON.stringify(task)) return previous
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
    // Publish the local state only after durable storage acknowledges it.
    const next = new Map(this.tasks).set(task.target.fileKey, task)
    await persist({ [KEY]: [...next.values()] })
    this.tasks.set(task.target.fileKey, task)
    return task
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    const values = (await this.storage.get(KEY))[KEY]
    if (Array.isArray(values))
      for (const value of values) {
        const parsed = DesignTaskSchema.strip().safeParse(value)
        if (parsed.success) this.tasks.set(parsed.data.target.fileKey, parsed.data)
      }
    this.loaded = true
  }
}
