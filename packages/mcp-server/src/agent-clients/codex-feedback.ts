import type { AgentCapabilities, DesignFeedback } from '@tempad-dev/shared'

import { formatDesignFeedback } from '@tempad-dev/shared'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, opendir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import type { ClientBinding } from './types'

import { HISTORY_RETENTION_MS } from '../history-retention'
import { CodexDiscoveryError, CodexIpc, CodexIpcError } from './codex-ipc'
import {
  CodexNativeQueue,
  CodexQueueUnavailable,
  type CodexQueueBackend,
  type CodexQueueConnection
} from './codex-queue'
import { nativeFeedback } from './types'

export const CODEX_APP_FEEDBACK: AgentCapabilities = {
  interrupt: false,
  continue: false,
  queue: true,
  steer: true,
  queueDelivery: 'native',
  steerDelivery: 'native',
  reason:
    'Queue waits for the current response to finish. Steer sends comments to the active response.'
}

export function codexFeedbackTurn(
  conversationId: string,
  taskId: string,
  feedback: DesignFeedback
) {
  const callId = `tempad-comments-${feedback.id}`
  return {
    request: {
      threadId: conversationId,
      clientUserMessageId: feedback.id,
      input: [
        {
          type: 'text',
          text: formatDesignFeedback(feedback),
          text_elements: []
        }
      ]
    },
    context: {
      // Nonempty app context makes the host reject busy turns before creation, preserving Queue.
      responseItems: [
        { type: 'function_call', call_id: callId, name: 'untrusted_input', arguments: '{}' },
        {
          type: 'function_call_output',
          call_id: callId,
          output: [
            {
              type: 'input_text',
              // A conversation can own multiple design tasks.
              text: `Design task: ${JSON.stringify(taskId)}`
            }
          ]
        }
      ]
    }
  }
}

export function codexFeedbackSteer(
  conversationId: string,
  taskId: string,
  feedback: DesignFeedback
) {
  const text = formatDesignFeedback(feedback)
  return {
    conversationId,
    clientUserMessageId: feedback.id,
    input: [{ type: 'text', text, text_elements: [] }],
    restoreMessage: { text, context: {} },
    additionalContext: {
      'tempad-design-task': { kind: 'untrusted', value: `Design task: ${JSON.stringify(taskId)}` }
    }
  }
}

type Connection = Pick<CodexIpc, 'owner' | 'close'> & CodexQueueConnection
type Receipt = {
  signature: string
  status: string
  delivery?: 'queue'
  conversationId?: string
  taskId?: string
  messageId?: string
  backend?: CodexQueueBackend
  turnId?: string
  acceptedAt?: number
  feedbackCreatedAt?: number
  queueCommitConfirmed?: boolean
}
type QueueReceipt = Receipt &
  Required<Pick<Receipt, 'delivery' | 'conversationId' | 'taskId' | 'messageId'>>
type StoredReceipt = { path: string; receipt: Receipt }
type StoredQueueReceipt = { path: string; receipt: QueueReceipt }

const MAX_FEEDBACK_CLOCK_SKEW_MS = 5 * 60000

function assertFreshFeedback(feedback: DesignFeedback): void {
  const now = Date.now()
  if (feedback.createdAt <= now - HISTORY_RETENTION_MS)
    throw new Error(
      'Feedback submission expired. Check the original conversation before editing your comments to create a new submission.'
    )
  if (!Number.isFinite(feedback.createdAt) || feedback.createdAt > now + MAX_FEEDBACK_CLOCK_SKEW_MS)
    throw new Error(
      'Feedback submission time is in the future. Check your clock before editing your comments to create a new submission.'
    )
}

function isQueueReceipt(receipt: Receipt): receipt is QueueReceipt {
  return (
    receipt.delivery === 'queue' &&
    typeof receipt.conversationId === 'string' &&
    typeof receipt.taskId === 'string' &&
    typeof receipt.messageId === 'string' &&
    (receipt.backend === undefined || receipt.backend === 'legacy' || receipt.backend === 'server')
  )
}

