import { describe, expect, it } from 'vitest'

import { ClientHooks, type ClientHook } from '../src/agent-clients/hooks'
import { DesignTasks } from '../src/design-tasks'

function fixture() {
  const tasks = new DesignTasks({ createId: () => 'task-a' })
  tasks.begin(
    'owner',
    'extension',
    {
      sessionId: 'figma',
      fileKey: 'file',
      fileName: 'Fixture',
      pageId: 'page',
      busy: false
    },
    'Fixture',
    'begin',
    { kind: 'claude', name: 'Claude Code', sessionId: 'thread-a' }
  )
  const hooks = new ClientHooks((input) => tasks.takeClaudeStopNotice(input))
  const stop = () => tasks.stop('task-a', 'cancelled', { sessionId: 'thread-a', turnId: 'turn-a' })
  return { hooks, stop }
}

let sequence = 0
function event(
  name: ClientHook['event'],
  extra: Partial<Extract<ClientHook, { version: 1 }>> = {}
): ClientHook {
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
      const { hooks } = fixture()
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

  it('conveys a Claude Figma Stop exactly once to the matching turn and conversation', () => {
    const kind = 'claude'
    const { hooks, stop } = fixture()
    hooks.handle(event('UserPromptSubmit', { kind }))
    stop()
    expect(hooks.handle(event('PreToolUse', { kind, sessionId: 'thread-b' }))).toEqual({})
    expect(hooks.handle(event('PreToolUse', { kind, turnId: 'old-turn' }))).toBeUndefined()
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
  })

  it('does not replay an old Stop notice into a new user turn', () => {
    const { hooks, stop } = fixture()
    hooks.handle(event('UserPromptSubmit', { kind: 'claude' }))
    stop()
    expect(hooks.handle(event('UserPromptSubmit', { kind: 'claude', turnId: 'turn-b' }))).toEqual(
      {}
    )
    expect(hooks.handle(event('PreToolUse', { kind: 'claude', turnId: 'turn-b' }))).toEqual({})
  })
})
