import type { ClientHook } from '@tempad-dev/shared'
export { ClientHookRequestSchema, type ClientHook } from '@tempad-dev/shared'

import type { ClientBinding } from './types'

export type ClientHookResult = {
  output?: {
    hookSpecificOutput: { hookEventName: ClientHook['event']; additionalContext: string }
  }
}
type Session = {
  active: boolean
  issuedAt?: number
  turnId?: string
  receiptCapable?: boolean
}

function scope(kind: string, sessionId: string): string {
  return JSON.stringify([kind.startsWith('codex') ? 'codex' : kind, sessionId])
}

/** Hooks carry lifecycle identity and Stop notices, never design comments. */
export class ClientHooks {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly takeStopNotice: (input: ClientHook) => {
      taskId?: string
      staleTurn?: boolean
    }
  ) {}

  receiptCapable(sessionId?: string): boolean {
    return !!sessionId && this.sessions.get(scope('claude', sessionId))?.receiptCapable === true
  }

  isActive(kind: string, sessionId: string): boolean {
    return this.sessions.get(scope(kind, sessionId))?.active === true
  }

  disconnect(binding: ClientBinding): void {
    const { kind, sessionId } = binding.client
    const session = sessionId && this.sessions.get(scope(kind, sessionId))
    if (session) session.active = false
  }

  /** Expiry is loss of old evidence, never a replay of the historical event. */
  retire(input: ClientHook): boolean {
    const key = scope(input.kind, input.sessionId)
    const session = this.sessions.get(key)
    if (input.version !== 2 || (session?.issuedAt ?? 0) > input.issuedAt) return false
    this.sessions.delete(key)
    return true
  }

  /** Historical delivery can end old work, never establish liveness or consume a Stop notice. */
  reconcile(input: ClientHook): ClientHookResult | undefined {
    if (!['Stop', 'Interrupt', 'SessionEnd'].includes(input.event)) return
    const session = this.sessions.get(scope(input.kind, input.sessionId))
    if (session) {
      if (
        input.version !== 2 ||
        (session.issuedAt ?? 0) >= input.issuedAt ||
        (input.turnId && session.turnId && input.turnId !== session.turnId)
      )
        return
      session.active = false
      session.issuedAt = input.issuedAt
    }
    return {}
  }

  /** Undefined rejects the event; an empty result accepts it without model-facing output. */
  handle(input: ClientHook): ClientHookResult | undefined {
    const key = scope(input.kind, input.sessionId)
    let session = this.sessions.get(key)
    if (!session) {
      if (this.sessions.size >= 256) {
        const inactive = [...this.sessions].find(([, value]) => !value.active)
        if (!inactive) return
        this.sessions.delete(inactive[0])
      }
      session = { active: false }
      this.sessions.set(key, session)
    }
    if (
      input.event !== 'UserPromptSubmit' &&
      input.turnId &&
      session.turnId &&
      input.turnId !== session.turnId
    ) {
      return
    }
    const notice = this.takeStopNotice(input)
    if (notice.staleTurn) return
    session.issuedAt = Math.max(
      session.issuedAt ?? 0,
      input.version === 2 ? input.issuedAt : Date.now()
    )
    if (input.event === 'UserPromptSubmit' || input.turnId) session.turnId = input.turnId
    session.receiptCapable = input.version === 2

    const ended = ['Interrupt', 'SessionEnd'].includes(input.event)
    session.active = !ended && input.event !== 'Stop'
    const { taskId } = notice
    if (taskId && (input.event === 'PreToolUse' || input.event === 'PostToolUse'))
      return {
        output: {
          hookSpecificOutput: {
            hookEventName: input.event,
            additionalContext: `The user stopped Figma design task ${taskId}. That task is cancelled and cannot resume. Respect the stop and do not automatically replace it. If further design work is necessary or the user requests it, explicitly begin a new task.`
          }
        }
      }
    return {}
  }
}