async function loadConversation(conversationId: string, signal: AbortSignal): Promise<void> {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(conversationId))
    throw new Error('Open the original conversation in Codex before sending these comments.')
  const url = `codex://threads/${conversationId}`
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: ['-g', url] }
      : process.platform === 'win32'
        ? { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
        : undefined
  if (!command)
    throw new Error('Open the original conversation in Codex before sending these comments.')
  await promisify(execFile)(command.file, command.args, {
    signal,
    timeout: 5000
  })
}

function isUnloadedConversation(error: unknown): boolean {
  return error instanceof CodexIpcError && !error.uncertain && error.message === 'no-client-found'
}

export class CodexAppFeedback {
  private readonly shutdown = new AbortController()
  private readonly cancelledTasks = new Set<string>()
  private readonly pendingTasks = new Map<string, Promise<void>>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly availability = new Map<string, { available: boolean; expiresAt: number }>()
  private receiptScan?: AsyncGenerator<string>
  private reconciliation?: Promise<void>

  constructor(
    private readonly directory: string,
    private readonly open: () => Promise<Connection> = () => CodexIpc.open(),
    private readonly retryMs = 1000,
    private readonly load: typeof loadConversation = loadConversation,
    private readonly nativeQueue = new CodexNativeQueue()
  ) {}

  async available(binding: ClientBinding): Promise<boolean> {
    const { sessionId } = binding.client
    if (!sessionId || !nativeFeedback(binding.client) || this.shutdown.signal.aborted) return false
    const cached = this.availability.get(sessionId)
    if (cached && cached.expiresAt > Date.now()) return cached.available
    let connection: Connection | undefined
    let available = false
    try {
      connection = await this.open()
      await connection.owner(sessionId, undefined, 2000)
      available = true
    } catch {
      /* Keep drafts until native conversation delivery becomes available. */
    } finally {
      connection?.close()
    }
    if (this.availability.size >= 256) this.availability.clear()
    this.availability.set(sessionId, { available, expiresAt: Date.now() + 10000 })
    return available
  }

  enqueue(
    binding: ClientBinding,
    taskId: string,
    feedback: DesignFeedback,
    signal: AbortSignal,
    beforeSend: () => void,
    onDispatch: () => void
  ): Promise<void> {
    const conversationId = binding.client.sessionId
    try {
      assertFreshFeedback(feedback)
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.cancelledTasks.has(taskId))
      return Promise.reject(new Error('These design comments were cancelled.'))
    if (!conversationId || !['queue', 'steer'].includes(feedback.mode))
      return Promise.reject(new Error('Native Codex delivery requires Queue or Steer comments.'))
    if (feedback.mode === 'steer' && this.queues.has(conversationId))
      return Promise.reject(
        new Error(
          'Codex already has a pending delivery. Comments are saved; retry when it finishes.'
        )
      )
    if (this.queues.size >= 128)
      return Promise.reject(new Error('Too many pending Codex conversations.'))
    const combined = AbortSignal.any([signal, this.shutdown.signal])
    const pending = this.schedule(conversationId, () =>
      this.deliver(conversationId, taskId, feedback, combined, beforeSend, onDispatch)
    )
    this.pendingTasks.set(taskId, pending)
    void pending
      .finally(() => {
        if (this.pendingTasks.get(taskId) === pending) this.pendingTasks.delete(taskId)
      })
      .catch(() => {})
    return pending
  }

  private schedule(conversationId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(action)
    this.queues.set(conversationId, pending)
    void pending
      .finally(() => {
        if (this.queues.get(conversationId) === pending) this.queues.delete(conversationId)
      })
      .catch(() => {})
    return pending
  }

