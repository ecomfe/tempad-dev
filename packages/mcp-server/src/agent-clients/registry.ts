import type { DesignAction, DesignActionResult } from '@tempad-dev/shared'

import type { DesignTasks } from '../design-tasks'
import type { CodexAppLifecycle, CodexLifecycleState } from './codex-lifecycle'
import type { ClientBinding } from './types'

import { CODEX_APP_FEEDBACK, type CodexAppFeedback } from './codex-feedback'
import { ClientHooks, type ClientHook } from './hooks'
import { bindRequestMetadata, clientDescriptor, ClientEventSchema } from './identity'
import { CANVAS_ONLY, CODEX_FEEDBACK_UNAVAILABLE } from './types'

/** Conversation bindings and native delivery stay outside shared task lifecycle logic. */
export class AgentClients {
  private readonly hooks = new ClientHooks()
  private readonly connections = new Map<string, ClientBinding>()
  private readonly bindings = new Map<string, ClientBinding>()
  private readonly actions = new Map<
    string,
    { signature: string; pending: Promise<DesignActionResult> }
  >()
  private readonly feedbackSignals = new Map<string, AbortController>()
  private readonly lifecycle?: Pick<
    CodexAppLifecycle,
    'watch' | 'state' | 'retain' | 'interrupt' | 'close'
  >

  constructor(
    private readonly tasks: DesignTasks,
    private readonly codex?: CodexAppFeedback,
    lifecycle?: (
      changed: (conversationId: string, state: CodexLifecycleState | undefined) => void
    ) => NonNullable<AgentClients['lifecycle']>
  ) {
    this.lifecycle = lifecycle?.((id, state) => this.nativeState(id, state))
  }

  private nativeState(conversationId: string, state?: CodexLifecycleState): void {
    for (const [ownerId, binding] of this.bindings) {
      if (
        binding.client.sessionId !== conversationId ||
        !['codex', 'codex-app'].includes(binding.client.kind)
      )
        continue
      const previous = state?.turns.find((turn) => turn.turnId === binding.turnId)
      const active = state?.turns.filter((turn) => turn.status === 'inProgress')
      if (previous && ['completed', 'interrupted', 'failed'].includes(previous.status)) {
        for (const record of this.tasks.list()) {
          if (record.ownerId !== ownerId) continue
          if (previous.status === 'interrupted') this.cancelFeedback(record.task.taskId)
          this.tasks.stop(record.task.taskId, 'paused')
        }
      }
      if (
        active?.length === 1 &&
        (!binding.turnId || (previous && previous.status !== 'inProgress'))
      )
        binding.turnId = active[0]!.turnId
      this.refresh(ownerId)
    }
  }

