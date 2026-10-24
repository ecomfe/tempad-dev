import type {
  AgentClient,
  AgentCapabilities,
  DesignTask,
  DesignTaskTarget,
  FigmaSession,
  TempadMcpErrorCode
} from '@tempad-dev/shared'

import { MCP_DESIGN_TASK_LEASE_MS, RESUMABLE_DESIGN_TASK_STATUSES } from '@tempad-dev/shared'
import { isDeepStrictEqual } from 'node:util'

import type { HostContext } from './agent-clients/host-context'
import type { DesignTaskSnapshot, DesignTaskStore } from './design-task-store'
import type { ExtensionConnection } from './types'

import { codexStoreKey } from './agent-clients/host-context'
import { nativeFeedback } from './agent-clients/types'
import { HISTORY_RETENTION_MS } from './history-retention'
import { extensionUpgradeRequired } from './legacy-extension'

type TerminalStatus = Exclude<DesignTask['status'], 'active' | 'stopping'>
type BrowserIdentity = { browserId: string; origin: string }

const ENDED_STATUSES: DesignTask['status'][] = ['completed', 'cancelled']
const RUNNING_STATUSES: DesignTask['status'][] = ['active', 'stopping']

export type DesignTaskRecord = {
  task: DesignTask
  ownerId: string
  extensionId: string
  requestId: string
  ready: boolean
  ending?: TerminalStatus
  resultNodeIds?: string[]
  browser?: BrowserIdentity & { tabId: number; documentId: string }
  retiredAt?: number
  hostContext?: HostContext
}

/** Only a Hub begin request establishes a client binding; browser migration leaves it empty. */
export function getVerifiedTaskClient(record: DesignTaskRecord): AgentClient | undefined {
  return record.requestId ? record.task.client : undefined
}

type Operation = {
  extensionId: string
  browserId: string
  target: DesignTaskTarget
  taskId?: string
  tabId?: number
  documentId?: string
  write: boolean
}

type Options = {
  createId: () => string
  now?: () => number
  leaseMs?: number
  onChange?: (record: DesignTaskRecord) => void
  store?: Pick<DesignTaskStore, 'load' | 'save' | 'recoveryError' | 'blockedFiles'>
  onPersistenceError?: (error: unknown) => void
  onReviewStop?: (record: DesignTaskRecord) => void
}

