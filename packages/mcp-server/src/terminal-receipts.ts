import type { FigmaSession, TerminalReceipt, ToolCompletionMessage } from '@tempad-dev/shared'

import { randomUUID } from 'node:crypto'

import type { ExtensionConnection } from './types'

const MAX_RECEIPTS = 128

type ReceiptRecord = {
  receipt: TerminalReceipt
  extensionId: string
  browserId: string
  origin: string
  session: FigmaSession
  taskId?: string
  epoch?: number
  write: boolean
}

/** Process-local authority for completed calls, never a queue of calls to execute. */
export class TerminalReceipts {
  readonly generation = randomUUID()
  private readonly pending = new Map<string, ReceiptRecord>()
  private readonly completed = new Map<string, ReceiptRecord>()

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
    if (
      !extension.runtime?.terminalReceipts ||
      session.documentId === undefined ||
      session.tabId === undefined
    )
      return
    if (this.pending.size >= MAX_RECEIPTS)
      throw Object.assign(
        new Error(
          'Too many calls await a terminal receipt. Wait for completion acknowledgments or reload the executing Figma tabs before continuing.'
        ),
        { code: 'DESIGN_TASK_BUSY' }
      )
    const receipt = { generation: this.generation, receiptId: randomUUID() }
    this.pending.set(requestId, {
      receipt,
      extensionId: extension.id,
      browserId: extension.sessions!.browserId,
      origin: extension.origin,
      session: { ...session },
      taskId,
      epoch,
      write
    })
    return receipt
  }

  settle(requestId: string, extensionId: string, definitive = true): void {
    const record = this.pending.get(requestId)
    if (!record || record.extensionId !== extensionId || (!definitive && record.write)) return
    this.pending.delete(requestId)
    this.completed.set(requestId, record)
    if (this.completed.size > MAX_RECEIPTS)
      this.completed.delete(this.completed.keys().next().value!)
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
      message.generation !== this.generation ||
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
    for (const [id, record] of this.pending) {
      if (record.browserId !== snapshot.browserId || record.origin !== extension.origin) continue
      const closed =
        snapshot.openTabIds !== undefined && !snapshot.openTabIds.includes(record.session.tabId!)
      const replaced = snapshot.sessions.some(
        (session) =>
          session.tabId === record.session.tabId &&
          session.documentId !== undefined &&
          session.documentId !== record.session.documentId
      )
      if (closed || replaced) this.pending.delete(id)
    }
  }
}
