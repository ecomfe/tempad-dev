import type { FigmaSession, TerminalReceipt, ToolCompletionMessage } from '@tempad-dev/shared'

import { randomUUID } from 'node:crypto'

import type { Execution } from './execution-state'
import type { ExtensionConnection } from './types'

const MAX_RECEIPTS = 128

type ReceiptRecord = Execution & { write: boolean }

/** Persist write exclusion, never requests to replay or authority to resume a task. */
export class TerminalReceipts {
  readonly generation = randomUUID()
  private readonly pending = new Map<string, ReceiptRecord>()
  private readonly completed = new Map<string, ReceiptRecord>()
  private abandoned: Execution[] = []

  constructor(private readonly persist?: (records: Execution[]) => void) {}

  restore(records: Execution[]): void {
    this.pending.clear()
    this.abandoned = records.filter((record) => record.abandonedAt !== undefined)
    for (const record of records) {
      if (record.abandonedAt === undefined) this.pending.set(record.id, { ...record, write: true })
    }
  }

  private save(pending = this.pending, abandoned = this.abandoned): void {
    this.persist?.(
      [...pending.values()]
        .filter((record) => record.write)
        .map(({ write: _write, ...record }) => record)
        .concat(abandoned)
    )
  }

  status() {
    return [...this.pending.values()]
      .filter((record) => record.write)
      .map((record) => ({
        id: record.id,
        revision: record.revision,
        fileKey: record.session.fileKey,
        browserId: record.browserId,
        tabId: record.session.tabId,
        documentId: record.session.documentId,
        recordedAt: record.recordedAt
      }))
  }

  abandon(id: string, revision: string): ReceiptRecord | undefined {
    const record = this.pending.get(id)
    if (!record) {
      if (this.abandoned.some((value) => value.id === id && value.revision === revision)) return
      throw new Error('The execution block changed. Inspect --runtime-status again.')
    }
    if (!record.write || record.revision !== revision)
      throw new Error('The execution block changed. Inspect --runtime-status again.')
    const pending = new Map(this.pending)
    pending.delete(id)
    const { write: _write, ...execution } = record
    const abandoned = [...this.abandoned, { ...execution, abandonedAt: Date.now() }]
    this.save(pending, abandoned)
    this.pending.delete(id)
    this.abandoned = abandoned
    return record
  }

  canHandoff(): boolean {
    return [...this.pending.values()].every((record) => record.write && record.handoff)
  }

  transferableIds(): Set<string> {
    return new Set(
      [...this.pending.values()]
        .filter((record) => record.write && record.handoff)
        .map((record) => record.id)
    )
  }

  disconnect(extensionId: string): void {
    for (const record of this.pending.values()) {
      if (record.extensionId === extensionId && !record.write) this.remove(record)
    }
  }

  get pendingCount(): number {
    return this.pending.size
  }

  reserve(
    requestId: string,
    extension: ExtensionConnection,
    session: FigmaSession,
    taskId: string | undefined,
    write: boolean,
    epoch?: number
  ): TerminalReceipt | undefined {
    const supported =
      !!extension.runtime?.terminalReceipts &&
      session.documentId !== undefined &&
      session.tabId !== undefined
    if (!supported && !write) return
    if (this.pending.size >= MAX_RECEIPTS)
      throw Object.assign(
        new Error(
          'Too many calls await a terminal receipt. Wait for completion acknowledgments or reload the executing Figma tabs before continuing.'
        ),
        { code: 'DESIGN_TASK_BUSY' }
      )
    const receipt = { generation: this.generation, receiptId: randomUUID() }
    const record: ReceiptRecord = {
      id: requestId,
      revision: randomUUID(),
      recordedAt: Date.now(),
      receipt,
      extensionId: extension.id,
      browserId: extension.sessions?.browserId ?? '',
      origin: extension.origin,
      session: { ...session },
      taskId,
      epoch,
      write,
      handoff: supported && !!extension.runtime?.durableTerminalReceipts
    }
    const pending = new Map(this.pending).set(requestId, record)
    if (write) this.save(pending)
    this.pending.set(requestId, record)
    return supported ? receipt : undefined
  }

  settle(requestId: string, extensionId: string, definitive = true): void {
    const record = this.pending.get(requestId)
    if (!record || record.extensionId !== extensionId || (!definitive && record.write)) return
    this.remove(record)
    this.completed.set(requestId, record)
    if (this.completed.size > MAX_RECEIPTS)
      this.completed.delete(this.completed.keys().next().value!)
  }

  private remove(record: ReceiptRecord): void {
    const pending = new Map(this.pending)
    pending.delete(record.id)
    if (record.write) this.save(pending)
    this.pending.delete(record.id)
  }

  accept(
    message: ToolCompletionMessage,
    extension: ExtensionConnection
  ): { accepted: boolean; recovered?: ReceiptRecord } {
    const record = this.pending.get(message.id) ?? this.completed.get(message.id)
    const session = extension.sessions?.sessions.find(
      (value) => value.sessionId === record?.session.sessionId
    )
    if (
      !record ||
      !extension.runtime?.terminalReceipts ||
      message.generation !== record.receipt.generation ||
      message.receiptId !== record.receipt.receiptId ||
      extension.origin !== record.origin ||
      extension.sessions?.browserId !== record.browserId ||
      session?.fileKey !== record.session.fileKey ||
      session.documentId !== record.session.documentId ||
      session.tabId !== record.session.tabId
    )
      return { accepted: false }
    if (!this.pending.has(message.id)) return { accepted: true }
    this.settle(message.id, record.extensionId)
    return { accepted: true, recovered: record }
  }

  reconcile(extension: ExtensionConnection): void {
    const snapshot = extension.sessions
    if (!snapshot) return
    for (const record of this.pending.values()) {
      if (record.browserId !== snapshot.browserId || record.origin !== extension.origin) continue
      const closed =
        snapshot.openTabIds !== undefined && !snapshot.openTabIds.includes(record.session.tabId!)
      const replaced = snapshot.sessions.some(
        (session) =>
          session.tabId === record.session.tabId &&
          session.documentId !== undefined &&
          session.documentId !== record.session.documentId
      )
      if (closed || replaced) this.remove(record)
    }
  }
}
