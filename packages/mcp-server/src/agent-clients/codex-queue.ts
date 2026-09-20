import type { DesignFeedback } from '@tempad-dev/shared'

import { formatDesignFeedback } from '@tempad-dev/shared'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { CodexIpc, CodexIpcError } from './codex-ipc'
import { CodexQueueRpc } from './codex-queue-rpc'
import { readCodexServerQueue } from './codex-server-queue'

type Value = Record<string, unknown>
export type CodexQueuedMessage = Value & { id: string }
export type CodexQueueBackend = 'legacy' | 'server'
export type CodexQueueConnection = Pick<
  CodexIpc,
  'request' | 'broadcast' | 'onBroadcast' | 'onDisconnect'
>

function object(value: unknown): Value {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Codex queue state has an unsupported format.')
  return value as Value
}

export class CodexQueueUnavailable extends Error {}

/** Read only. The native owner commits this file before acknowledging queue writes. */
export async function readCodexQueue(conversationId: string): Promise<CodexQueuedMessage[]> {
  const path = join(process.env.CODEX_HOME || join(homedir(), '.codex'), '.codex-global-state.json')
  let state: Value
  try {
    state = object(JSON.parse(await readFile(path, 'utf8')))
  } catch (cause) {
    throw new CodexQueueUnavailable('The Codex queue snapshot is unavailable.', { cause })
  }
  const queues = state['queued-follow-ups'] == null ? {} : object(state['queued-follow-ups'])
  const messages = queues[conversationId] ?? []
  if (!Array.isArray(messages)) throw new Error('Codex queue state has an unsupported format.')
  const ids = new Set<string>()
  for (const message of messages) {
    const id = object(message).id
    if (typeof id !== 'string' || !id || ids.has(id))
      throw new Error('Codex queue contains invalid or duplicate message identities.')
    ids.add(id)
  }
  return messages
}

export function codexFeedbackQueuedMessage(
  taskId: string,
  feedback: DesignFeedback,
  cwd: string
): CodexQueuedMessage {
  const text = formatDesignFeedback(feedback)
  return {
    id: feedback.id,
    text,
    cwd,
    createdAt: feedback.createdAt,
    context: {
      prompt: text,
      addedFiles: [],
      fileAttachments: [],
      imageAttachments: [],
      commentAttachments: [],
      ideContext: null
      // Let the owner derive workspace roots and permissions from this conversation.
    },
    writingBlockAdditionalContext: {
      'tempad-design-task': { kind: 'untrusted', value: `Design task: ${JSON.stringify(taskId)}` }
    }
  }
}

/** Obtain the original conversation's cwd without guessing from the Hub process. */
async function conversationCwd(
  ipc: CodexQueueConnection,
  owner: string,
  conversationId: string,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted()
  const cleanups: (() => void)[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new CodexQueueUnavailable('Codex queue context timed out.')),
        5000
      )
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      cleanups.push(() => signal.removeEventListener('abort', abort))
      cleanups.push(
        ipc.onDisconnect(() => reject(new CodexQueueUnavailable('Codex disconnected.')))
      )
      cleanups.push(
        ipc.onBroadcast((message) => {
          if (message.method !== 'thread-stream-state-changed' || message.sourceClientId !== owner)
            return
          try {
            const params = object(message.params)
            if (params.conversationId !== conversationId || params.hostId !== 'local') return
            if (message.version !== 11)
              throw new CodexQueueUnavailable('Unsupported Codex snapshot version.')
            const change = object(params.change)
            if (change.type !== 'snapshot') return
            const state = object(change.conversationState)
            if (state.id !== conversationId || typeof state.cwd !== 'string' || !state.cwd)
              throw new CodexQueueUnavailable('The original Codex workspace is unavailable.')
            resolve(state.cwd)
          } catch (error) {
            reject(error)
          }
        })
      )
      ipc.broadcast(
        'thread-stream-following-changed',
        1,
        { hostId: 'local', conversationId, following: true },
        [owner]
      )
    })
  } finally {
    clearTimeout(timer)
    for (const cleanup of cleanups) cleanup()
    try {
      ipc.broadcast(
        'thread-stream-following-changed',
        1,
        { hostId: 'local', conversationId, following: false },
        [owner]
      )
    } catch {
      /* Already disconnected. */
    }
  }
}

