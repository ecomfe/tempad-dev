import type { DesignAction, DesignActionResult } from '@tempad-dev/shared'

import type { ClientBindingUpdate } from '../client-binding'
import type { CodexAppLifecycle, CodexLifecycleState } from './codex-lifecycle'
import type { HostContext } from './host-context'
import type { ClientBinding } from './types'

import { getVerifiedTaskClient, type DesignTasks } from '../design-tasks'
import { HISTORY_RETENTION_MS } from '../history-retention'
import { log } from '../shared'
import { CODEX_APP_FEEDBACK, type CodexAppFeedback } from './codex-feedback'
import { ClientHooks, type ClientHook } from './hooks'
import {
  HostContextSchema,
  MISSING_HOST_CONTEXT_MESSAGE,
  codexStoreKey,
  hostContextKey,
  hostConversationKey
} from './host-context'
import { bindRequestMetadata, clientDescriptor, ClientEventSchema } from './identity'
import {
  CANVAS_ONLY,
  CODEX_FEEDBACK_UNAVAILABLE,
  nativeConversation,
  nativeFeedback
} from './types'

/** A turn is a safe target only when the conversation has exactly one in progress. */
function soleActiveTurn(state?: CodexLifecycleState): string | undefined {
  const active = state?.turns.filter((turn) => turn.status === 'inProgress')
  return active?.length === 1 ? active[0]!.turnId : undefined
}

/** Conversation bindings and native delivery stay outside shared task lifecycle logic. */
export class AgentClients {
  get hasLegacyHooks(): boolean {
    return [...this.connections.values()].some(
      (binding) =>
        binding.client.kind === 'claude' && !this.hooks.receiptCapable(binding.client.sessionId)
    )
  }
  private readonly hooks: ClientHooks
  private readonly connections = new Map<string, ClientBinding>()
  private readonly contexts = new Map<string, HostContext>()
  private readonly pendingClaudeBindings = new Map<
    string,
    { binding: ClientBinding; needsInitialize: boolean }
  >()
  private readonly bindingListeners = new Map<string, (binding: ClientBindingUpdate) => void>()
  private readonly bindings = new Map<string, ClientBinding>()
  private readonly actions = new Map<
    string,
    { signature: string; pending: Promise<DesignActionResult>; settledAt?: number }
  >()
  private readonly feedbackSignals = new Map<string, AbortController>()
  private readonly pendingRemovals = new Set<Promise<void>>()
  private readonly lifecycle?: Pick<
    CodexAppLifecycle,
    'watch' | 'state' | 'retain' | 'interrupt' | 'close'
  >

  constructor(
    private readonly tasks: DesignTasks,
    private readonly codex?: CodexAppFeedback,
    lifecycle?: (
      changed: (
        conversationId: string,
        state: CodexLifecycleState | undefined,
        context?: HostContext
      ) => void
    ) => NonNullable<AgentClients['lifecycle']>
  ) {
    this.hooks = new ClientHooks((input) => tasks.takeClaudeStopNotice(input))
    this.lifecycle = lifecycle?.((id, state, context) => this.onNativeState(id, state, context))
  }

  registerContext(connectionId: string, value: unknown): void {
    const context = HostContextSchema.parse(value)
    const previous = this.contexts.get(connectionId)
    if (previous) {
      if (hostContextKey(previous) !== hostContextKey(context))
        throw new Error('MCP host context cannot change on an existing connection.')
      return
    }
    if (
      [...this.bindings.keys()].some(
        (id) => id === connectionId || id.startsWith(`${connectionId}/`)
      )
    )
      throw new Error('Register MCP host context before using tools.')
    this.contexts.set(connectionId, context)
  }

  get hasPendingActions(): boolean {
    return (
      this.pendingRemovals.size > 0 ||
      [...this.actions.values()].some((action) => action.settledAt === undefined)
    )
  }

  private onNativeState(
    conversationId: string,
    state?: CodexLifecycleState,
    context?: HostContext
  ): void {
    for (const [ownerId, binding] of this.bindings) {
      if (nativeConversation(binding.client) !== conversationId) continue
      if (hostContextKey(binding.hostContext) !== hostContextKey(context)) continue
      const previous = state?.turns.find((turn) => turn.turnId === binding.turnId)
      if (previous && ['completed', 'interrupted', 'failed'].includes(previous.status)) {
        for (const record of this.tasks.list()) {
          if (record.ownerId !== ownerId) continue
          if (previous.status === 'interrupted') this.abortFeedback(record.task.taskId)
          this.tasks.stop(record.task.taskId, 'paused')
        }
      }
      // This broadcast's own state is authoritative here, not the retained lifecycle snapshot.
      const active = soleActiveTurn(state)
      if (active && (!binding.turnId || (previous && previous.status !== 'inProgress')))
        binding.turnId = active
      this.refresh(ownerId)
    }
  }

