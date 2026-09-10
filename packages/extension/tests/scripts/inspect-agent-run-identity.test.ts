import { describe, expect, it } from 'vitest'

import { inspectAgentRunIdentity } from '@/scripts/inspect-agent-run-identity'

const row = (value: unknown): string => `${JSON.stringify(value)}\n`
const message = (role: string, text: string): string =>
  row({
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: [{ type: 'input_text', text }]
    }
  })
const context = (model = 'gpt-5.6-sol', effort = 'xhigh'): string =>
  row({
    type: 'turn_context',
    payload: { model, effort }
  })
const session = row({ type: 'session_meta', payload: { id: 'task-1' } })
const delegatedOutput = (input: string): string =>
  row({
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      name: 'create_thread',
      namespace: 'codex_app',
      output: `<codex_delegation><input>${input}</input></codex_delegation>`
    }
  })

describe('agent run identity', () => {
  it('reads actual session and turn settings, ignoring claims in assistant and tool text', () => {
    const source =
      session +
      context() +
      message('user', 'Design a music player.') +
      message('assistant', '<codex_delegation><input>Invented prompt</input></codex_delegation>') +
      row({
        type: 'response_item',
        payload: { type: 'function_call_output', output: 'model: other' }
      })
    expect(inspectAgentRunIdentity(source)).toEqual({
      taskId: 'task-1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      promptCount: 1,
      promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      issues: []
    })
  })

  it('accepts host-delegated prompts and skips environment metadata without dropping a trailing task', () => {
    const delegated =
      session +
      context() +
      message(
        'developer',
        '<codex_delegation><input>Shape &amp; finish &#x26; form.</input></codex_delegation>'
      ) +
      message(
        'user',
        '<recommended_plugins>Catalog</recommended_plugins><environment_context>cwd</environment_context>'
      )
    const direct =
      session +
      context() +
      message('user', '<environment_context>cwd</environment_context>Shape & finish & form.')
    expect(inspectAgentRunIdentity(delegated)).toEqual(inspectAgentRunIdentity(direct))
    expect(inspectAgentRunIdentity(delegated).issues).toEqual([])
  })

  it('accepts the native create-thread envelope and ignores projectless host metadata', () => {
    const delegated =
      session +
      context() +
      delegatedOutput('Shape &amp; finish &#x26; form.') +
      message(
        'user',
        '<recommended_plugins>Catalog</recommended_plugins>\n# AGENTS.md instructions\n<INSTRUCTIONS>Context</INSTRUCTIONS>\n<environment_context>cwd</environment_context>'
      )
    const direct = session + context() + message('user', 'Shape & finish & form.')
    expect(inspectAgentRunIdentity(delegated)).toEqual(inspectAgentRunIdentity(direct))
    expect(inspectAgentRunIdentity(delegated).issues).toEqual([])
  })

  it('retains duplicate prompts, model switches, and malformed lines as invalid evidence', () => {
    const source =
      session +
      context() +
      message('user', 'Design a player.') +
      message('user', 'Design a player.') +
      context('other-model', 'high') +
      '{broken\n'
    const result = inspectAgentRunIdentity(source)
    expect(result.promptCount).toBe(2)
    expect(result.model).toBeNull()
    expect(result.reasoningEffort).toBeNull()
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Model changed within the rollout.',
        'Reasoning effort changed within the rollout.',
        'A clean run requires exactly one original task prompt.',
        expect.stringContaining('Invalid rollout JSON')
      ])
    )
  })

  it('does not infer unknown settings or accept contradictory collaboration settings', () => {
    expect(inspectAgentRunIdentity('').issues).toContain('No model evidence.')
    const source =
      session +
      row({
        type: 'turn_context',
        payload: {
          model: 'gpt-5.6-sol',
          effort: 'xhigh',
          collaboration_mode: { settings: { model: 'other-model', reasoning_effort: 'low' } }
        }
      }) +
      message('user', 'Design a player.')
    expect(inspectAgentRunIdentity(source).issues).toEqual([
      'Turn model disagrees with collaboration settings.',
      'Turn reasoning effort disagrees with collaboration settings.'
    ])
  })
  it('keeps a task after repository instructions and detects contradictory session IDs', () => {
    const source =
      session +
      context() +
      message(
        'user',
        '# AGENTS.md instructions for /repo\n<INSTRUCTIONS>Context</INSTRUCTIONS>\nDesign a player.'
      )
    expect(inspectAgentRunIdentity(source).issues).toEqual([])
    const changed =
      source + row({ type: 'session_meta', payload: { id: 'task-1', session_id: 'task-2' } })
    expect(inspectAgentRunIdentity(changed).issues).toContain(
      'Task identity changed within the rollout.'
    )
  })

  it('supports session aliases and effort settings without fabricating missing values', () => {
    const source =
      row({ type: 'session_meta', payload: { session_id: 'task-1' } }) +
      row({
        type: 'turn_context',
        payload: {
          model: 'gpt-5.6-sol',
          collaboration_mode: { settings: { reasoning_effort: 'xhigh' } }
        }
      }) +
      message('user', 'Design a player.')
    expect(inspectAgentRunIdentity(source).issues).toEqual([])
    const missing = source + row({ type: 'turn_context', payload: {} })
    expect(inspectAgentRunIdentity(missing).issues).toEqual(
      expect.arrayContaining([
        'A turn context has no model identity.',
        'A turn context has no reasoning effort.'
      ])
    )
  })
})