export class CodexNativeQueue {
  constructor(
    private readonly readLegacy: typeof readCodexQueue = readCodexQueue,
    private readonly readServer: typeof readCodexServerQueue = readCodexServerQueue,
    private readonly server: Pick<
      CodexQueueRpc,
      'list' | 'add' | 'remove' | 'close'
    > = new CodexQueueRpc()
  ) {}

  async read(
    conversationId: string,
    backend: CodexQueueBackend = 'legacy'
  ): Promise<CodexQueuedMessage[]> {
    if (backend === 'legacy') return this.readLegacy(conversationId)
    return (await this.server.list(conversationId)).map((message) => ({
      id: message.clientUserMessageId ?? message.id,
      text: message.input
        .filter((input) => input.type === 'text')
        .map((input) => input.text)
        .join('\n')
    }))
  }

  /** Direct Start must not overtake either native queue while native admission is unavailable. */
  async areQueuesEmpty(conversationId: string): Promise<boolean> {
    const server = await this.readServer(conversationId)
    const messages = await this.read(conversationId)
    return !server?.hasMessages && messages.length === 0
  }

  async admit(
    ipc: CodexQueueConnection,
    owner: string,
    conversationId: string,
    taskId: string,
    feedback: DesignFeedback,
    signal: AbortSignal,
    beforeWrite: (backend: CodexQueueBackend) => Promise<void>,
    onDispatch: () => void
  ): Promise<void> {
    const cwd = await conversationCwd(ipc, owner, conversationId, signal)
    const server = await this.readServer(conversationId)
    // A populated legacy queue wins in the native composer as well.
    const backend =
      server && (await this.readLegacy(conversationId)).length === 0 ? 'server' : 'legacy'
    // Reserve the backend before any admission, including an uncertain server response.
    await beforeWrite(backend)
    const messages = await this.read(conversationId, backend)
    signal.throwIfAborted()
    if (backend === 'server') {
      const text = formatDesignFeedback(feedback)
      const existing = messages.find((message) => message.id === feedback.id)
      if (existing) {
        if (existing.text !== text)
          throw new Error('This Codex queue identity belongs to different content.')
        return
      }
      onDispatch()
      await this.server.add(conversationId, feedback.id, text, signal)
      return
    }
    const existing = messages.find((message) => message.id === feedback.id)
    if (existing) {
      if (
        existing.text !== formatDesignFeedback(feedback) ||
        JSON.stringify(existing.writingBlockAdditionalContext) !==
          JSON.stringify(
            codexFeedbackQueuedMessage(taskId, feedback, cwd).writingBlockAdditionalContext
          )
      )
        throw new Error('This Codex queue identity belongs to different content.')
      return
    }
    onDispatch()
    await this.replace(
      ipc,
      owner,
      conversationId,
      [...messages, codexFeedbackQueuedMessage(taskId, feedback, cwd)],
      signal
    )
  }

  async remove(
    ipc: CodexQueueConnection | undefined,
    owner: string | undefined,
    conversationId: string,
    ids: Set<string>,
    signal: AbortSignal,
    backend: CodexQueueBackend = 'legacy'
  ): Promise<void> {
    if (backend === 'server') {
      for (const message of await this.server.list(conversationId, signal)) {
        if (message.clientUserMessageId && ids.has(message.clientUserMessageId))
          await this.server.remove(conversationId, message.id, signal)
      }
      return
    }
    const messages = await this.read(conversationId)
    const remaining = messages.filter((message) => !ids.has(message.id))
    if (remaining.length !== messages.length) {
      if (!ipc || !owner) throw new Error('The Codex queue owner is unavailable.')
      await this.replace(ipc, owner, conversationId, remaining, signal)
    }
  }

  close(): void {
    this.server.close()
  }

  private async replace(
    ipc: CodexQueueConnection,
    owner: string,
    conversationId: string,
    messages: CodexQueuedMessage[],
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted()
    const response = await ipc.request(
      'thread-follower-set-queued-follow-ups-state',
      1,
      { conversationId, state: { [conversationId]: messages } },
      owner,
      signal
    )
    if (response.handledByClientId !== owner || object(response.result).ok !== true)
      throw new CodexIpcError('Codex did not confirm queue admission.', true)
  }
}