  clientHook(input: ClientHook, fresh = true) {
    // Older installed Codex packages may still call hooks. Native state is authoritative.
    if (input.kind === 'codex') return {}
    const result = fresh ? this.hooks.handle(input) : this.hooks.reconcile(input)
    if (!result) return {}
    if (input.event === 'PostToolUse' && input.taskId) {
      this.event('hook', {
        method: 'notifications/tempad/client-event',
        params: {
          event: 'taskBound',
          kind: input.kind,
          sessionId: input.sessionId,
          taskId: input.taskId,
          ...(input.turnId ? { turnId: input.turnId } : {})
        }
      })
    }
    if (['UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'].includes(input.event)) {
      this.event('hook', {
        method: 'notifications/tempad/client-event',
        params: {
          event: input.event,
          kind: input.kind,
          sessionId: input.sessionId,
          ...(input.turnId ? { turnId: input.turnId } : {})
        }
      })
    }
    for (const [ownerId, binding] of this.bindings) {
      if (binding.client.sessionId === input.sessionId && binding.client.kind === input.kind)
        this.refresh(ownerId)
    }
    return result
  }

  retireHook(input: ClientHook): void {
    if (input.kind !== 'claude' || !this.hooks.retire(input)) return
    // Require fresh lifecycle evidence to reclaim this session. SessionEnd's
    // cleanup pauses tasks without removing Stop or pending-execution fences.
    this.event('hook', {
      method: 'notifications/tempad/client-event',
      params: { event: 'SessionEnd', kind: input.kind, sessionId: input.sessionId }
    })
  }

  event(connectionId: string, input: unknown): void {
    const { params } = ClientEventSchema.parse(input)
    if (params.event === 'connect') {
      const binding = {
        client: clientDescriptor(params.kind, params.sessionId),
        ...(params.turnId ? { turnId: params.turnId } : {})
      }
      this.pendingClaudeBindings.delete(connectionId)
      if (params.kind === 'claude' && params.sessionId) {
        // A cached session can predate an offline /clear. Require this Hub's
        // native hook evidence before it can reclaim any persisted task.
        this.pendingClaudeBindings.set(connectionId, { binding, needsInitialize: false })
        this.connections.set(connectionId, { client: clientDescriptor('claude') })
      } else this.connections.set(connectionId, binding)
      return
    }
    if (!params.sessionId) return
    if (params.event === 'taskBound' && params.taskId) {
      const record = this.tasks.find(params.taskId)
      if (
        !record ||
        (record.task.client?.sessionId && record.task.client.sessionId !== params.sessionId) ||
        (record.claudeStopNotice?.turnId &&
          params.turnId &&
          record.claudeStopNotice.turnId !== params.turnId)
      )
        return
      const connectionId = record.ownerId.split('/')[0]!
      const previous = this.bindings.get(record.ownerId)
      if (!previous) return
      const kind = ['other', 'unknown'].includes(previous.client.kind)
        ? params.kind
        : previous.client.kind
      const next = {
        ...previous,
        client: { ...previous.client, kind, sessionId: params.sessionId },
        ...(params.turnId ? { turnId: params.turnId } : {})
      }
      const ownerId = `${connectionId}/${kind}/${params.sessionId}`
      this.connections.set(connectionId, next)
      this.pendingClaudeBindings.delete(connectionId)
      this.publishBinding(connectionId, next)
      this.bindings.set(ownerId, next)
      record.ownerId = ownerId
      record.task.client = next.client
      this.tasks.attachClient(
        ownerId,
        next.client,
        {
          ...(record.task.capabilities ?? CANVAS_ONLY)
        },
        next.hostContext
      )
      return
    }
    for (const record of this.tasks.list()) {
      const client = record.task.client
      if (
        !client ||
        client.sessionId !== params.sessionId ||
        (client.kind !== params.kind &&
          !(params.kind === 'codex' && client.kind.startsWith('codex')))
      )
        continue
      const bound = this.bindings.get(record.ownerId)
      if (params.event === 'UserPromptSubmit') {
        if (bound && params.turnId) bound.turnId = params.turnId
        this.refresh(record.ownerId)
        continue
      }
      // A delayed Stop for an earlier turn cannot pause a later resumed turn.
      if (params.turnId && bound?.turnId && params.turnId !== bound.turnId) continue
      if (params.event === 'SessionEnd' && bound)
        this.tasks.attachClient(record.ownerId, bound.client, CANVAS_ONLY, bound.hostContext)
      else this.refresh(record.ownerId)
      if (['Interrupt', 'SessionEnd'].includes(params.event)) this.abortFeedback(record.task.taskId)
      if (['Interrupt', 'Stop', 'SessionEnd'].includes(params.event))
        this.tasks.stop(record.task.taskId, 'paused')
    }
    if (params.event === 'SessionEnd') {
      for (const [id, { binding, needsInitialize }] of this.pendingClaudeBindings) {
        if (binding.client.kind === params.kind && binding.client.sessionId === params.sessionId) {
          this.pendingClaudeBindings.delete(id)
          if (needsInitialize) this.bindingListeners.get(id)?.({ clearSessionHint: true })
          else this.publishBinding(id, { client: clientDescriptor('claude') })
        }
      }
      for (const [id, binding] of this.connections) {
        if (binding.client.kind === params.kind && binding.client.sessionId === params.sessionId) {
          const cleared = { client: clientDescriptor(params.kind) }
          this.connections.set(id, cleared)
          this.publishBinding(id, cleared)
        }
      }
    }
  }