  private async deliver(
    conversationId: string,
    taskId: string,
    feedback: DesignFeedback,
    signal: AbortSignal,
    beforeSend: () => void,
    onDispatch: () => void
  ): Promise<void> {
    const validate = () => {
      assertFreshFeedback(feedback)
      beforeSend()
    }
    const hash = (text: string) => createHash('sha256').update(text).digest('hex')
    const key = hash(JSON.stringify([conversationId, feedback.fileKey, feedback.id]))
    const signature = hash(JSON.stringify(feedback))
    const path = join(this.directory, `${key}.json`)
    const deadline = Date.now() + 5 * 60000
    const pendingReceipt: Receipt = {
      signature,
      status: 'pending',
      conversationId,
      acceptedAt: Date.now(),
      feedbackCreatedAt: feedback.createdAt
    }
    let loaded = false
    let nativeQueueUnavailable = false
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    while (true) {
      signal.throwIfAborted()
      validate()
      let existing: Receipt | undefined
      try {
        existing = JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (existing) {
        if (existing.signature !== signature || (existing.taskId && existing.taskId !== taskId))
          throw new Error('This comment delivery ID already belongs to different content or task.')
        onDispatch()
        if (existing.status === 'delivered') return
        if (['cancelled', 'removed'].includes(existing.status))
          throw new Error('These queued comments were cancelled.')
        if (
          existing.delivery === 'queue' &&
          (await this.nativeQueue.read(conversationId, existing.backend)).some(
            (message) => message.id === feedback.id
          )
        ) {
          await this.saveReceipt(path, {
            ...existing,
            status: 'delivered',
            queueCommitConfirmed: true
          })
          return
        }
        throw new Error(
          'Earlier Codex delivery is uncertain. Check the original conversation; these comments will not be resent automatically.'
        )
      }
      if (
        feedback.mode === 'queue' &&
        nativeQueueUnavailable &&
        !(await this.nativeQueue.areQueuesEmpty(conversationId))
      ) {
        if (Date.now() >= deadline)
          throw new Error('Codex still has queued messages. Comments are saved; retry later.')
        await delay(this.retryMs, undefined, { signal })
        continue
      }
      const connection = await this.open()
      try {
        let owner: string
        try {
          owner = await connection.owner(conversationId, signal)
        } catch (error) {
          if (!isUnloadedConversation(error) || loaded) throw error
          signal.throwIfAborted()
          validate()
          loaded = true
          owner = await this.loadOwner(connection, conversationId, signal, validate)
        }
        this.availability.delete(conversationId)
        signal.throwIfAborted()
        validate()
        // Reserve before writing to IPC so a Hub restart cannot duplicate an uncertain submission.
        await writeFile(path, JSON.stringify(pendingReceipt), {
          flag: 'wx',
          mode: 0o600
        })
        try {
          signal.throwIfAborted()
          validate()
        } catch (error) {
          await unlink(path)
          throw error
        }
        if (feedback.mode === 'queue' && !nativeQueueUnavailable) {
          const receipt: Receipt = {
            ...pendingReceipt,
            delivery: 'queue',
            conversationId,
            taskId,
            messageId: feedback.id
          }
          let attempted = false
          try {
            await this.nativeQueue.admit(
              connection,
              owner,
              conversationId,
              taskId,
              feedback,
              signal,
              async (backend) => {
                receipt.backend = backend
                await this.saveReceipt(path, receipt)
                signal.throwIfAborted()
                validate()
              },
              () => {
                validate()
                attempted = true
              }
            )
            onDispatch()
            await this.saveReceipt(path, {
              ...receipt,
              status: 'delivered',
              queueCommitConfirmed: true
            })
            return
          } catch (error) {
            if (!attempted || (error instanceof CodexIpcError && !error.uncertain)) {
              await unlink(path)
              if (!(error instanceof CodexQueueUnavailable)) throw error
              // Avoid repeating full conversation snapshots on every busy-turn retry.
              nativeQueueUnavailable = true
              // Recheck both queues before the bounded idle-turn fallback. A pending
              // native queue must not be bypassed, and waiting reserves no receipt.
              if (!(await this.nativeQueue.areQueuesEmpty(conversationId))) continue
              await writeFile(path, JSON.stringify(pendingReceipt), {
                flag: 'wx',
                mode: 0o600
              })
            } else {
              onDispatch()
              const admitted = await this.nativeQueue
                .read(conversationId, receipt.backend)
                .then((messages) => messages.some((message) => message.id === feedback.id))
                .catch(() => false)
              if (admitted) {
                await this.saveReceipt(path, {
                  ...receipt,
                  status: 'delivered',
                  queueCommitConfirmed: true
                })
                return
              }
              throw new Error(
                'Codex queue admission is uncertain. Check the original conversation; comments will not be queued again automatically.',
                { cause: error }
              )
            }
          }
        }
        let response: Record<string, unknown>
        let steered = false
        try {
          signal.throwIfAborted()
          validate()
        } catch (error) {
          await unlink(path)
          throw error
        }
        try {
          response = await connection.request(
            'thread-follower-start-turn',
            2,
            { conversationId, turnStart: codexFeedbackTurn(conversationId, taskId, feedback) },
            owner,
            signal
          )
        } catch (error) {
          // Only this known pre-creation rejection permits Steer or a later Queue retry.
          if (
            !(error instanceof CodexIpcError) ||
            error.uncertain ||
            error.message !== 'App context must wait until the current turn finishes'
          ) {
            onDispatch()
            throw new Error(
              'Codex delivery could not be confirmed. Check the original conversation; drafts are retained and will not be resent automatically.',
              { cause: error }
            )
          }
          if (feedback.mode === 'steer') {
            // The busy rejection happened before creation. Keep the same durable receipt
            // and user-message identity while switching to the owner's active turn.
            try {
              signal.throwIfAborted()
              validate()
            } catch (error) {
              await unlink(path)
              throw error
            }
            try {
              steered = true
              response = await connection.request(
                'thread-follower-steer-turn',
                1,
                codexFeedbackSteer(conversationId, taskId, feedback),
                owner,
                signal
              )
            } catch (error) {
              if (
                error instanceof CodexIpcError &&
                !error.uncertain &&
                error.message ===
                  `Cannot steer conversation ${conversationId} because its active turn already ended`
              ) {
                await unlink(path)
                throw new Error(
                  'Codex finished before Steer arrived. Comments are saved; retry to start a new response.',
                  { cause: error }
                )
              }
              onDispatch()
              throw new Error(
                'Codex Steer could not be confirmed. Check the original conversation; drafts are retained and will not be resent automatically.',
                { cause: error }
              )
            }
          } else {
            await unlink(path)
            if (Date.now() >= deadline)
              throw new Error(
                'Codex is still busy. Comments are saved; retry when the current response ends.',
                { cause: error }
              )
            response = {}
          }
        }
        if (response.resultType === 'success') {
          onDispatch()
          const result = response.result as
            | { result?: { turn?: { id?: unknown }; turnId?: unknown } }
            | undefined
          const turnId = steered ? result?.result?.turnId : result?.result?.turn?.id
          if (response.handledByClientId !== owner || typeof turnId !== 'string' || !turnId)
            throw new Error(
              'Codex did not confirm the feedback turn. Check the conversation before retrying.'
            )
          await this.saveReceipt(path, { ...pendingReceipt, status: 'delivered', turnId })
          return
        }
      } finally {
        connection.close()
      }
      await delay(this.retryMs, undefined, { signal })
    }
  }

  private async saveReceipt(path: string, receipt: Receipt): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(receipt), { mode: 0o600 })
      await rename(temp, path)
    } finally {
      await unlink(temp).catch(() => {})
    }
  }

  /** Fence receipts first, then remove only this task's native queue entries. */
  async cancelQueued(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId)
    await this.pendingTasks.get(taskId)?.catch(() => {})
    const queues = new Map<string, QueueReceipt>()
    for (const { receipt } of await this.queueReceipts()) {
      if (receipt.taskId === taskId)
        queues.set(JSON.stringify([receipt.conversationId, receipt.backend ?? 'legacy']), receipt)
    }
    for (const { conversationId, backend = 'legacy' } of queues.values()) {
      await this.schedule(conversationId, async () => {
        const receipts = (await this.queueReceipts()).filter(
          ({ receipt }) =>
            receipt.taskId === taskId &&
            receipt.conversationId === conversationId &&
            (receipt.backend ?? 'legacy') === backend &&
            receipt.messageId
        )
        if (!receipts.length) return
        const ids = new Set(receipts.map(({ receipt }) => receipt.messageId))
        for (const { path, receipt } of receipts) {
          if (receipt.status !== 'removed')
            await this.saveReceipt(path, {
              ...receipt,
              status: 'cancelled',
              queueCommitConfirmed:
                receipt.queueCommitConfirmed === true || receipt.status === 'delivered'
            })
        }
        const observed = new Set(
          (await this.nativeQueue.read(conversationId, backend)).map((message) => message.id)
        )
        const hasMessages = receipts.some(({ receipt }) => observed.has(receipt.messageId))
        for (const { path, receipt } of receipts) {
          if (observed.has(receipt.messageId) && receipt.queueCommitConfirmed !== true) {
            receipt.queueCommitConfirmed = true
            await this.saveReceipt(path, { ...receipt, status: 'cancelled' })
          }
        }
        let connection: Connection | undefined
        try {
          if (hasMessages) {
            let owner: string | undefined
            if (backend === 'legacy') {
              connection = await this.open()
              owner = await connection.owner(conversationId, this.shutdown.signal)
            }
            await this.nativeQueue.remove(
              connection,
              owner,
              conversationId,
              ids,
              this.shutdown.signal,
              backend
            )
          }
          for (const { path, receipt } of receipts) {
            if (hasMessages || receipt.status !== 'removed')
              await this.saveReceipt(path, {
                ...receipt,
                status: 'removed',
                queueCommitConfirmed:
                  receipt.queueCommitConfirmed === true ||
                  receipt.status === 'delivered' ||
                  observed.has(receipt.messageId)
              })
          }
        } finally {
          connection?.close()
        }
      })
    }
  }

  async reconcileQueued(isCancelled: (taskId: string) => boolean): Promise<void> {
    if (this.shutdown.signal.aborted) return
    if (this.reconciliation) return this.reconciliation
    const pending = this.reconcileReceipts(isCancelled)
    this.reconciliation = pending
    try {
      await pending
    } finally {
      this.reconciliation = undefined
    }
  }

  private async reconcileReceipts(isCancelled: (taskId: string) => boolean): Promise<void> {
    const tasks = new Set<string>()
    const snapshots = new Map<string, Set<string> | undefined>()
    const entries = await this.receipts(true)
    for (const { receipt } of entries) {
      if (!isQueueReceipt(receipt)) continue
      if (!['cancelled', 'removed'].includes(receipt.status) && !isCancelled(receipt.taskId))
        continue
      if (receipt.status !== 'removed') {
        tasks.add(receipt.taskId)
        continue
      }
      // Keep cancellation tombstones: a disconnected writer can commit after the first removal check.
      const key = JSON.stringify([receipt.conversationId, receipt.backend ?? 'legacy'])
      let ids = snapshots.get(key)
      if (!snapshots.has(key)) {
        const messages = await this.nativeQueue
          .readForReconciliation(receipt.conversationId, receipt.backend)
          .catch(() => undefined)
        ids = messages ? new Set(messages.map((message) => message.id)) : undefined
        snapshots.set(key, ids)
      }
      if (ids?.has(receipt.messageId)) tasks.add(receipt.taskId)
    }
    for (const task of tasks) await this.cancelQueued(task).catch(() => {})
    for (const entry of entries) {
      if (
        entry.receipt.status !== 'delivered' &&
        !(entry.receipt.status === 'removed' && entry.receipt.queueCommitConfirmed === true)
      )
        continue
      if (entry.receipt.conversationId && this.queues.has(entry.receipt.conversationId)) continue
      const prune = () => this.pruneReceipt(entry.path)
      // Serialize against admission and Stop, then re-read rather than pruning a scan snapshot.
      if (entry.receipt.conversationId) await this.schedule(entry.receipt.conversationId, prune)
      else await prune()
    }
  }

  private async pruneReceipt(path: string): Promise<void> {
    let receipt: Receipt
    try {
      receipt = JSON.parse(await readFile(path, 'utf8')) as Receipt
    } catch {
      return
    }
    if (
      receipt.status !== 'delivered' &&
      !(receipt.status === 'removed' && receipt.queueCommitConfirmed === true)
    )
      return
    if (receipt.delivery === 'queue' && !isQueueReceipt(receipt)) return
    if (!Number.isFinite(receipt.acceptedAt)) {
      // Old receipts have no trustworthy acceptance date. Start a conservative window now.
      await this.saveReceipt(path, { ...receipt, acceptedAt: Date.now() })
      return
    }
    const expiresAt =
      Math.max(
        receipt.acceptedAt!,
        receipt.feedbackCreatedAt ?? receipt.acceptedAt! + MAX_FEEDBACK_CLOCK_SKEW_MS
      ) + HISTORY_RETENTION_MS
    if (Date.now() < expiresAt) return
    if (isQueueReceipt(receipt)) {
      const messages = await this.nativeQueue
        .readForReconciliation(receipt.conversationId, receipt.backend)
        .catch(() => undefined)
      if (!messages || messages.some((message) => message.id === receipt.messageId)) return
    }
    await unlink(path)
  }

  private async *receiptFiles(): AsyncGenerator<string> {
    let directory
    try {
      directory = await opendir(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for await (const entry of directory) yield entry.name
  }

  private async queueReceipts(): Promise<StoredQueueReceipt[]> {
    return (await this.receipts()).filter((entry): entry is StoredQueueReceipt =>
      isQueueReceipt(entry.receipt)
    )
  }

  private async receipts(background = false): Promise<StoredReceipt[]> {
    const entries: StoredReceipt[] = []
    // Stop scans all receipts immediately. Background polls advance a bounded cursor,
    // retaining every identity without re-reading all historical receipts each tick.
    const files = background ? (this.receiptScan ??= this.receiptFiles()) : this.receiptFiles()
    try {
      for (let index = 0; index < (background ? 128 : Infinity); index++) {
        const next = await files.next()
        if (next.done) {
          if (background) this.receiptScan = undefined
          break
        }
        const file = next.value
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
        const path = join(this.directory, file)
        try {
          const receipt = JSON.parse(await readFile(path, 'utf8')) as Receipt
          if (typeof receipt?.signature === 'string' && typeof receipt.status === 'string')
            entries.push({ path, receipt })
        } catch {
          /* A removed or malformed receipt cannot block other conversations. */
        }
      }
    } catch (error) {
      if (background) this.receiptScan = undefined
      throw error
    } finally {
      if (!background) await files.return(undefined)
    }
    return entries
  }

  private async loadOwner(
    connection: Connection,
    conversationId: string,
    signal: AbortSignal,
    beforeSend: () => void
  ): Promise<string> {
    try {
      // Only an explicit submission may load its original task. Polls never navigate.
      await this.load(conversationId, signal)
      const deadline = Date.now() + 5000
      while (true) {
        signal.throwIfAborted()
        beforeSend()
        try {
          // A discovery started before the owner loads will not notice its later arrival.
          return await connection.owner(
            conversationId,
            signal,
            Math.max(1, Math.min(1000, deadline - Date.now()))
          )
        } catch (error) {
          if (
            (!isUnloadedConversation(error) && !(error instanceof CodexDiscoveryError)) ||
            Date.now() >= deadline
          )
            throw error
        }
        await delay(Math.min(this.retryMs, 250), undefined, { signal })
      }
    } catch (error) {
      signal.throwIfAborted()
      beforeSend()
      throw new Error(
        `Codex could not load the original conversation. Comments are saved. ${error instanceof Error ? error.message : 'Try opening the original conversation in Codex.'}`,
        { cause: error }
      )
    }
  }

  close(): void {
    this.shutdown.abort()
    void this.receiptScan?.return(undefined).catch(() => {})
    this.receiptScan = undefined
    this.nativeQueue.close()
  }
}
