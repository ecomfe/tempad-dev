import { setTimeout as delay } from 'node:timers/promises'

import { CodexIpc } from './codex-ipc'
import { CodexTurnState, type CodexLifecycleState } from './codex-turn-state'

export type { CodexTurn, CodexLifecycleState } from './codex-turn-state'

type ObjectValue = Record<string, unknown>
type Connection = Pick<
  CodexIpc,
  'owner' | 'request' | 'broadcast' | 'onBroadcast' | 'onDisconnect' | 'close'
>

function object(value: unknown): ObjectValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : {}
}

/** Follow the existing App owner. Never start another app-server or acquire ownership. */
export class CodexAppLifecycle {
  private readonly watches = new Map<
    string,
    { controller: AbortController; state?: CodexLifecycleState }
  >()
  private closed = false

  constructor(
    private readonly changed: (
      conversationId: string,
      state: CodexLifecycleState | undefined
    ) => void,
    private readonly open: () => Promise<Connection> = () => CodexIpc.open(),
    private readonly retryMs = 2000,
    private readonly snapshotTimeoutMs = 5000
  ) {}

  watch(conversationId: string): void {
    if (this.closed || this.watches.has(conversationId) || this.watches.size >= 128) return
    const watch = {
      controller: new AbortController(),
      state: undefined as CodexLifecycleState | undefined
    }
    this.watches.set(conversationId, watch)
    void this.follow(conversationId, watch)
  }

  state(conversationId: string): CodexLifecycleState | undefined {
    return this.watches.get(conversationId)?.state
  }

  retain(conversationIds: Set<string>): void {
    for (const [id, watch] of this.watches) {
      if (conversationIds.has(id)) continue
      watch.controller.abort()
      this.watches.delete(id)
    }
  }

  async interrupt(conversationId: string, expectedTurnId: string): Promise<boolean> {
    const connection = await this.open()
    try {
      const owner = await connection.owner(conversationId, undefined, 2000)
      const response = await connection.request(
        'thread-follower-interrupt-turn',
        4,
        {
          conversationId,
          mode: 'user-stop',
          expectedTurnId
        },
        owner
      )
      const result = object(response.result)
      if (
        response.handledByClientId !== owner ||
        result.ok !== true ||
        (result.interruptedTurnId !== null && result.interruptedTurnId !== expectedTurnId)
      )
        throw new Error('Codex did not confirm the requested turn interruption.')
      return result.interruptedTurnId === expectedTurnId
    } finally {
      connection.close()
    }
  }

  private async follow(
    conversationId: string,
    watch: { controller: AbortController; state?: CodexLifecycleState }
  ): Promise<void> {
    const signal = watch.controller.signal
    const publish = (state?: CodexLifecycleState) => {
      if (signal.aborted) return
      const changed = JSON.stringify(watch.state) !== JSON.stringify(state)
      watch.state = state
      if (changed) this.changed(conversationId, state)
    }
    while (!signal.aborted) {
      let connection: Connection | undefined
      let owner: string | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanups: (() => void)[] = []
      try {
        connection = await this.open()
        signal.throwIfAborted()
        owner = await connection.owner(conversationId, signal, 2000)
        signal.throwIfAborted()
        const ipc = connection
        const ownerId = owner
        await new Promise<void>((resolve, reject) => {
          let revision: number | undefined
          let turns: CodexTurnState | undefined
          let awaitingSnapshot = false
          const requestSnapshot = () => {
            if (awaitingSnapshot) return
            awaitingSnapshot = true
            turns = undefined
            publish()
            timer = setTimeout(
              () => reject(new Error('Codex snapshot timed out.')),
              this.snapshotTimeoutMs
            )
            ipc.broadcast(
              'thread-stream-following-changed',
              1,
              { hostId: 'local', conversationId, following: true },
              [ownerId]
            )
          }
          cleanups.push(ipc.onDisconnect(resolve))
          const abort = () => resolve()
          signal.addEventListener('abort', abort, { once: true })
          cleanups.push(() => signal.removeEventListener('abort', abort))
          cleanups.push(
            ipc.onBroadcast((message) => {
              try {
                const params = object(message.params)
                if (
                  message.method === 'ipc-connection-reset' ||
                  (message.method === 'client-status-changed' &&
                    params.clientId === ownerId &&
                    params.status === 'disconnected')
                ) {
                  resolve()
                  return
                }
                if (
                  params.hostId !== 'local' ||
                  params.conversationId !== conversationId ||
                  message.sourceClientId !== ownerId
                )
                  return
                if (message.method === 'thread-stream-following-status-requested') {
                  ipc.broadcast(
                    'thread-stream-following-changed',
                    1,
                    { hostId: 'local', conversationId, following: true },
                    [ownerId]
                  )
                  return
                }
                if (message.method !== 'thread-stream-state-changed') return
                if (message.version !== 11) throw new Error('Unsupported Codex stream version.')
                const change = object(params.change)
                if (!Number.isSafeInteger(change.revision))
                  throw new Error('Invalid Codex stream revision.')
                if (change.type === 'snapshot') {
                  if (revision !== undefined && (change.revision as number) < revision) return
                  turns = new CodexTurnState(change.conversationState, conversationId)
                  const state = turns.state()
                  clearTimeout(timer)
                  awaitingSnapshot = false
                  revision = change.revision as number
                  publish(state)
                } else if (change.type === 'patches') {
                  if (awaitingSnapshot) return
                  if ((change.revision as number) <= (revision ?? -1)) return
                  if (change.baseRevision !== revision || !Array.isArray(change.patches)) {
                    requestSnapshot()
                    return
                  }
                  revision = change.revision as number
                  try {
                    if (!turns) throw new Error('Missing Codex lifecycle snapshot.')
                    if (turns.apply(change.patches)) publish(turns.state())
                  } catch {
                    // A partial or unknown lifecycle batch must never expose stale controls.
                    requestSnapshot()
                  }
                } else throw new Error('Unsupported Codex stream change.')
              } catch (error) {
                reject(error)
              }
            })
          )
          requestSnapshot()
        })
      } catch {
        // Native discovery can be temporarily unavailable; never fall back to hooks.
      } finally {
        clearTimeout(timer)
        for (const cleanup of cleanups) cleanup()
        if (connection && owner) {
          try {
            connection.broadcast(
              'thread-stream-following-changed',
              1,
              { hostId: 'local', conversationId, following: false },
              [owner]
            )
          } catch {
            /* Already disconnected. */
          }
        }
        connection?.close()
        publish()
      }
      if (!signal.aborted) await delay(this.retryMs, undefined, { signal }).catch(() => {})
    }
  }

  close(): void {
    this.closed = true
    this.retain(new Set())
  }
}