  async owner(
    connectionId: string,
    metadata: unknown,
    clientInfo?: { name: string; title?: string }
  ): Promise<string> {
    const pending = this.pendingClaudeBindings.get(connectionId)
    if (
      pending?.binding.client.sessionId &&
      (!pending.needsInitialize || clientInfo?.name === 'claude-code') &&
      this.hooks.isActive('claude', pending.binding.client.sessionId)
    ) {
      this.connections.set(connectionId, pending.binding)
      this.pendingClaudeBindings.delete(connectionId)
      this.publishBinding(connectionId, pending.binding)
    }
    const isClaude = clientInfo?.name === 'claude-code'
    const fallback = clientDescriptor(isClaude ? 'claude' : 'other')
    let connection = this.connections.get(connectionId)
    const needsMetadata = !clientInfo && connection?.client.kind.startsWith('codex')
    // A CLI reconnect does not replay initialize. Inherited environment alone
    // cannot identify the caller; Codex supplies its conversation on each request.
    if (needsMetadata && connection)
      connection = { client: clientDescriptor(connection.client.kind) }
    // Nested hosts inherit their parent's environment. The initialized Claude
    // client must not acquire that parent's Codex conversation or controls.
    let binding = bindRequestMetadata(
      connection && (!isClaude || connection.client.kind === 'claude')
        ? connection
        : { client: fallback },
      isClaude ? undefined : metadata
    )
    if (needsMetadata && !binding.client.sessionId) binding = { client: fallback }
    const context = this.contexts.get(connectionId)
    if (context) binding = { ...binding, hostContext: context }
    const reportedName = clientInfo?.title?.trim() || clientInfo?.name.trim()
    if (reportedName) binding.client = { ...binding.client, name: reportedName.slice(0, 80) }
    const ownerId = binding.client.sessionId
      ? `${connectionId}/${binding.client.kind}/${binding.client.sessionId}`
      : connectionId
    // Requests may identify only the conversation. Keep its native turn binding across calls.
    const previous = this.bindings.get(ownerId)
    if (previous?.client.kind === binding.client.kind) binding.turnId ??= previous.turnId
    this.bindings.set(ownerId, binding)
    // Reconnect only after runtime metadata has supplied an exact client conversation.
    const mismatchedTasks = this.tasks.attachClient(
      ownerId,
      binding.client,
      undefined,
      binding.hostContext
    )
    if (mismatchedTasks.length)
      log.warn(
        { ownerId, taskIds: mismatchedTasks },
        'Task reconnect refused: Codex storage differs or host context is missing. Update and restart the original MCP server with its original Codex configuration.'
      )
    return ownerId
  }

  subscribeBinding(
    connectionId: string,
    listener: (binding: ClientBindingUpdate) => void,
    sessionHint?: string
  ): void {
    this.bindingListeners.set(connectionId, listener)
    if (sessionHint && !this.pendingClaudeBindings.has(connectionId)) {
      this.pendingClaudeBindings.set(connectionId, {
        binding: { client: clientDescriptor('claude', sessionHint) },
        needsInitialize: true
      })
    }
  }

