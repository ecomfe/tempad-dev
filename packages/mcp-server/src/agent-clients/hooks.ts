import { z } from 'zod'

import type { ClientBinding } from './types'

export const ClientHookRequestSchema = z.object({
  method: z.literal('tempad/client-hook'),
  params: z
    .object({
      version: z.literal(1),
      kind: z.enum(['codex', 'claude']),
      sessionId: z.string().min(1).max(256),
      event: z.enum([
        'PreToolUse',
        'PostToolUse',
        'UserPromptSubmit',
        'Stop',
        'Interrupt',
        'SessionEnd'
      ]),
      invocationId: z.string().uuid(),
      turnId: z.string().min(1).max(256).optional(),
      taskId: z.string().min(1).max(128).optional()
    })
    .strict()
})
export type ClientHook = z.infer<typeof ClientHookRequestSchema>['params']
export type ClientHookResult = {
  output?: {
    hookSpecificOutput: { hookEventName: ClientHook['event']; additionalContext: string }
  }
}
type Session = {
  active: boolean
  turnId?: string
  stopNotice?: { taskId: string; turnId?: string }
}

function scope(kind: string, sessionId: string): string {
  return JSON.stringify([kind.startsWith('codex') ? 'codex' : kind, sessionId])
}

/** Hooks carry lifecycle identity and Stop notices, never design comments. */
export class ClientHooks {
  private readonly sessions = new Map<string, Session>()

  stop(binding: ClientBinding, taskId: string): void {
    const session = this.session(binding)
    if (session) session.stopNotice = { taskId, turnId: binding.turnId }
  }

  disconnect(binding: ClientBinding): void {
    const session = this.session(binding)
    if (session) session.active = false
  }

  private session(binding: ClientBinding): Session | undefined {
    const { kind, sessionId } = binding.client
    return sessionId ? this.sessions.get(scope(kind, sessionId)) : undefined
  }

  handle(input: ClientHook): ClientHookResult {
    const key = scope(input.kind, input.sessionId)
    let session = this.sessions.get(key)
    if (!session) {
      if (this.sessions.size >= 256) {
        const inactive = [...this.sessions].find(([, value]) => !value.active)
        if (!inactive) return {}
        this.sessions.delete(inactive[0])
      }
      session = { active: false, turnId: input.turnId }
      this.sessions.set(key, session)
    }
    if (input.event === 'UserPromptSubmit') {
      session.turnId = input.turnId
      session.stopNotice = undefined
    } else if (input.turnId && session.turnId && input.turnId !== session.turnId) {
      return {}
    } else if (input.turnId) session.turnId = input.turnId

    const ended = ['Interrupt', 'SessionEnd'].includes(input.event)
    session.active = !ended && input.event !== 'Stop'
    if (ended) return {}
    const notice = session.stopNotice
    if (notice && (!notice.turnId || !input.turnId || notice.turnId === input.turnId)) {
      session.stopNotice = undefined
      if (input.event === 'PreToolUse' || input.event === 'PostToolUse')
        return {
          output: {
            hookSpecificOutput: {
              hookEventName: input.event,
              additionalContext: `The user stopped Figma design task ${notice.taskId}. That task is cancelled and cannot resume. Respect the stop and do not automatically replace it. If further design work is necessary or the user requests it, explicitly begin a new task.`
            }
          }
        }
    }
    return {}
  }
}
