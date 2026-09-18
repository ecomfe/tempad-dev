import { describe, expect, it } from 'vitest'

import { ClientHooks, type ClientHook } from '../src/agent-clients/hooks'

let sequence = 0
function event(name: ClientHook['event'], extra: Partial<ClientHook> = {}): ClientHook {
  return {
    version: 1,
    kind: 'codex',
    sessionId: 'thread-a',
    turnId: 'turn-a',
    event: name,
    invocationId: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    ...extra
  }
}

describe('client lifecycle hooks', () => {
  it.each(['codex', 'claude'] as const)(
    'keeps %s tool and turn boundaries silent without a Stop notice',
    (kind) => {
      const hooks = new ClientHooks()
      for (const name of [
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'Interrupt',
        'SessionEnd'
      ] as const)
        expect(hooks.handle(event(name, { kind }))).toEqual({})
    }
  )

  it.each(['codex', 'claude'] as const)(
    'conveys a %s Figma Stop exactly once to the matching turn and conversation',
    (kind) => {
      const hooks = new ClientHooks()
      hooks.handle(event('UserPromptSubmit', { kind }))
      hooks.stop(
        {
          client: { kind, name: kind, sessionId: 'thread-a' },
          turnId: 'turn-a'
        },
        'task-a'
      )
      expect(hooks.handle(event('PreToolUse', { kind, sessionId: 'thread-b' }))).toEqual({})
      expect(hooks.handle(event('PreToolUse', { kind, turnId: 'old-turn' }))).toEqual({})
      expect(hooks.handle(event('PreToolUse', { kind }))).toEqual({
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: expect.stringContaining('The user stopped Figma design task task-a.')
          }
        }
      })
      expect(hooks.handle(event('PostToolUse', { kind }))).toEqual({})
      expect(hooks.handle(event('Stop', { kind }))).toEqual({})
    }
  )

  it('does not replay an old Stop notice into a new user turn', () => {
    const hooks = new ClientHooks()
    hooks.handle(event('UserPromptSubmit'))
    hooks.stop(
      {
        client: { kind: 'codex-app', name: 'Codex App', sessionId: 'thread-a' },
        turnId: 'turn-a'
      },
      'task-a'
    )
    expect(hooks.handle(event('UserPromptSubmit', { turnId: 'turn-b' }))).toEqual({})
    expect(hooks.handle(event('PreToolUse', { turnId: 'turn-b' }))).toEqual({})
  })
})