  private publishBinding(connectionId: string, binding: ClientBinding): void {
    if (binding.client.kind !== 'claude') return
    this.bindingListeners.get(connectionId)?.({
      kind: 'claude',
      ...(binding.client.sessionId ? { sessionId: binding.client.sessionId } : {})
    })
  }

  private refresh(ownerId: string): void {
    const binding = this.bindings.get(ownerId)
    if (binding) {
      this.tasks.attachClient(
        ownerId,
        binding.client,
        this.unavailable(binding),
        binding.hostContext
      )
      if (this.codex)
        void this.describe(ownerId)
          .then(({ capabilities }) => {
            if (this.bindings.get(ownerId) === binding)
              this.tasks.attachClient(ownerId, binding.client, capabilities, binding.hostContext)
          })
          .catch((error) => log.warn({ error }, 'Could not refresh client capabilities.'))
    }
  }

  private binding(ownerId: string): ClientBinding | undefined {
    const binding = this.bindings.get(ownerId)
    if (binding) return binding
    // Native App delivery belongs to the conversation, independently of an MCP connection.
    const record = this.tasks.list().find((record) => record.ownerId === ownerId)
    const client = record && getVerifiedTaskClient(record)
    return client && nativeFeedback(client)
      ? { client, ...(record?.hostContext ? { hostContext: record.hostContext } : {}) }
      : undefined
  }

  private interruptionTarget(binding?: ClientBinding) {
    const conversationId = nativeConversation(binding?.client)
    if (!this.lifecycle || !conversationId) return undefined
    // An exact binding wins. The owner guards against interrupting a later turn.
    const turnId =
      binding?.turnId ?? soleActiveTurn(this.lifecycle.state(conversationId, binding?.hostContext))
    return turnId ? { conversationId, turnId, context: binding?.hostContext } : undefined
  }

  async describe(ownerId: string) {
    const binding = this.binding(ownerId)
    const conversationId = nativeConversation(binding?.client)
    if (conversationId) this.lifecycle?.watch(conversationId, binding?.hostContext)
    return {
      client: binding?.client ?? clientDescriptor('other'),
      ...(binding?.hostContext ? { hostContext: binding.hostContext } : {}),
      capabilities:
        binding && (await this.codex?.available(binding))
          ? { ...CODEX_APP_FEEDBACK, interrupt: !!this.interruptionTarget(binding) }
          : binding
            ? this.unavailable(binding)
            : CANVAS_ONLY
    }
  }

  private unavailable(binding: ClientBinding) {
    if (!nativeFeedback(binding.client)) return CANVAS_ONLY
    return binding.hostContext
      ? CODEX_FEEDBACK_UNAVAILABLE
      : { ...CANVAS_ONLY, reason: MISSING_HOST_CONTEXT_MESSAGE }
  }

  async action(action: DesignAction, onAccepted?: () => void): Promise<DesignActionResult> {
    this.pruneActions()
    const record = this.tasks.find(action.taskId)
    const client = record?.task.client
    // A reopened Figma tab may acquire a new task lease for the same conversation.
    // Delivery identity must survive that lease change inside this Hub.
    const key =
      action.feedback && record && client?.sessionId
        ? JSON.stringify([
            'feedback',
            codexStoreKey(this.binding(record.ownerId)?.hostContext),
            client.kind,
            client.sessionId,
            record.task.target.fileKey,
            action.requestId
          ])
        : JSON.stringify(['task', action.taskId, action.requestId])
    const signature = JSON.stringify(action.feedback ?? action)
    const existing = this.actions.get(key)
    if (existing) {
      if (existing.signature !== signature)
        return {
          requestId: action.requestId,
          taskId: action.taskId,
          status: 'failed',
          message: 'This delivery identity already belongs to a different feedback batch.'
        }
      return { ...(await existing.pending), taskId: action.taskId }
    }
    // Bound memory and preserve all in-flight deduplication entries.
    for (const [id, entry] of this.actions) {
      if (this.actions.size < 1024) break
      if (entry.settledAt !== undefined) this.actions.delete(id)
    }
    if (this.actions.size >= 1024 && !['stop', 'done'].includes(action.action))
      throw new Error(
        'Client action history is full. Check pending deliveries before restarting the Hub.'
      )
    let dispatched = false
    const pending = this.perform(action, onAccepted, () => {
      dispatched = true
    }).then((result) => {
      const entry = this.actions.get(key)
      if (entry) entry.settledAt = Date.now()
      // A rejection before host dispatch is safe to retry with the same delivery
      // identity. Queue retries re-enter the adapter's durable receipt reconciliation;
      // they cannot replay an uncertain native write.
      if (
        result.status === 'failed' &&
        (!dispatched ||
          (action.action === 'feedback' && action.feedback?.mode === 'queue' && this.codex))
      )
        this.actions.delete(key)
      return result
    })
    this.actions.set(key, { signature, pending })
    return pending
  }