function fail(code: TempadMcpErrorCode, message: string): never {
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
  if (record && explicitSessionId && explicitSessionId !== record.task.target.sessionId) {
    fail('DESIGN_TARGET_CHANGED', 'The requested Figma session does not match this task.')
  }
  const extension =
    extensions.find((value) =>
      explicitSessionId && !record
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
  if (extension?.legacy) throw extensionUpgradeRequired()
  const sessionId =
    explicitSessionId ?? record?.task.target.sessionId ?? extension?.sessions?.activeSessionId
  const session = extension?.sessions?.sessions.find((value) => value.sessionId === sessionId)
  if (!extension || !session) {
    fail(
      'NO_ACTIVE_EXTENSION',
      record
        ? 'The bound Figma session is unavailable. Begin a new task after reconnecting; no other tab was selected.'
        : explicitSessionId
          ? `Figma session ${explicitSessionId} is unavailable. Call list_design_sessions for a current sessionId.`
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
  private readonly filesNeedingRead = new Map<string, number>()
  private readGeneration = 0
  // Every retired file rejects stale unknown reviews; true also retains its Stop write fence.
  private readonly fileFences = new Map<string, boolean>()
  private readonly expiredRequests = new Map<string, Set<string>>()
  private nextHistorySweep = Infinity
  private readonly now: () => number
  private readonly leaseMs: number
  private revision = 0
  private recoveryGeneration?: string
  private persistenceError?: unknown

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now
    this.leaseMs = options.leaseMs ?? MCP_DESIGN_TASK_LEASE_MS
  }

  retry(
    ownerId: string,
    requestId: string,
    recoveryGeneration?: string
  ): DesignTaskRecord | undefined {
    if (this.recoveryGeneration && recoveryGeneration !== this.recoveryGeneration)
      throw Object.assign(
        new Error(
          `Task storage was recovered; old tasks cannot resume. Explicitly begin a fresh task with recoveryGeneration "${this.recoveryGeneration}" and a fresh requestId, then reread its target before writing.`
        ),
        { code: 'DESIGN_TASK_INACTIVE', recoveryGeneration: this.recoveryGeneration }
      )
    this.sweep()
    if (this.expiredRequests.get(ownerId)?.has(requestId))
      fail(
        'DESIGN_TASK_INACTIVE',
        'This begin requestId has expired. Begin a new task with a fresh requestId.'
      )
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
    browser?: BrowserIdentity,
    recoveryGeneration?: string,
    hostContext?: HostContext
  ): DesignTaskRecord {
    this.assertStorageWritable(session.fileKey)
    const retry = this.retry(ownerId, requestId, recoveryGeneration)
    if (retry) {
      if (retry.task.title !== title) {
        fail('REQUEST_ID_CONFLICT', 'This begin requestId was already used with another title.')
      }
      return retry
    }
    this.assertFileIdle(session)
    const occupant = this.occupant(session.fileKey)
    if (occupant) this.busy(occupant)
    const { busy: _busy, tabId, documentId, ...target } = session
    const record: DesignTaskRecord = {
      ownerId,
      extensionId,
      requestId,
      ready: false,
      ...(hostContext ? { hostContext } : {}),
      ...(browser && tabId !== undefined && documentId !== undefined
        ? { browser: { ...browser, tabId, documentId } }
        : {}),
      task: {
        taskId: this.options.createId(),
        title,
        target,
        status: 'active',
        epoch: 0,
        ...(this.recoveryGeneration ? { needsRead: true } : {}),
        ...(client ? { client } : {}),
        ...(capabilities ? { capabilities } : {}),
        operation: null,
        expiresAt: this.now() + this.leaseMs,
        revision: 0
      }
    }
    const previousTaskId = this.currentTaskIds.get(session.fileKey)
    const previous = previousTaskId ? this.records.get(previousTaskId) : undefined
    this.records.set(record.task.taskId, record)
    this.currentTaskIds.set(session.fileKey, record.task.taskId)
    if (!this.expiredRequests.has(ownerId)) this.expiredRequests.set(ownerId, new Set())
    if (previous) this.trackRetirement(previous)
    try {
      this.publish(record, true)
    } catch (error) {
      this.records.delete(record.task.taskId)
      if (previousTaskId) this.currentTaskIds.set(session.fileKey, previousTaskId)
      else this.currentTaskIds.delete(session.fileKey)
      if (previous) this.trackRetirement(previous)
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
            : 'Use manage_design_task with action "resume" and reread the target before writing; do not replay an old write.'
        }`
      )
    }
    return record
  }

  /** Runtime identity may reconnect the same conversation, never a focused/last caller. */
  attachClient(
    ownerId: string,
    client: AgentClient,
    capabilities?: AgentCapabilities,
    hostContext?: HostContext
  ): string[] {
    const mismatched: string[] = []
    if (!client.sessionId || ['other', 'unknown'].includes(client.kind)) return mismatched
    for (const record of this.records.values()) {
      const verified = getVerifiedTaskClient(record)
      if (verified?.kind !== client.kind || verified.sessionId !== client.sessionId) continue
      if (
        !RESUMABLE_DESIGN_TASK_STATUSES.includes(record.task.status) &&
        record.ownerId !== ownerId
      )
        continue
      if (
        nativeFeedback(client) &&
        record.hostContext &&
        codexStoreKey(record.hostContext) !== codexStoreKey(hostContext)
      ) {
        mismatched.push(record.task.taskId)
        continue
      }
      const ownerChanged = record.ownerId !== ownerId
      const changed =
        ownerChanged ||
        (hostContext && !isDeepStrictEqual(record.hostContext, hostContext)) ||
        (capabilities && !isDeepStrictEqual(record.task.capabilities, capabilities))
      record.ownerId = ownerId
      if (ownerChanged && !this.expiredRequests.has(ownerId))
        this.expiredRequests.set(ownerId, new Set())
      record.task.client = client
      if (hostContext) record.hostContext = hostContext
      if (capabilities) record.task.capabilities = capabilities
      if (changed) this.publish(record)
    }
    return mismatched
  }

  assertEpoch(taskId: string, ownerId: string, epoch?: number): DesignTaskRecord {
    const record = this.owned(taskId, ownerId)
    if ((epoch ?? 0) !== (record.task.epoch ?? 0)) {
      fail(
        'DESIGN_TASK_INACTIVE',
        'Stale task lease. Read get_design_task for the current epoch, use manage_design_task with action "resume" if inactive, and reread the canvas before writing.'
      )
    }
    return record
  }

  resume(taskId: string, ownerId: string, epoch: number, session: FigmaSession): DesignTaskRecord {
    const record = this.assertEpoch(taskId, ownerId, epoch)
    if (record.task.reviewClosed) fail('DESIGN_TASK_INACTIVE', 'This review is closed.')
    if (record.task.status === 'active') return record
    if (!RESUMABLE_DESIGN_TASK_STATUSES.includes(record.task.status)) {
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
    const previousTask = { ...record.task, needsRead: record.task.needsRead }
    const { ready, ending, retiredAt } = record
    record.ending = undefined
    record.ready = false
    record.task.status = 'active'
    record.task.epoch = (record.task.epoch ?? 0) + 1
    delete record.task.result
    record.task.needsRead = true
    // The task keeps its page binding; switching pages is an explicit operation.
    try {
      this.renew(record, true)
    } catch (error) {
      Object.assign(record.task, previousTask)
      Object.assign(record, { ready, ending, retiredAt })
      throw error
    }
    return record
  }

  acknowledgeRead(taskId: string, ownerId: string, epoch?: number): void {
    const record = this.assertEpoch(taskId, ownerId, epoch)
    if (record.task.status !== 'active' || !record.task.needsRead) return
    record.task.needsRead = false
    this.publish(record)
  }

  requireFileRead(fileKey: string, requireDurable = false): number {
    const previous = this.filesNeedingRead.get(fileKey)
    const generation = ++this.readGeneration
    this.filesNeedingRead.set(fileKey, generation)
    this.persist()
    if (requireDurable && this.persistenceError) {
      if (previous === undefined) this.filesNeedingRead.delete(fileKey)
      else this.filesNeedingRead.set(fileKey, previous)
      fail(
        'DESIGN_TASK_INACTIVE',
        'Design task state could not be saved. No canvas write was dispatched. Restore storage before retrying.'
      )
    }
    return generation
  }

  acknowledgeFileRead(fileKey: string, expectedGeneration?: number): void {
    const generation = this.filesNeedingRead.get(fileKey)
    if (
      generation === undefined ||
      (expectedGeneration !== undefined && expectedGeneration !== generation)
    )
      return
    this.filesNeedingRead.delete(fileKey)
    this.persist()
    if (this.persistenceError) this.filesNeedingRead.set(fileKey, generation)
  }

  needsFileRead(fileKey: string): boolean {
    return this.filesNeedingRead.has(fileKey)
  }

  isOperationPending(requestId: string): boolean {
    return this.operations.has(requestId)
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
    return record && RUNNING_STATUSES.includes(record.task.status) ? record : undefined
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
    if (write) this.assertStorageWritable(session.fileKey)
    this.assertFileIdle(session)
    const record = taskId ? this.owned(taskId, ownerId, true) : undefined
    if (record && (!record.ready || record.task.target.sessionId !== session.sessionId)) {
      fail('DESIGN_TARGET_CHANGED', 'The task is not bound to this Figma session.')
    }
    if (write && record?.task.needsRead) {
      fail('DESIGN_TASK_INACTIVE', 'The resumed task has not confirmed its bound canvas state.')
    }
    if (write && this.filesNeedingRead.has(session.fileKey)) {
      fail(
        'DESIGN_TASK_INACTIVE',
        'The previous write did not confirm its final canvas state. Do not replay the write.'
      )
    }
    const occupant = this.occupant(session.fileKey)
    if (write && occupant && occupant !== record) this.busy(occupant)
    if (
      write &&
      !taskId &&
      (this.recoveryGeneration ||
        this.fileFences.get(session.fileKey) ||
        [...this.records.values()].some(
          ({ task }) => task.target.fileKey === session.fileKey && task.status === 'cancelled'
        ))
    )
      fail(
        'DESIGN_TASK_INACTIVE',
        this.recoveryGeneration
          ? 'Task storage was recovered. Begin a new task before writing.'
          : 'This file has a stopped task. Begin a new task before writing.'
      )
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
      tabId,
      documentId,
      write
    })
    if (!record) return
    record.task.operation = write ? 'writing' : 'reading'
    this.renew(record)
  }

  finishOperation(requestId: string, extensionId: string, definitive = true): void {
    const operation = this.operations.get(requestId)
    if (!operation || operation.extensionId !== extensionId || (!definitive && operation.write))
      return
    this.operations.delete(requestId)
    if (!operation.taskId) return
    const record = this.records.get(operation.taskId)
    if (!record) return
    record.task.operation = null
    if (record.ending) this.finish(record, record.ending)
    else if (record.task.status === 'active') this.renew(record)
  }

  reconcileSessions(browserId: string, sessions: FigmaSession[], openTabIds?: number[]): void {
    for (const [requestId, operation] of this.operations) {
      if (browserId !== operation.browserId) continue
      const tabClosed =
        operation.tabId !== undefined &&
        openTabIds !== undefined &&
        !openTabIds.includes(operation.tabId)
      const documentReplaced =
        operation.tabId !== undefined &&
        operation.documentId !== undefined &&
        sessions.some(
          (value) =>
            value.tabId === operation.tabId &&
            value.documentId !== undefined &&
            value.documentId !== operation.documentId
        )
      // Idle snapshots have no causal link to the pending operation. Only a
      // definitive result or loss of its executing document can release the fence.
      if (tabClosed || documentReplaced) {
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
        !RESUMABLE_DESIGN_TASK_STATUSES.includes(task.status) ||
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
    const next = (removed ? ids : [...ids, rootNodeId]).slice(-20)
    if (isDeepStrictEqual(record.resultNodeIds ?? [], next)) return
    record.resultNodeIds = next
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
    if (!record || record.task.status === 'cancelled' || record.task.status === outcome)
      return record?.task
    if (!RUNNING_STATUSES.includes(record.task.status)) {
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
    this.expiredRequests.delete(ownerId)
  }

  disconnectExtension(extensionId: string): void {
    for (const record of this.records.values()) {
      if (record.extensionId === extensionId) {
        this.stop(record.task.taskId, 'interrupted')
        record.extensionId = ''
      }
    }
  }

  updatePage(taskId: string, pageId: string): void {
    const record = this.records.get(taskId)
    if (!record || record.task.status !== 'active' || record.task.target.pageId === pageId) return
    record.task.target.pageId = pageId
    this.publish(record)
  }

  touch(taskId: string, ownerId: string): void {
    this.renew(this.owned(taskId, ownerId, true))
  }

  sweep(): void {
    if (this.persistenceError) this.persist()
    const now = this.now()
    // Historical tasks never own a lease. Retain their fences without scanning
    // every record on each lookup and operation.
    for (const taskId of this.currentTaskIds.values()) {
      const record = this.records.get(taskId)!
      if (
        record.task.status === 'active' &&
        !record.task.operation &&
        record.task.expiresAt <= now
      ) {
        this.finish(record, 'expired')
      }
    }
    this.pruneHistory(now)
  }

  private trackRetirement(record: DesignTaskRecord): void {
    const { task } = record
    if (
      !RUNNING_STATUSES.includes(task.status) &&
      (task.reviewClosed ||
        task.status === 'cancelled' ||
        this.current(task.target.fileKey) !== record)
    ) {
      record.retiredAt ??= this.now()
      this.nextHistorySweep = Math.min(
        this.nextHistorySweep,
        record.retiredAt + HISTORY_RETENTION_MS
      )
    } else {
      delete record.retiredAt
    }
  }

  private pruneHistory(now: number): void {
    if (now < this.nextHistorySweep || this.persistenceError) return
    this.nextHistorySweep = Infinity
    const pendingTasks = new Set([...this.operations.values()].map(({ taskId }) => taskId))
    let changed = false
    for (const [taskId, record] of this.records) {
      if (record.retiredAt === undefined) continue
      const deadline = record.retiredAt + HISTORY_RETENTION_MS
      if (
        deadline > now ||
        RUNNING_STATUSES.includes(record.task.status) ||
        pendingTasks.has(taskId)
      ) {
        this.nextHistorySweep = Math.min(
          this.nextHistorySweep,
          deadline > now ? deadline : now + 60_000
        )
        continue
      }
      const fileKey = record.task.target.fileKey
      this.fileFences.set(
        fileKey,
        this.fileFences.get(fileKey) === true || record.task.status === 'cancelled'
      )
      if (record.requestId) this.expiredRequests.get(record.ownerId)?.add(record.requestId)
      this.records.delete(taskId)
      if (this.currentTaskIds.get(fileKey) === taskId) this.currentTaskIds.delete(fileKey)
      changed = true
    }
    if (changed) this.persist()
  }

  private renew(record: DesignTaskRecord, requireDurable = false): void {
    record.task.expiresAt = this.now() + this.leaseMs
    this.publish(record, requireDurable)
  }

  private finish(record: DesignTaskRecord, status: TerminalStatus): void {
    record.task.status = status
    record.task.operation = null
    this.publish(record)
  }

  private publish(record: DesignTaskRecord, requireDurable = false): void {
    record.task.revision = ++this.revision
    this.trackRetirement(record)
    this.persist()
    if (requireDurable && this.persistenceError) throw this.persistenceError
    if (this.current(record.task.target.fileKey) === record) this.options.onChange?.(record)
  }

  /** Load only after acquiring the Hub lock. Every old lease remains inactive. */
  restore(): void {
    const snapshot = this.options.store?.load()
    if (!snapshot) return
    this.revision = snapshot.revision
    this.recoveryGeneration = snapshot.recoveryGeneration
    for (const fileKey of snapshot.filesNeedingRead ?? [])
      this.filesNeedingRead.set(fileKey, ++this.readGeneration)
    for (const [fileKey, stopped] of Object.entries(snapshot.fileFences ?? {}))
      this.fileFences.set(fileKey, stopped)
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
    for (const record of this.records.values()) this.trackRetirement(record)
    this.persist()
  }

  /** A registered page can recover its saved review, never its execution authority. */
  restoreReview(
    saved: DesignTask,
    extension: ExtensionConnection,
    session: FigmaSession
  ): boolean | undefined {
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
      if (
        this.recoveryGeneration ||
        this.current(session.fileKey) ||
        this.fileFences.has(session.fileKey)
      )
        return
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
    if (
      (record.extensionId && record.extensionId !== extension.id) ||
      (record.browser &&
        (record.browser.browserId !== extension.sessions.browserId ||
          record.browser.origin !== extension.origin))
    )
      return
    if (saved.status === 'cancelled') {
      if (!ENDED_STATUSES.includes(record.task.status) && this.current(session.fileKey) === record)
        this.options.onReviewStop?.(record)
      this.stop(saved.taskId, 'cancelled')
      if (saved.reviewClosed) this.closeReview(saved.taskId)
      return true
    }
    if (saved.reviewClosed) {
      this.closeReview(saved.taskId)
      return true
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
    if (record.task.target.sessionId === session.sessionId && record.extensionId === extension.id)
      return
    if (RUNNING_STATUSES.includes(record.task.status)) return
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
    if (!ENDED_STATUSES.includes(record.task.status)) this.stop(taskId, 'cancelled')
    else this.publish(record)
  }

  private persist(): void {
    if (!this.options.store) return
    const snapshot: DesignTaskSnapshot = {
      revision: this.revision,
      ...(this.recoveryGeneration ? { recoveryGeneration: this.recoveryGeneration } : {}),
      ...(this.filesNeedingRead.size
        ? { filesNeedingRead: [...this.filesNeedingRead.keys()] }
        : {}),
      current: Object.fromEntries(this.currentTaskIds),
      ...(this.fileFences.size ? { fileFences: Object.fromEntries(this.fileFences) } : {}),
      records: [...this.records.values()].map(
        ({ task, requestId, browser, resultNodeIds, retiredAt, hostContext }) => ({
          task: { ...task, capabilities: undefined, operation: null },
          requestId,
          browser,
          resultNodeIds,
          retiredAt,
          hostContext
        })
      )
    }
    try {
      this.options.store.save(snapshot)
      this.persistenceError = undefined
    } catch (error) {
      if (!this.persistenceError) this.options.onPersistenceError?.(error)
      this.persistenceError = error
    }
  }

  private assertStorageWritable(fileKey: string): void {
    if (this.options.store?.blockedFiles?.has(fileKey))
      fail(
        'DESIGN_TASK_INACTIVE',
        'This Figma file has an incompatible saved task. If it was written by a newer Hub, upgrade TemPad Dev MCP and reconnect all clients. If the current version still rejects it, preserve the snapshot for diagnosis or restore a verified complete backup including the latest Stop fences. Do not reset readable task storage; other files are unaffected.'
      )
    if (this.options.store?.recoveryError || this.persistenceError)
      fail(
        'DESIGN_TASK_INACTIVE',
        this.options.store?.recoveryError ??
          'Design task state could not be saved. Canvas writes are blocked until storage recovers; stopped tasks remain fenced.'
      )
  }
}
