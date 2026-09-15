import type { DesignTask, DesignToolRoute, FigmaSession } from '@tempad-dev/shared'

import { DesignTaskSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { createCodedError } from './errors'

type Options = {
  session: () => FigmaSession | null
  now?: () => number
  onChange?: () => void
  stoppedStorage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined
}

const STOPPED_TASKS_KEY = 'tempad-dev:stopped-design-tasks'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Final page-side fence. Losing a lease never releases an executing operation. */
export class PageDesignTasks {
  task: DesignTask | null = null
  busy = false
  private gatewayId: string | null = null
  private revision = -1
  private readonly revoked = new Set<string>()
  private readonly stopped = new Set<string>()
  private readonly now: () => number

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now
    try {
      const saved: unknown = JSON.parse(
        options.stoppedStorage?.()?.getItem(STOPPED_TASKS_KEY) ?? '[]'
      )
      if (Array.isArray(saved))
        for (const id of saved
          .filter((value): value is string => typeof value === 'string')
          .slice(-256))
          this.stopped.add(id)
    } catch {
      // Unavailable tab storage must not prevent the local execution fence from starting.
    }
  }

  /** Restore this tab's review surface without granting a write lease. */
  restore(task: DesignTask): void {
    if (
      this.task ||
      task.target.fileKey !== this.options.session()?.fileKey ||
      task.status === 'cancelled' ||
      task.reviewClosed ||
      this.stopped.has(task.taskId)
    )
      return
    this.revoke(task.taskId, task.epoch)
    this.task = {
      ...task,
      status: ['active', 'stopping'].includes(task.status) ? 'interrupted' : task.status,
      operation: null
    }
    this.changed()
  }

  closeReview(taskId: string): void {
    if (this.task?.taskId !== taskId) return
    this.rememberStopped(taskId)
    this.revoke(taskId, this.task.epoch)
    this.task = { ...this.task, reviewClosed: true }
    this.changed()
  }

  acknowledge(taskId: string): void {
    if (this.task?.taskId !== taskId || !['completed', 'cancelled'].includes(this.task.status))
      return
    this.rememberStopped(taskId)
    this.revoke(taskId, this.task.epoch)
  }

  connect(gatewayId: string | null): void {
    if (gatewayId === this.gatewayId) return
    this.gatewayId = gatewayId
    this.revision = -1
    if (this.task && ['active', 'stopping'].includes(this.task.status)) {
      this.revoke(this.task.taskId, this.task.epoch)
      this.task = { ...this.task, status: this.busy ? 'stopping' : 'interrupted' }
    }
    this.changed()
  }

  receive(task: DesignTask, gatewayId: string): void {
    if (
      gatewayId !== this.gatewayId ||
      (task.revision <= this.revision && !(task.reviewClosed && task.taskId === this.task?.taskId))
    )
      return
    if (task.target.fileKey !== this.options.session()?.fileKey) return
    if (this.busy && task.taskId !== this.task?.taskId) return
    this.revision = task.revision
    if (task.status === 'cancelled' || task.reviewClosed) this.rememberStopped(task.taskId)
    if (this.stopped.has(task.taskId)) {
      const executing = this.busy && this.task?.taskId === task.taskId
      this.task = {
        ...task,
        status: executing ? 'stopping' : 'cancelled',
        operation: executing ? task.operation : null
      }
    } else
      this.task =
        this.revoked.has(this.leaseKey(task.taskId, task.epoch)) &&
        ['active', 'stopping'].includes(task.status)
          ? { ...task, status: task.operation ? 'stopping' : 'paused' }
          : task
    this.changed()
  }

  bind(value: unknown, route?: DesignToolRoute): DesignTask {
    const session = this.checkRoute(route)
    const task = DesignTaskSchema.parse(value)
    if (this.busy) this.busyError()
    if (
      task.target.sessionId !== session.sessionId ||
      task.target.fileKey !== session.fileKey ||
      ((task.epoch ?? 0) === 0 && task.target.pageId !== session.pageId)
    ) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TARGET_CHANGED,
        'The Figma file or page changed while starting the task. Begin again with a fresh requestId.'
      )
    }
    if (
      this.stopped.has(task.taskId) ||
      task.revision < this.revision ||
      (task.taskId === this.task?.taskId &&
        this.task.status !== 'active' &&
        (task.epoch ?? 0) <= (this.task.epoch ?? 0))
    ) {
      this.inactive()
    }
    this.receive(task, route!.gatewayId)
    this.assertTask(task.taskId, session, task.epoch)
    return this.task!
  }

  enter(name: string, args: unknown, route?: DesignToolRoute): () => void {
    const session = this.checkRoute(route)
    this.expire()
    if (this.busy) this.busyError()
    if (route?.taskId) {
      const task = this.assertTask(route.taskId, session, route.epoch)
      if (name === 'apply_canvas' && task.needsRead) this.inactive()
      const input = record(args)
      const page = record(input.page)
      const explicitTarget =
        input.nodeId ||
        input.targetNodeId ||
        input.pageId ||
        input.pageKey ||
        page.id ||
        page.pageKey
      const usesCurrentPage = [
        'apply_canvas',
        'get_code',
        'get_structure',
        'get_screenshot'
      ].includes(name)
      if (usesCurrentPage && !explicitTarget && session.pageId !== task.target.pageId) {
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.DESIGN_TARGET_CHANGED,
          'The current page changed. Use an exact page or node target, or activate the intended page explicitly.'
        )
      }
    } else if (name === 'apply_canvas' && this.task && this.stopped.has(this.task.taskId)) {
      this.inactive()
    } else if (
      name === 'apply_canvas' &&
      this.task &&
      ['active', 'stopping'].includes(this.task.status)
    ) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_BUSY,
        'This file belongs to a design task. Pass its taskId or stop it in TemPad Dev before writing.'
      )
    }
    this.busy = true
    this.changed()
    let finished = false
    return () => {
      if (finished) return
      finished = true
      this.busy = false
      if (this.task?.status === 'stopping')
        this.task = {
          ...this.task,
          status: this.stopped.has(this.task.taskId) ? 'cancelled' : 'paused',
          operation: null
        }
      this.changed()
    }
  }

  stop(taskId: string): void {
    if (this.task?.taskId !== taskId || ['completed', 'cancelled'].includes(this.task.status))
      return
    this.rememberStopped(taskId)
    this.revoke(taskId, this.task.epoch)
    this.task = { ...this.task, status: this.busy ? 'stopping' : 'cancelled' }
    this.changed()
  }

  expire(): void {
    if (this.task?.status !== 'active' || this.task.operation || this.busy) return
    if (this.task.expiresAt > this.now()) return
    this.task = { ...this.task, status: 'expired', operation: null }
    this.changed()
  }

  private checkRoute(route?: DesignToolRoute): FigmaSession {
    const session = this.options.session()
    if (
      !route ||
      !this.gatewayId ||
      route.gatewayId !== this.gatewayId ||
      route.sessionId !== session?.sessionId ||
      route.fileKey !== session.fileKey
    ) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TARGET_CHANGED,
        'This request belongs to a different or disconnected Figma runtime.'
      )
    }
    return session
  }

  private assertTask(taskId: string, session: FigmaSession, epoch?: number): DesignTask {
    if (
      this.stopped.has(taskId) ||
      this.revoked.has(this.leaseKey(taskId, epoch)) ||
      (epoch ?? 0) !== (this.task?.epoch ?? 0) ||
      !this.task ||
      this.task.taskId !== taskId ||
      this.task.status !== 'active' ||
      this.task.expiresAt <= this.now() ||
      this.task.target.sessionId !== session.sessionId ||
      this.task.target.fileKey !== session.fileKey
    )
      this.inactive()
    return this.task
  }

  private inactive(): never {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_INACTIVE,
      this.task && this.stopped.has(this.task.taskId)
        ? 'This task lease is inactive. Begin a new task with a fresh requestId before writing.'
        : 'This task lease is inactive. Resume the task, use its new epoch, and reread the target before writing.'
    )
  }

  private busyError(): never {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_BUSY,
      'The preceding operation is still executing. Wait for it to finish; if it is stuck, reload this Figma tab.'
    )
  }

  private changed(): void {
    try {
      this.options.onChange?.()
    } catch {
      // Status rendering and metadata reporting cannot change an operation's result.
    }
  }

  private leaseKey(taskId: string, epoch = 0): string {
    return `${taskId}:${epoch}`
  }

  private revoke(taskId: string, epoch = 0): void {
    this.revoked.add(this.leaseKey(taskId, epoch))
    if (this.revoked.size > 256) this.revoked.delete(this.revoked.values().next().value!)
  }

  private rememberStopped(taskId: string): void {
    if (this.stopped.has(taskId)) return
    this.stopped.add(taskId)
    if (this.stopped.size > 256) this.stopped.delete(this.stopped.values().next().value!)
    try {
      this.options.stoppedStorage?.()?.setItem(STOPPED_TASKS_KEY, JSON.stringify([...this.stopped]))
    } catch {
      // Stop is immediate even if the browser cannot persist it across a page refresh.
    }
  }
}