  private pruneActions(): void {
    const cutoff = Date.now() - HISTORY_RETENTION_MS
    for (const [key, entry] of this.actions) {
      if (entry.settledAt !== undefined && entry.settledAt <= cutoff) this.actions.delete(key)
    }
  }

  private async perform(
    action: DesignAction,
    onAccepted: (() => void) | undefined,
    onDispatch: () => void
  ): Promise<DesignActionResult> {
    const result = (status: DesignActionResult['status'], message: string): DesignActionResult => ({
      requestId: action.requestId,
      taskId: action.taskId,
      status,
      message
    })
    try {
      const record = this.tasks.find(action.taskId)
      if (!record) throw new Error('This design task is no longer available.')
      if (action.action === 'done') {
        const cancelled = this.cancelFeedback(action.taskId).then(
          () => true,
          () => false
        )
        this.tasks.closeReview(action.taskId)
        return result(
          'delivered',
          (await cancelled)
            ? 'Design review closed.'
            : 'Design review closed. Removing native queued comments will be retried when Codex reconnects.'
        )
      }
      this.tasks.assertEpoch(action.taskId, record.ownerId, action.epoch)
      if (record.task.reviewClosed) throw new Error('This design review is closed.')
      const binding = this.binding(record.ownerId)
      if (action.action === 'stop') {
        if (this.tasks.current(record.task.target.fileKey) !== record)
          throw new Error('This task has been replaced. Stop the current task instead.')
        if (record.task.status === 'cancelled')
          return result('delivered', 'This design task has already ended.')
        const completed = record.task.status === 'completed'
        // Capture the target before cancellation callbacks can advance native state.
        // A completed review can still be cancelled, but no longer owns host work.
        const target = completed ? undefined : this.interruptionTarget(binding)
        const diagnostic = {
          taskId: action.taskId,
          requestId: action.requestId,
          conversationId: binding?.client.sessionId,
          boundTurnId: binding?.turnId,
          expectedTurnId: target?.turnId
        }
        const stopNotice =
          !completed && binding?.client.kind === 'claude' && binding.client.sessionId
            ? { sessionId: binding.client.sessionId, turnId: binding.turnId }
            : undefined
        // Stop's local fence and host interruption must not wait for a pending queue write.
        void this.cancelFeedback(action.taskId).catch(() => {})
        this.tasks.stop(action.taskId, 'cancelled', stopNotice)
        onAccepted?.()
        if (completed) return result('delivered', 'Design task stopped.')
        if (this.lifecycle && target) {
          log.info(diagnostic, 'Requesting native Codex Stop interruption.')
          try {
            const interrupted = await this.lifecycle.interrupt(
              target.conversationId,
              target.turnId,
              target.context
            )
            log.info({ ...diagnostic, interrupted }, 'Native Codex Stop interruption settled.')
            return result(
              'delivered',
              interrupted
                ? 'Design task stopped and Codex turn interrupted.'
                : 'Design task stopped; Codex did not interrupt the expected turn because it is no longer active.'
            )
          } catch (error) {
            log.warn({ ...diagnostic, err: error }, 'Native Codex Stop interruption failed.')
            return result(
              'delivered',
              'Design task stopped. Codex interruption could not be confirmed; further writes from this task remain blocked.'
            )
          }
        }
        if (binding && nativeFeedback(binding.client)) {
          log.warn(diagnostic, 'Native Codex Stop skipped: no verified interruption target.')
          return result(
            'delivered',
            'Design task stopped. Codex interruption was not sent because its current turn could not be identified; further writes from this task remain blocked.'
          )
        }
        return result('delivered', 'Design task stopped.')
      }
      if (action.action === 'steer') {
        throw new Error(
          'Switching an already queued batch to Steer is not available. Queued comments will wait for the current response to finish.'
        )
      }
      if (!binding || !action.feedback) throw new Error(CANVAS_ONLY.reason)
      const feedback = action.feedback
      if (feedback.fileKey !== record.task.target.fileKey)
        throw new Error('The feedback belongs to a different Figma file.')
      if (!nativeFeedback(binding.client) || !this.codex || !binding.client.sessionId) {
        const capabilities = this.unavailable(binding)
        this.tasks.attachClient(record.ownerId, binding.client, capabilities, binding.hostContext)
        throw new Error(capabilities.reason)
      }
      let controller = this.feedbackSignals.get(action.taskId)
      if (!controller) {
        controller = new AbortController()
        this.feedbackSignals.set(action.taskId, controller)
      }
      const signal = controller.signal
      onAccepted?.()
      if (signal.aborted) throw new Error('Feedback cancelled by stop or disconnect.')
      this.tasks.assertEpoch(action.taskId, record.ownerId, action.epoch)
      const beforeSend = () => {
        this.tasks.assertEpoch(action.taskId, record.ownerId, action.epoch)
        if (
          record.task.reviewClosed ||
          record.task.status === 'cancelled' ||
          this.tasks.current(feedback.fileKey) !== record
        )
          throw new Error(
            'This design task was stopped or replaced. Its queued comments will not be sent.'
          )
      }
      await this.codex.enqueue(binding, action.taskId, feedback, signal, beforeSend, onDispatch)
      this.tasks.attachClient(
        record.ownerId,
        binding.client,
        CODEX_APP_FEEDBACK,
        binding.hostContext
      )
      return result('delivered', 'Feedback sent to the bound agent conversation.')
    } catch (error) {
      return result(
        'failed',
        error instanceof Error ? error.message.slice(0, 500) : 'The client action failed.'
      )
    }
  }

