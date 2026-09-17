import type {
  AgentClient,
  AgentCapabilities,
  DesignTask,
  DesignTaskTarget,
  FigmaSession
} from '@tempad-dev/shared'

import { MCP_DESIGN_TASK_LEASE_MS } from '@tempad-dev/shared'

import type { DesignTaskSnapshot, DesignTaskStore } from './design-task-store'
import type { ExtensionConnection } from './types'

type TerminalStatus = Exclude<DesignTask['status'], 'active' | 'stopping'>
type BrowserIdentity = { browserId: string; origin: string }

export type DesignTaskRecord = {
  task: DesignTask
  ownerId: string
  extensionId: string
  requestId: string
  ready: boolean
  ending?: TerminalStatus
  resultNodeIds?: string[]
  browser?: BrowserIdentity & { tabId: number; documentId: string }
}

type Operation = {
  extensionId: string
  browserId: string
  target: DesignTaskTarget
  taskId?: string
  uncertain: boolean
  tabId?: number
  documentId?: string
}

type Options = {
  createId: () => string
  now?: () => number
  leaseMs?: number
  onChange?: (record: DesignTaskRecord) => void
  store?: Pick<DesignTaskStore, 'load' | 'save'>
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

export function resolveDesignTarget(
  tasks: DesignTasks,
  extensions: readonly ExtensionConnection[],
  activeExtensionId: string | null,
  ownerId: string,
  taskId?: string,
  active = true,
  explicitSessionId?: string
): { extension: ExtensionConnection; session: FigmaSession } {
  const record = taskId ? tasks.owned(taskId, ownerId, active) : undefined
  const extension =
    extensions.find((value) =>
      explicitSessionId
        ? value.sessions?.sessions.some((session) => session.sessionId === explicitSessionId)
        : value.id === (record?.extensionId ?? activeExtensionId)
    ) ??
    (!active && record
      ? extensions.find((value) =>
          value.sessions?.sessions.some(
            (session) =>
              session.sessionId === record.task.target.sessionId &&
              session.fileKey === record.task.target.fileKey
          )
        )
      : undefined)
  const sessionId =
    explicitSessionId ?? record?.task.target.sessionId ?? extension?.sessions?.activeSessionId
  const session = extension?.sessions?.sessions.find((value) => value.sessionId === sessionId)
  if (!extension || !session) {
    fail(
      'NO_ACTIVE_EXTENSION',
      record
        ? 'The bound Figma session is unavailable. Begin a new task after reconnecting; no other tab was selected.'
        : 'No active Figma session. Activate the intended file with its TemPad Dev MCP badge.'
    )
  }
  if (record && record.task.target.fileKey !== session.fileKey) {
    fail('DESIGN_TARGET_CHANGED', 'The task file changed.')
  }
  const busy = extensions.some((connection) =>
    connection.sessions?.sessions.some((value) => value.fileKey === session.fileKey && value.busy)
  )
  return { extension, session: { ...session, busy } }
}

/** One Hub coordinates file leases across its connected browser sessions. */
export class DesignTasks {
  private readonly records = new Map<string, DesignTaskRecord>()
  private readonly currentTaskIds = new Map<string, string>()
  private readonly operations = new Map<string, Operation>()
  private readonly now: () => number
  private readonly leaseMs: number
  private revision = 0

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now
    this.leaseMs = options.leaseMs ?? MCP_DESIGN_TASK_LEASE_MS
  }

  retry(ownerId: string, requestId: string): DesignTaskRecord | undefined {
    this.sweep()
    return [...this.records.values()].find(
      (record) => record.ownerId === ownerId && record.requestId === requestId
    )
  }

  begin(
    ownerId: string,
    extensionId: string,
    session: FigmaSession,
    title: string,
    requestId: string,
    client?: AgentClient,
    capabilities?: AgentCapabilities,
    browser?: BrowserIdentity
  ): DesignTaskRecord {
    const retry = this.retry(ownerId, requestId)
    if (retry) {
      if (retry.task.title !== title) {
        fail('DESIGN_TASK_INACTIVE', 'This begin requestId was already used with another title.')
      }
      return retry
    }
    this.assertFileIdle(session)
    const occupant = this.occupant(session.fileKey)
    if (occupant) this.busy(occupant)
    const { busy: _busy, tabId: _tabId, documentId: _documentId, ...target } = session
    const record: DesignTaskRecord = {
      ownerId,
      extensionId,
      requestId,
      ready: false,
      ...(browser && _tabId !== undefined && _documentId !== undefined
        ? { browser: { ...browser, tabId: _tabId, documentId: _documentId } }
        : {}),
      task: {
        taskId: this.options.createId(),
        title,
        target,
        status: 'active',
        epoch: 0,
        ...(client ? { client } : {}),
        ...(capabilities ? { capabilities } : {}),
        operation: null,
        expiresAt: this.now() + this.leaseMs,
        revision: 0
      }
    }
    const previousTaskId = this.currentTaskIds.get(session.fileKey)
    this.records.set(record.task.taskId, record)
    this.currentTaskIds.set(session.fileKey, record.task.taskId)
    try {
      this.publish(record)
    } catch (error) {
      this.records.delete(record.task.taskId)
      if (previousTaskId) this.currentTaskIds.set(session.fileKey, previousTaskId)
      else this.currentTaskIds.delete(session.fileKey)
      throw error
    }
    return record
  }

  confirm(taskId: string, ownerId: string): DesignTaskRecord {
    const record = this.owned(taskId, ownerId, true)
    record.ready = true
    return record
  }

  owned(taskId: string, ownerId: string, active = false): DesignTaskRecord {
    const record = this.find(taskId)
    if (!record) {
      fail(
        'DESIGN_TASK_INACTIVE',
        'Unknown or expired task. Begin a new design task and reread its target.'
      )
    }
    if (record.ownerId !== ownerId) {
      fail(
        'DESIGN_TASK_OWNER_MISMATCH',
        'This task belongs to another MCP caller. Begin your own task.'
      )
    }
    if (active && record.task.reviewClosed)
      fail('DESIGN_TASK_INACTIVE', 'This review is closed. Begin a new task before writing.')
    if (active && record.task.status !== 'active') {
      fail(
        'DESIGN_TASK_INACTIVE',
        `Design task is ${record.task.status}. ${
          record.task.status === 'cancelled'
            ? 'Begin a new task with a fresh requestId before writing.'
            : 'Resume this task with resume_design and reread the target before writing; do not replay an old write.'
        }`
      )
    }
    return record
  }

  /** Runtime identity may reconnect the same conversation, never a focused/last caller. */
  attachClient(ownerId: string, client: AgentClient, capabilities?: AgentCapabilities): void {
    if (!client.sessionId || ['other', 'unknown'].includes(client.kind)) return
    for (const record of this.records.values()) {
      if (
        record.task.client?.kind !== client.kind ||
        record.task.client.sessionId !== client.sessionId
      )
        continue
      if (
        !['paused', 'expired', 'interrupted', 'completed'].includes(record.task.status) &&
        record.ownerId !== ownerId
      )
        continue
      const changed =
        record.ownerId !== ownerId || (capabilities && record.task.capabilities !== capabilities)
      record.ownerId = ownerId
      record.task.client = client
      if (capabilities) record.task.capabilities = capabilities
      if (changed) this.publish(record)
    }
  }

  assertEpoch(taskId: string, ownerId: string, epoch?: number): DesignTaskRecord {
    const record = this.owned(taskId, ownerId)
    if ((epoch ?? 0) !== (record.task.epoch ?? 0)) {
      fail(
        'DESIGN_TASK_INACTIVE',
        'Stale task lease. Read get_design_task for the current epoch, resume_design if inactive, and reread the canvas before writing.'
      )
    }
    return record
  }

  resume(taskId: string, ownerId: string, epoch: number, session: FigmaSession): DesignTaskRecord {
    const record = this.assertEpoch(taskId, ownerId, epoch)
    if (record.task.reviewClosed) fail('DESIGN_TASK_INACTIVE', 'This review is closed.')
    if (record.task.status === 'active') return record
    if (!['paused', 'expired', 'interrupted', 'completed'].includes(record.task.status)) {
      fail(
        'DESIGN_TASK_INACTIVE',
        'This task cannot resume. Wait for any stopping operation to finish, then begin a new task with a fresh requestId.'
      )
    }
    if (this.current(record.task.target.fileKey) !== record)
      fail('DESIGN_TASK_INACTIVE', 'This task was replaced by a newer task and cannot resume.')
    if (
      record.task.target.sessionId !== session.sessionId ||
      record.task.target.fileKey !== session.fileKey
    ) {
      fail(
        'DESIGN_TARGET_CHANGED',
        'The original Figma runtime is unavailable. No other session was selected.'
      )
    }
    this.assertFileIdle(session)
    record.ending = undefined
    record.ready = false
    record.task.status = 'active'
    record.task.epoch = (record.task.epoch ?? 0) + 1
    record.task.needsRead = true
    // The task keeps its page binding; switching pages is an explicit operation.
    this.renew(record)
    return record
  }

  acknowledgeRead(taskId: string, ownerId: string, epoch?: number): void {
    const record = this.assertEpoch(taskId, ownerId, epoch)
    if (record.task.status !== 'active' || !record.task.needsRead) return
    record.task.needsRead = false
    this.publish(record)
  }

  find(taskId: string): DesignTaskRecord | undefined {
    this.sweep()
    return this.records.get(taskId)
  }

  list(): DesignTaskRecord[] {
    this.sweep()
    return [...this.records.values()]
  }

  /** Only the current claim may own a lease or the file's task UI. */
  current(fileKey: string): DesignTaskRecord | undefined {
    const taskId = this.currentTaskIds.get(fileKey)
    return taskId ? this.records.get(taskId) : undefined
  }

  private occupant(fileKey: string): DesignTaskRecord | undefined {
    // Begin, resume and recovery only activate the current task for this file.
    const record = this.current(fileKey)
    return record && (record.task.status === 'active' || record.task.status === 'stopping')
      ? record
      : undefined
  }

  private busy(record: DesignTaskRecord): never {
    fail(
      'DESIGN_TASK_BUSY',
      `This file is occupied by “${record.task.title}”. Stop that task in TemPad Dev to take over, or retry after its idle lease expires. No request was queued.`
    )
  }

  private hasPendingOperation(fileKey: string): boolean {
    return [...this.operations.values()].some((operation) => operation.target.fileKey === fileKey)
  }

  private assertFileIdle(session: FigmaSession): void {
    if (session.busy || this.hasPendingOperation(session.fileKey)) {
      fail(
        'DESIGN_TASK_BUSY',
        'An operation in this file has not finished. Wait for its definitive result; if its runtime is stuck, reload the executing Figma tab before taking over.'
      )
    }
  }

  checkOperation(ownerId: string, session: FigmaSession, taskId?: string, write = false): void {
    this.sweep()
    this.assertFileIdle(session)
    const record = taskId ? this.owned(taskId, ownerId, true) : undefined
    if (record && (!record.ready || record.task.target.sessionId !== session.sessionId)) {
      fail('DESIGN_TARGET_CHANGED', 'The task is not bound to this Figma session.')
    }
    if (write && record?.task.needsRead) {
      fail(
        'DESIGN_TASK_INACTIVE',
        'Read the bound canvas with get_structure or get_code after resuming before writing.'
      )
    }
    const occupant = this.occupant(session.fileKey)
    if (write && occupant && occupant !== record) this.busy(occupant)
    if (
      write &&
      !taskId &&
      [...this.records.values()].some(
        ({ task }) => task.target.fileKey === session.fileKey && task.status === 'cancelled'
      )
    )
      fail('DESIGN_TASK_INACTIVE', 'This file has a stopped task. Begin a new task before writing.')
  }

  startOperation(
    requestId: string,
    ownerId: string,
    extensionId: string,
    browserId: string,
    session: FigmaSession,
    taskId?: string,
    write = false
  ): void {
    this.checkOperation(ownerId, session, taskId, write)
    const record = taskId ? this.records.get(taskId)! : undefined
    const { busy: _busy, tabId, documentId, ...target } = session
    this.operations.set(requestId, {
      extensionId,
      browserId,
      target,
      taskId,
      uncertain: false,
      tabId,
      documentId
    })
    if (!record) return
    record.task.operation = write ? 'writing' : 'reading'
    this.renew(record)
  }

  finishOperation(requestId: string, extensionId: string): void {
    const operation = this.operations.get(requestId)
    if (!operation || operation.extensionId !== extensionId) return
    this.operations.delete(requestId)
    if (!operation.taskId) return
    const record = this.records.get(operation.taskId)
    if (!record) return
    record.task.operation = null
    if (record.ending) this.finish(record, record.ending)
    else if (record.task.status === 'active') this.renew(record)
  }

  /** A transport failure is not evidence that page execution stopped. */
  uncertain(requestId: string, extensionId: string): void {
    const operation = this.operations.get(requestId)
    if (operation?.extensionId === extensionId) operation.uncertain = true
  }

  reconcileSessions(browserId: string, sessions: FigmaSession[], openTabIds?: number[]): void {
    for (const [requestId, operation] of this.operations) {
      if (!operation.uncertain) continue
      const session = sessions.find((value) => value.sessionId === operation.target.sessionId)
      const sameBrowser = browserId === operation.browserId
      const tabClosed =
        sameBrowser &&
        operation.tabId !== undefined &&
        openTabIds !== undefined &&
        !openTabIds.includes(operation.tabId)
      const documentReplaced =
        sameBrowser &&
        operation.tabId !== undefined &&
        operation.documentId !== undefined &&
        sessions.some(
          (value) =>
            value.tabId === operation.tabId &&
            value.documentId !== undefined &&
            value.documentId !== operation.documentId
        )
      if ((session && !session.busy) || tabClosed || documentReplaced) {
        this.finishOperation(requestId, operation.extensionId)
      }
    }
  }

  /** A new document in the same browser tab can restore the task, never an old write. */
  recoverSessions(extensions: readonly ExtensionConnection[]): {
    record: DesignTaskRecord
    extension: ExtensionConnection
    session: FigmaSession
  }[] {
    const recovered = []
    for (const record of this.list()) {
      const { task, browser } = record
      if (
        !browser ||
        task.reviewClosed ||
        this.current(task.target.fileKey) !== record ||
        !['interrupted', 'paused', 'expired', 'completed'].includes(task.status) ||
        extensions.some((extension) =>
          extension.sessions?.sessions.some(
            (session) => session.sessionId === task.target.sessionId
          )
        )
      )
        continue
      const candidates = extensions.flatMap((extension) => {
        if (
          extension.origin !== browser.origin ||
          extension.sessions?.browserId !== browser.browserId
        )
          return []
        return extension.sessions.sessions
          .filter(
            (session) =>
              session.tabId === browser.tabId &&
              session.documentId !== undefined &&
              session.documentId !== browser.documentId &&
              session.fileKey === task.target.fileKey
          )
          .map((session) => ({ extension, session }))
      })
      if (candidates.length !== 1) continue
      const { extension, session } = candidates[0]!
      if (
        this.hasPendingOperation(session.fileKey) ||
        extensions.some((connection) =>
          connection.sessions?.sessions.some(
            (value) => value.fileKey === session.fileKey && value.busy
          )
        )
      )
        continue

      record.extensionId = extension.id
      record.browser = { ...browser, documentId: session.documentId! }
      record.ready = false
      task.target = { ...task.target, sessionId: session.sessionId, fileName: session.fileName }
      task.epoch = (task.epoch ?? 0) + 1
      task.needsRead = true
      if (task.status === 'interrupted') {
        record.ending = undefined
        task.status = 'active'
        task.expiresAt = this.now() + this.leaseMs
        recovered.push({ record, extension, session })
      }
      this.publish(record)
    }
    return recovered
  }

  captureResult(taskId: string, rootNodeId: string, removed: boolean): void {
    const record = this.records.get(taskId)
    if (!record) return
    const ids = (record.resultNodeIds ?? []).filter((id) => id !== rootNodeId)
    record.resultNodeIds = (removed ? ids : [...ids, rootNodeId]).slice(-20)
    this.persist()
  }

  snapshotResult(taskId: string, summary?: string): void {
    const record = this.records.get(taskId)
    if (!record || record.task.result) return
    record.task.result = {
      nodeIds: record.resultNodeIds ?? [],
      capturedAt: this.now(),
      ...(summary ? { summary } : {})
    }
    this.persist()
  }

  stop(taskId: string, outcome: TerminalStatus): DesignTask | undefined {
    const record = this.records.get(taskId)
    if (!record || ['completed', 'cancelled'].includes(record.task.status)) return record?.task
    if (!['active', 'stopping'].includes(record.task.status)) {
      if (outcome === 'completed' || outcome === 'cancelled') this.finish(record, outcome)
      return record.task
    }
    // Explicit cancellation also ends a lifecycle pause that is already draining.
    if (outcome === 'cancelled' || !record.ending) record.ending = outcome
    const executing = [...this.operations.values()].some((value) => value.taskId === taskId)
    if (executing) {
      record.task.status = 'stopping'
      this.publish(record)
    } else this.finish(record, record.ending)
    return record.task
  }

  disconnectOwner(ownerId: string): void {
    for (const record of this.records.values()) {
      if (record.ownerId === ownerId) this.stop(record.task.taskId, 'paused')
    }
  }

  disconnectExtension(extensionId: string): void {
    for (const operation of this.operations.values()) {
      if (operation.extensionId === extensionId) operation.uncertain = true
    }
    for (const record of this.records.values()) {
      if (record.extensionId === extensionId) this.stop(record.task.taskId, 'interrupted')
    }
  }

  updatePage(taskId: string, pageId: string): void {
    const record = this.records.get(taskId)
    if (!record || record.task.status !== 'active') return
    record.task.target.pageId = pageId
    this.publish(record)
  }

  touch(taskId: string, ownerId: string): void {
    this.renew(this.owned(taskId, ownerId, true))
  }

  sweep(): void {
    const now = this.now()
    for (const record of this.records.values()) {
      if (
        record.task.status === 'active' &&
        !record.task.operation &&
        record.task.expiresAt <= now
      ) {
        this.finish(record, 'expired')
      }
    }
  }

  private renew(record: DesignTaskRecord): void {
    record.task.expiresAt = this.now() + this.leaseMs
    this.publish(record)
  }

  private finish(record: DesignTaskRecord, status: TerminalStatus): void {
    record.task.status = status
    record.task.operation = null
    this.publish(record)
  }

  private publish(record: DesignTaskRecord): void {
    record.task.revision = ++this.revision
    this.persist()
    if (this.current(record.task.target.fileKey) === record) this.options.onChange?.(record)
  }

  /** Load only after acquiring the Hub lock. Every old lease remains inactive. */
  restore(): void {
    const snapshot = this.options.store?.load()
    if (!snapshot) return
    this.revision = snapshot.revision
    for (const saved of snapshot.records) {
      const task = {
        ...saved.task,
        operation: null,
        epoch: (saved.task.epoch ?? 0) + 1,
        needsRead: true,
        capabilities: undefined,
        expiresAt: this.now(),
        revision: ++this.revision
      }
      if (task.status === 'stopping') task.status = 'cancelled'
      else if (['active', 'interrupted'].includes(task.status)) task.status = 'paused'
      this.records.set(task.taskId, {
        ...saved,
        task,
        ownerId: `restored:${task.taskId}`,
        extensionId: '',
        ready: false
      })
    }
    for (const [fileKey, taskId] of Object.entries(snapshot.current))
      if (this.records.get(taskId)?.task.target.fileKey === fileKey)
        this.currentTaskIds.set(fileKey, taskId)
    this.persist()
  }

  /** A registered page can recover its saved review, never its execution authority. */
  restoreReview(saved: DesignTask, extension: ExtensionConnection, session: FigmaSession): void {
    if (saved.target.fileKey !== session.fileKey || !extension.sessions) return
    let record = this.records.get(saved.taskId)
    if (
      record &&
      (record.task.target.fileKey !== saved.target.fileKey ||
        record.task.client?.kind !== saved.client?.kind ||
        record.task.client?.sessionId !== saved.client?.sessionId)
    )
      return
    if (!record) {
      // Migrate a tab saved before durable Hub records existed. Never replace a newer task.
      if (this.current(session.fileKey)) return
      record = {
        task: {
          ...saved,
          status:
            saved.status === 'cancelled'
              ? 'cancelled'
              : saved.status === 'completed'
                ? 'completed'
                : 'paused',
          operation: null,
          capabilities: undefined,
          epoch: (saved.epoch ?? 0) + 1,
          needsRead: true,
          expiresAt: this.now()
        },
        ownerId: `restored:${saved.taskId}`,
        extensionId: '',
        requestId: '',
        ready: false
      }
      this.records.set(saved.taskId, record)
      this.currentTaskIds.set(session.fileKey, saved.taskId)
      this.publish(record)
    }
    if (saved.reviewClosed) {
      this.closeReview(saved.taskId)
      return
    }
    if (saved.status === 'cancelled') {
      this.stop(saved.taskId, 'cancelled')
      return
    }
    if (record.task.reviewClosed || this.current(session.fileKey) !== record) return
    // Preserve normal exact-tab refresh recovery, including its fresh write epoch.
    // Hub-restored tasks are paused and never enter this automatic recovery path.
    if (
      record.task.status === 'interrupted' &&
      record.browser &&
      record.browser.tabId === session.tabId &&
      session.documentId !== undefined &&
      record.browser.documentId !== session.documentId
    )
      return
    // A live original runtime wins over a copied or stale tab snapshot.
    if (
      extension.sessions.sessions.some(
        (value) => value.sessionId === record.task.target.sessionId
      ) &&
      record.task.target.sessionId !== session.sessionId
    )
      return
    if (
      record.browser &&
      (record.browser.browserId !== extension.sessions.browserId ||
        record.browser.origin !== extension.origin)
    )
      return
    if (record.task.target.sessionId === session.sessionId && record.extensionId === extension.id)
      return
    if (['active', 'stopping'].includes(record.task.status)) return
    record.extensionId = extension.id
    record.ready = false
    record.task.target = {
      ...record.task.target,
      sessionId: session.sessionId,
      fileName: session.fileName
    }
    if (session.tabId !== undefined && session.documentId !== undefined)
      record.browser = {
        browserId: extension.sessions.browserId,
        origin: extension.origin,
        tabId: session.tabId,
        documentId: session.documentId
      }
    this.publish(record)
  }

  closeReview(taskId: string): void {
    const record = this.records.get(taskId)
    if (!record || record.task.reviewClosed) return
    record.task.reviewClosed = true
    if (!['completed', 'cancelled'].includes(record.task.status)) this.stop(taskId, 'cancelled')
    else this.publish(record)
  }

  private persist(): void {
    if (!this.options.store) return
    const snapshot: DesignTaskSnapshot = {
      revision: this.revision,
      current: Object.fromEntries(this.currentTaskIds),
      records: [...this.records.values()].map(({ task, requestId, browser, resultNodeIds }) => ({
        task: { ...task, capabilities: undefined, operation: null },
        requestId,
        browser,
        resultNodeIds
      }))
    }
    this.options.store.save(snapshot)
  }
}
