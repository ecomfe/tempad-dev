import type { AgentCapabilities, DesignFeedback } from '@tempad-dev/shared'

import { formatDesignFeedback } from '@tempad-dev/shared'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import type { ClientBinding } from './types'

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
}
type QueueReceipt = Required<Omit<Receipt, 'backend'>> & Pick<Receipt, 'backend'>
type StoredQueueReceipt = { path: string; receipt: QueueReceipt }

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
  private readonly taskConversations = new Map<string, string>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly availability = new Map<string, { available: boolean; expiresAt: number }>()

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
    this.taskConversations.set(taskId, conversationId)
    const combined = AbortSignal.any([signal, this.shutdown.signal])
    return this.schedule(conversationId, () =>
      this.deliver(conversationId, taskId, feedback, combined, beforeSend, onDispatch)
    )
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
    const hash = (text: string) => createHash('sha256').update(text).digest('hex')
    const key = hash(JSON.stringify([conversationId, feedback.fileKey, feedback.id]))
    const signature = hash(JSON.stringify(feedback))
    const path = join(this.directory, `${key}.json`)
    const deadline = Date.now() + 5 * 60000
    let loaded = false
    let nativeQueueUnavailable = false
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    while (true) {
      signal.throwIfAborted()
      beforeSend()
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
          await this.saveReceipt(path, { ...existing, status: 'delivered' })
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
          beforeSend()
          loaded = true
          owner = await this.loadOwner(connection, conversationId, signal, beforeSend)
        }
        this.availability.delete(conversationId)
        signal.throwIfAborted()
        beforeSend()
        // Reserve before writing to IPC so a Hub restart cannot duplicate an uncertain submission.
        await writeFile(path, JSON.stringify({ signature, status: 'pending' }), {
          flag: 'wx',
          mode: 0o600
        })
        try {
          signal.throwIfAborted()
          beforeSend()
        } catch (error) {
          await unlink(path)
          throw error
        }
        if (feedback.mode === 'queue' && !nativeQueueUnavailable) {
          const receipt: Receipt = {
            signature,
            status: 'pending',
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
                beforeSend()
              },
              () => {
                beforeSend()
                attempted = true
              }
            )
            onDispatch()
            await this.saveReceipt(path, { ...receipt, status: 'delivered' })
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
              await writeFile(path, JSON.stringify({ signature, status: 'pending' }), {
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
                await this.saveReceipt(path, { ...receipt, status: 'delivered' })
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
              beforeSend()
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
          const temp = `${path}.${randomUUID()}.tmp`
          await writeFile(temp, JSON.stringify({ signature, status: 'delivered', turnId }), {
            mode: 0o600
          })
          await rename(temp, path)
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
    const pendingConversation = this.taskConversations.get(taskId)
    if (pendingConversation) await this.queues.get(pendingConversation)?.catch(() => {})
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
            await this.saveReceipt(path, { ...receipt, status: 'cancelled' })
        }
        const hasMessages = (await this.nativeQueue.read(conversationId, backend)).some((message) =>
          ids.has(message.id)
        )
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
              await this.saveReceipt(path, { ...receipt, status: 'removed' })
          }
        } finally {
          connection?.close()
        }
      })
    }
  }

  async reconcileQueued(isCancelled: (taskId: string) => boolean): Promise<void> {
    const tasks = new Set<string>()
    const snapshots = new Map<string, Set<string>>()
    for (const { receipt } of await this.queueReceipts()) {
      if (!['cancelled', 'removed'].includes(receipt.status) && !isCancelled(receipt.taskId))
        continue
      if (receipt.status !== 'removed') {
        tasks.add(receipt.taskId)
        continue
      }
      // Keep cancellation tombstones: a disconnected writer can commit after the first removal check.
      const key = JSON.stringify([receipt.conversationId, receipt.backend ?? 'legacy'])
      let ids = snapshots.get(key)
      if (!ids) {
        const messages = await this.nativeQueue
          .read(receipt.conversationId, receipt.backend)
          .catch(() => undefined)
        if (!messages) continue
        ids = new Set(messages.map((message) => message.id))
        snapshots.set(key, ids)
      }
      if (ids.has(receipt.messageId)) tasks.add(receipt.taskId)
    }
    for (const task of tasks) await this.cancelQueued(task).catch(() => {})
  }

  private async queueReceipts(): Promise<StoredQueueReceipt[]> {
    const entries: StoredQueueReceipt[] = []
    const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[]
      throw error
    })
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
      const path = join(this.directory, file)
      try {
        const receipt = JSON.parse(await readFile(path, 'utf8')) as Receipt
        if (
          receipt?.delivery === 'queue' &&
          typeof receipt.signature === 'string' &&
          typeof receipt.status === 'string' &&
          typeof receipt.conversationId === 'string' &&
          typeof receipt.taskId === 'string' &&
          (receipt.backend === undefined ||
            receipt.backend === 'legacy' ||
            receipt.backend === 'server') &&
          typeof receipt.messageId === 'string'
        )
          entries.push({ path, receipt: receipt as QueueReceipt })
      } catch {
        /* A removed or malformed receipt cannot block other conversations. */
      }
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
    this.nativeQueue.close()
  }
}