  async refreshCapabilities(): Promise<void> {
    this.pruneActions()
    if (!this.codex) return
    const reviewEnded = (taskId: string) => {
      const record = this.tasks.find(taskId)
      return (
        !record ||
        record.task.reviewClosed === true ||
        record.task.status === 'cancelled' ||
        this.tasks.current(record.task.target.fileKey) !== record
      )
    }
    for (const taskId of this.feedbackSignals.keys()) {
      if (reviewEnded(taskId)) this.abortFeedback(taskId)
    }
    await this.codex.reconcileQueued(reviewEnded)
    const reviews = this.tasks
      .list()
      .filter(
        (record) =>
          !record.task.reviewClosed &&
          record.task.status !== 'cancelled' &&
          this.tasks.current(record.task.target.fileKey) === record
      )
    this.lifecycle?.retain(
      new Set(
        reviews.flatMap((record) => {
          const conversationId = nativeConversation(getVerifiedTaskClient(record))
          return conversationId
            ? [hostConversationKey(conversationId, this.binding(record.ownerId)?.hostContext)]
            : []
        })
      )
    )
    const owners = new Set(reviews.map((record) => record.ownerId))
    for (const ownerId of owners) {
      const binding = this.bindings.get(ownerId)
      const { client, capabilities } = await this.describe(ownerId)
      if (this.bindings.get(ownerId) === binding)
        this.tasks.attachClient(ownerId, client, capabilities, this.binding(ownerId)?.hostContext)
    }
    this.codex.retainContexts([
      ...this.contexts.values(),
      ...this.tasks.list().flatMap((record) => (record.hostContext ? [record.hostContext] : []))
    ])
  }

  close(): void {
    this.lifecycle?.close()
    this.codex?.close()
    for (const taskId of this.feedbackSignals.keys()) this.abortFeedback(taskId)
  }

  private abortFeedback(taskId: string): void {
    this.feedbackSignals.get(taskId)?.abort()
    this.feedbackSignals.delete(taskId)
  }

  cancelFeedback(taskId: string): Promise<void> {
    this.abortFeedback(taskId)
    const pending = this.codex?.cancelQueued(taskId) ?? Promise.resolve()
    this.pendingRemovals.add(pending)
    return pending.finally(() => this.pendingRemovals.delete(pending))
  }

  disconnect(connectionId: string): void {
    this.contexts.delete(connectionId)
    this.connections.delete(connectionId)
    this.pendingClaudeBindings.delete(connectionId)
    this.bindingListeners.delete(connectionId)
    for (const ownerId of this.bindings.keys()) {
      if (ownerId !== connectionId && !ownerId.startsWith(`${connectionId}/`)) continue
      this.hooks.disconnect(this.bindings.get(ownerId)!)
      for (const record of this.tasks.list()) {
        if (record.ownerId === ownerId) this.abortFeedback(record.task.taskId)
      }
      this.tasks.disconnectOwner(ownerId)
      this.bindings.delete(ownerId)
    }
  }
}