  clientHook(input: ClientHook) {
    // Older installed Codex packages may still call hooks. Native state is authoritative.
    if (input.kind === 'codex') return {}
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
    const result = this.hooks.handle(input)
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

  event(connectionId: string, input: unknown): void {
    const { params } = ClientEventSchema.parse(input)
    if (params.event === 'connect') {
      this.connections.set(connectionId, {
        client: clientDescriptor(params.kind, params.sessionId),
        ...(params.turnId ? { turnId: params.turnId } : {})
      })
      return
    }
    if (!params.sessionId) return
    if (params.event === 'taskBound' && params.taskId) {
      const record = this.tasks.find(params.taskId)
      if (
        !record ||
        (record.task.client?.sessionId && record.task.client.sessionId !== params.sessionId)
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
      this.bindings.set(ownerId, next)
      record.ownerId = ownerId
      record.task.client = next.client
      this.tasks.attachClient(ownerId, next.client, {
        ...(record.task.capabilities ?? CANVAS_ONLY)
      })
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
        this.tasks.attachClient(record.ownerId, bound.client, CANVAS_ONLY)
      else this.refresh(record.ownerId)
      if (['Interrupt', 'SessionEnd'].includes(params.event))
        this.cancelFeedback(record.task.taskId)
      if (['Interrupt', 'Stop', 'SessionEnd'].includes(params.event))
        this.tasks.stop(record.task.taskId, 'paused')
    }
  }

  async owner(
    connectionId: string,
    metadata: unknown,
    clientInfo?: { name: string; title?: string }
  ): Promise<string> {
    const fallback =
      clientInfo?.name === 'claude-code' ? clientDescriptor('claude') : clientDescriptor('other')
    const binding = bindRequestMetadata(
      this.connections.get(connectionId) ?? { client: fallback },
      metadata
    )
    const reportedName = clientInfo?.title?.trim() || clientInfo?.name.trim()
    if (reportedName) binding.client = { ...binding.client, name: reportedName.slice(0, 80) }
    const ownerId = binding.client.sessionId
      ? `${connectionId}/${binding.client.kind}/${binding.client.sessionId}`
      : connectionId
    this.bindings.set(ownerId, binding)
    // Reconnect only after runtime metadata has supplied an exact client conversation.
    this.tasks.attachClient(ownerId, binding.client)
    if (binding.client.sessionId && ['codex', 'codex-app'].includes(binding.client.kind))
      this.lifecycle?.watch(binding.client.sessionId)
    return ownerId
  }

  private refresh(ownerId: string): void {
    const binding = this.bindings.get(ownerId)
    if (binding) {
      this.tasks.attachClient(ownerId, binding.client, this.unavailable(binding))
      if (this.codex)
        void this.describe(ownerId).then(({ capabilities }) => {
          if (this.bindings.get(ownerId) === binding)
            this.tasks.attachClient(ownerId, binding.client, capabilities)
        })
    }
  }

  private feedbackBinding(ownerId: string): ClientBinding | undefined {
    const binding = this.bindings.get(ownerId)
    if (binding) return binding
    // Native App delivery belongs to the conversation, independently of an MCP connection.
    const client = this.tasks.list().find((record) => record.ownerId === ownerId)?.task.client
    return client && ['codex', 'codex-app'].includes(client.kind) ? { client } : undefined
  }

  async describe(ownerId: string) {
    const binding = this.feedbackBinding(ownerId)
    const sessionId = binding?.client.sessionId
    if (sessionId && binding && ['codex', 'codex-app'].includes(binding.client.kind))
      this.lifecycle?.watch(sessionId)
    return {
      client: binding?.client ?? clientDescriptor('other'),
      capabilities:
        binding && (await this.codex?.available(binding))
          ? { ...CODEX_APP_FEEDBACK, interrupt: !!(sessionId && this.lifecycle?.state(sessionId)) }
          : binding
            ? this.unavailable(binding)
            : CANVAS_ONLY
    }
  }

  private unavailable(binding: ClientBinding) {
    return ['codex', 'codex-app'].includes(binding.client.kind)
      ? CODEX_FEEDBACK_UNAVAILABLE
      : CANVAS_ONLY
  }

  async action(action: DesignAction, onAccepted?: () => void): Promise<DesignActionResult> {
    const record = this.tasks.find(action.taskId)
    const client = record?.task.client
    // A reopened Figma tab may acquire a new task lease for the same conversation.
    // Delivery identity must survive that lease change inside this Hub.
    const key =
      action.feedback && record && client?.sessionId
        ? JSON.stringify([
            'feedback',
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
    if (this.actions.size >= 1024)
      throw new Error(
        'Client action history is full. Check pending deliveries before restarting the Hub.'
      )
    let dispatched = false
    const pending = this.perform(action, onAccepted, () => {
      dispatched = true
    }).then((result) => {
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
        const cancelled = this.cancelFeedback(action.taskId, true).then(
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
      const binding = this.feedbackBinding(record.ownerId)
      if (action.action === 'stop') {
        if (this.tasks.current(record.task.target.fileKey) !== record)
          throw new Error('This task has been replaced. Stop the current task instead.')
        if (['completed', 'cancelled'].includes(record.task.status))
          return result('delivered', 'This design task has already ended.')
        if (binding?.client.kind === 'claude') this.hooks.stop(binding, action.taskId)
        // Stop's local fence and host interruption must not wait for a pending queue write.
        void this.cancelFeedback(action.taskId, true).catch(() => {})
        this.tasks.stop(action.taskId, 'cancelled')
        onAccepted?.()
        if (
          this.lifecycle &&
          binding?.client.sessionId &&
          binding.turnId &&
          ['codex', 'codex-app'].includes(binding.client.kind)
        ) {
          try {
            const interrupted = await this.lifecycle.interrupt(
              binding.client.sessionId,
              binding.turnId
            )
            return result(
              'delivered',
              interrupted
                ? 'Design task stopped and Codex turn interrupted.'
                : 'Design task stopped; its Codex turn has already ended.'
            )
          } catch {
            return result(
              'delivered',
              'Design task stopped. Codex interruption could not be confirmed; further writes from this task remain blocked.'
            )
          }
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
      if (
        !['codex', 'codex-app'].includes(binding.client.kind) ||
        !this.codex ||
        !binding.client.sessionId
      ) {
        const capabilities = this.unavailable(binding)
        this.tasks.attachClient(record.ownerId, binding.client, capabilities)
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
      this.tasks.attachClient(record.ownerId, binding.client, CODEX_APP_FEEDBACK)
      return result('delivered', 'Feedback sent to the bound agent conversation.')
    } catch (error) {
      return result(
        'failed',
        error instanceof Error ? error.message.slice(0, 500) : 'The client action failed.'
      )
    }
  }

  async refreshCapabilities(): Promise<void> {
    if (!this.codex) return
    await this.codex.reconcileQueued((taskId) => {
      const record = this.tasks.find(taskId)
      return (
        !!record &&
        (record.task.reviewClosed === true ||
          record.task.status === 'cancelled' ||
          this.tasks.current(record.task.target.fileKey) !== record)
      )
    })
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
          const client = record.task.client
          return client?.sessionId && ['codex', 'codex-app'].includes(client.kind)
            ? [client.sessionId]
            : []
        })
      )
    )
    const owners = new Set(reviews.map((record) => record.ownerId))
    for (const ownerId of owners) {
      const binding = this.bindings.get(ownerId)
      const { client, capabilities } = await this.describe(ownerId)
      if (this.bindings.get(ownerId) === binding)
        this.tasks.attachClient(ownerId, client, capabilities)
    }
  }

  close(): void {
    this.lifecycle?.close()
    this.codex?.close()
    for (const taskId of this.feedbackSignals.keys()) this.cancelFeedback(taskId)
  }

  cancelFeedback(taskId: string, removeQueued = false): Promise<void> {
    this.feedbackSignals.get(taskId)?.abort()
    this.feedbackSignals.delete(taskId)
    return removeQueued && this.codex ? this.codex.cancelQueued(taskId) : Promise.resolve()
  }

  disconnect(connectionId: string): void {
    this.connections.delete(connectionId)
    for (const ownerId of this.bindings.keys()) {
      if (ownerId !== connectionId && !ownerId.startsWith(`${connectionId}/`)) continue
      this.hooks.disconnect(this.bindings.get(ownerId)!)
      for (const record of this.tasks.list()) {
        if (record.ownerId === ownerId) this.cancelFeedback(record.task.taskId)
      }
      this.tasks.disconnectOwner(ownerId)
      this.bindings.delete(ownerId)
    }
  }
}
