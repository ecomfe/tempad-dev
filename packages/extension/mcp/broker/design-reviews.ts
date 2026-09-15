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
      // A stale page cannot override the durable latest review or its Done fence.
      if (!this.tasks.has(saved.target.fileKey)) {
        this.tasks.set(saved.target.fileKey, saved)
        await this.write()
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
      const next = new Map(this.tasks).set(task.target.fileKey, task)
      await this.storage.set({ [KEY]: [...next.values()] })
      this.tasks.set(task.target.fileKey, task)
      return task
    })
  }

  close(
    task: DesignTask,
    persist: (values: Record<string, unknown>) => Promise<void> = (values) =>
      this.storage.set(values)
  ): Promise<DesignTask> {
    return this.serial(async () => {
      await this.load()
      const previous = this.tasks.get(task.target.fileKey)
      if (previous && previous.taskId !== task.taskId)
        throw new Error('This review has been replaced by a newer task.')
      const closed = { ...task, reviewClosed: true }
      // Publish the local fence only after durable storage acknowledges it.
      const next = new Map(this.tasks).set(task.target.fileKey, closed)
      await persist({ [KEY]: [...next.values()] })
      this.tasks.set(task.target.fileKey, closed)
      return closed
    })
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    const values = (await this.storage.get(KEY))[KEY]
    if (values !== undefined)
      for (const value of DesignTaskSchema.array().parse(values))
        this.tasks.set(value.target.fileKey, value)
    this.loaded = true
  }

  private write(): Promise<void> {
    return this.storage.set({ [KEY]: [...this.tasks.values()] })
  }
}
