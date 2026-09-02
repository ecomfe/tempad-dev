import { describe, expect, it } from 'vitest'

import type { AuthoringRunNote, AuthoringRunReviewDraft } from '@/scripts/agent-authoring-run-log'
import type { AuthoringPreflightResult } from '@/scripts/agent-authoring-runtime-preflight'

import {
  buildAbandonEvent,
  buildFinishEvent,
  buildStartEvent,
  fingerprintRunNote,
  parseRunLogState,
  summarizeRunLog,
  validateComparisonRecords,
  validateFreshRunPrompt
} from '@/scripts/agent-authoring-run-log'

const extensionFingerprint = 'a'.repeat(64)
const hubFingerprint = 'b'.repeat(64)
const pluginVersion = '0.1.2+codex.test'

function preflight(overrides: Partial<AuthoringPreflightResult> = {}): AuthoringPreflightResult {
  return {
    valid: true,
    checkedAt: '2026-08-29T00:00:10.000Z',
    checkout: '/repo',
    runtime: {
      cli: {
        bundle: '/repo/packages/mcp-server/dist/cli.mjs',
        bundleModifiedAt: '2026-08-28T23:59:00.000Z',
        processes: [{ pid: 1, startedAt: '2026-08-29T00:00:00.000Z' }]
      },
      hub: {
        bundle: '/repo/packages/mcp-server/dist/hub.mjs',
        bundleModifiedAt: '2026-08-28T23:59:00.000Z',
        processes: [{ pid: 2, startedAt: '2026-08-29T00:00:00.000Z' }]
      },
      extension: {
        checkoutFingerprint: extensionFingerprint,
        identityFile: '/tmp/tempad-dev/run/hub-runtime.json',
        hubProcessId: 2,
        active: {
          connectedAt: '2026-08-29T00:00:05.000Z',
          fingerprint: extensionFingerprint,
          id: 'extension-1',
          version: '0.21.0'
        }
      }
    },
    plugin: {
      generatedVersion: pluginVersion,
      installedVersion: pluginVersion,
      installedPath: '/repo/.dev/plugins/tempad-dev-dev'
    },
    issues: [],
    ...overrides
  }
}

function note(overrides: Partial<AuthoringRunNote> = {}): AuthoringRunNote {
  return {
    schemaVersion: 1,
    id: 'note-1',
    createdAt: '2026-08-29T00:00:00.000Z',
    kind: 'open',
    intent: 'Observe whether the agent produces a useful, coherent design for the request.',
    task: {
      prompt: 'Design a focused control room.',
      expectedPageName: 'R210 Control Room'
    },
    ...overrides
  }
}

function review(overrides: Partial<AuthoringRunReviewDraft> = {}): AuthoringRunReviewDraft {
  return {
    schemaVersion: 1,
    noteId: 'note-1',
    status: 'valid',
    assessment:
      'The result is coherent and useful. The inspected pixels and native structure support that judgment.',
    nextAction: 'Keep the current behavior and watch the next materially different task.',
    artifacts: {
      taskId: 'task-1',
      pageId: '1:2',
      pageName: 'R210 Control Room',
      evidence: ['control-room.png', 'native structure for 1:2']
    },
    ...overrides
  }
}

function row(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function rollout(
  options: {
    extension?: string
    crossTaskTool?: 'create_thread' | 'fork_thread' | 'handoff_thread' | 'send_message_to_thread'
    prompt?: string
    skillAlias?: boolean
    skillVersion?: string
  } = {}
): string {
  const prompt = options.prompt ?? note().task.prompt
  const version = options.skillVersion ?? pluginVersion
  const skillRoot = `/plugins/cache/tempad-dev-dev/tempad-dev-dev/${version}/skills`
  const skillLocator = options.skillAlias
    ? 'r8/figma-canvas-authoring/SKILL.md'
    : `${skillRoot}/figma-canvas-authoring/SKILL.md`
  const supportingSkillLocator = options.skillAlias
    ? 'r8/figma-design-to-code/SKILL.md'
    : `${skillRoot}/figma-design-to-code/SKILL.md`
  const skillRoots = options.skillAlias ? `### Skill roots\n- \`r8\` = \`${skillRoot}\`\n` : ''
  const skills = `<skills_instructions>\n## Skills\n${skillRoots}- tempad-dev-dev:figma-canvas-authoring: Create native editable Figma designs. (file: ${skillLocator})\n- tempad-dev-dev:figma-design-to-code: Implement visible Figma designs. (file: ${supportingSkillLocator})\n</skills_instructions>`
  return [
    row({ timestamp: '2026-08-29T00:00:20.000Z', type: 'session_meta', payload: {} }),
    row({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: `${skills}\n<codex_delegation><input>${prompt}</input></codex_delegation>`
          }
        ]
      }
    }),
    row({
      timestamp: '2026-08-29T00:00:30.000Z',
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        started_at_ms: Date.parse('2026-08-29T00:00:29.000Z'),
        completed_at_ms: Date.parse('2026-08-29T00:00:30.000Z'),
        item: {
          type: 'McpToolCall',
          server: 'tempad-dev-dev',
          tool: 'apply_canvas',
          arguments: { markup: '<div data-key="root"></div>' },
          status: 'completed',
          result: {
            isError: false,
            structuredContent: {
              runtime: {
                locked: true,
                valid: true,
                issues: [],
                hub: { runtimeFingerprint: hubFingerprint },
                extension: {
                  runtimeFingerprint: options.extension ?? extensionFingerprint
                }
              }
            }
          }
        }
      }
    }),
    ...(options.crossTaskTool
      ? [
          row({
            timestamp: '2026-08-29T00:00:35.000Z',
            type: 'event_msg',
            payload: {
              type: 'item_completed',
              started_at_ms: Date.parse('2026-08-29T00:00:34.000Z'),
              completed_at_ms: Date.parse('2026-08-29T00:00:35.000Z'),
              item: {
                type: 'McpToolCall',
                server: 'codex_app',
                tool: options.crossTaskTool,
                arguments: {},
                status: 'completed',
                result: { isError: false }
              }
            }
          })
        ]
      : [])
  ].join('')
}

describe('agent authoring run log', () => {
  it('freezes one plain live-run note after a successful preflight', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')

    expect(start).toMatchObject({
      type: 'start',
      note: {
        kind: 'open',
        intent: expect.any(String),
        task: { prompt: 'Design a focused control room.' }
      },
      preflight: { valid: true, issues: [] }
    })
    expect(start.noteSha256).toBe(fingerprintRunNote(start.note))
    expect(start.note).not.toHaveProperty('gate')
    expect(start.note).not.toHaveProperty('lane')
    expect(start.note).not.toHaveProperty('rubric')
    expect(() =>
      buildStartEvent(note(), { ...preflight(), valid: false }, '2026-08-29T00:00:11.000Z')
    ).toThrow('successful current-checkout preflight')
  })

  it('accepts a valid live review as accountable prose plus evidence', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')
    const finish = buildFinishEvent(
      start,
      review(),
      { source: '/tmp/run-1.jsonl', text: rollout() },
      '2026-08-29T00:01:00.000Z'
    )
    const state = parseRunLogState(`${JSON.stringify(start)}\n${JSON.stringify(finish)}\n`)

    expect(state.records).toHaveLength(1)
    expect(finish.review).not.toHaveProperty('axes')
    expect(finish.review).not.toHaveProperty('decision')
    expect(finish.rollout).not.toHaveProperty('inspection')
    expect(finish.rollout).not.toHaveProperty('tools')
    expect(summarizeRunLog(state)).toEqual({
      runs: 1,
      valid: 1,
      invalid: 0,
      pending: 0,
      abandoned: 0,
      byKind: { open: 1 }
    })
  })

  it('accepts a versioned authoring skill reached through a declared root alias', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')

    expect(() =>
      buildFinishEvent(
        start,
        review(),
        { source: '/tmp/aliased-skill.jsonl', text: rollout({ skillAlias: true }) },
        '2026-08-29T00:01:00.000Z'
      )
    ).not.toThrow()
  })

  it('rejects post-start prompt, runtime, skill, and artifact substitutions', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')

    expect(() =>
      buildFinishEvent(
        start,
        review(),
        {
          source: '/tmp/wrong-prompt.jsonl',
          text: rollout({ prompt: 'Design something else.' })
        },
        '2026-08-29T00:01:00.000Z'
      )
    ).toThrow('frozen live task')
    expect(() =>
      buildFinishEvent(
        start,
        review(),
        {
          source: '/tmp/wrong-extension.jsonl',
          text: rollout({ extension: 'c'.repeat(64) })
        },
        '2026-08-29T00:01:00.000Z'
      )
    ).toThrow('successful preflight checkout')
    expect(() =>
      buildFinishEvent(
        start,
        review(),
        {
          source: '/tmp/wrong-skill.jsonl',
          text: rollout({ skillVersion: '0.1.2+codex.other' })
        },
        '2026-08-29T00:01:00.000Z'
      )
    ).toThrow('authoring skill verified at run start')
    expect(() =>
      buildFinishEvent(
        start,
        review({ artifacts: { ...review().artifacts, evidence: [] } }),
        {
          source: '/tmp/no-evidence.jsonl',
          text: rollout()
        },
        '2026-08-29T00:01:00.000Z'
      )
    ).toThrow('reviewable artifact evidence')
  })

  it('matches an XML-escaped delegated prompt to the frozen task', () => {
    const escapedNote = note({
      task: {
        prompt: 'Book Shape & finish.',
        expectedPageName: 'R210 Control Room'
      }
    })
    const start = buildStartEvent(escapedNote, preflight(), '2026-08-29T00:00:11.000Z')

    expect(() =>
      buildFinishEvent(
        start,
        review(),
        {
          source: '/tmp/xml-escaped-prompt.jsonl',
          text: rollout({ prompt: 'Book Shape &amp; finish.' })
        },
        '2026-08-29T00:01:00.000Z'
      )
    ).not.toThrow()
  })

  it('rejects cross-task dispatch from a valid live run', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')
    const delegated = {
      source: '/tmp/delegated.jsonl',
      text: rollout({ crossTaskTool: 'create_thread' })
    }

    expect(() => buildFinishEvent(start, review(), delegated, '2026-08-29T00:01:00.000Z')).toThrow(
      'cannot dispatch work through codex_app.create_thread'
    )
    expect(() =>
      buildFinishEvent(start, review({ status: 'invalid' }), delegated, '2026-08-29T00:01:00.000Z')
    ).not.toThrow()
  })

  it('allows an invalid run to close honestly without manufacturing rollout evidence', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')
    const finish = buildFinishEvent(
      start,
      review({
        status: 'invalid',
        assessment: 'Dispatch identity could not be established.',
        nextAction: 'Quarantine the page and author a fresh prompt.',
        artifacts: {
          taskId: null,
          pageId: null,
          pageName: null,
          evidence: []
        }
      }),
      undefined,
      '2026-08-29T00:00:15.000Z'
    )

    expect(finish.rollout).toBeNull()
    expect(finish.review.status).toBe('invalid')
  })

  it('allows prompt reuse only across the two arms of one comparison', () => {
    const baselineNote = note({
      id: 'baseline-note',
      kind: 'comparison',
      comparison: { id: 'comparison-1', arm: 'baseline', subject: 'bounded skill change' }
    })
    const candidateNote = note({
      id: 'candidate-note',
      kind: 'comparison',
      comparison: { id: 'comparison-1', arm: 'candidate', subject: 'bounded skill change' }
    })
    const baseline = buildStartEvent(baselineNote, preflight(), '2026-08-29T00:00:11.000Z')

    expect(() => validateFreshRunPrompt(candidateNote, [baseline])).not.toThrow()
    expect(() =>
      validateFreshRunPrompt({ ...baselineNote, id: 'duplicate-arm' }, [baseline])
    ).toThrow('duplicates prior run')
    expect(() => validateFreshRunPrompt(note({ id: 'unrelated-note' }), [baseline])).toThrow(
      'duplicates prior run'
    )
  })

  it('keeps comparison integrity without making comparison the default', () => {
    const baselineStart = buildStartEvent(
      note({
        id: 'baseline-note',
        kind: 'comparison',
        comparison: { id: 'comparison-1', arm: 'baseline', subject: 'bounded skill change' }
      }),
      preflight(),
      '2026-08-29T00:00:11.000Z'
    )
    const candidateStart = buildStartEvent(
      note({
        id: 'candidate-note',
        kind: 'comparison',
        comparison: { id: 'comparison-1', arm: 'candidate', subject: 'bounded skill change' }
      }),
      preflight({
        plugin: {
          generatedVersion: '0.1.2+codex.candidate',
          installedVersion: '0.1.2+codex.candidate',
          installedPath: '/repo/.dev/plugins/tempad-dev-dev'
        }
      }),
      '2026-08-29T00:00:12.000Z'
    )
    const baselineFinish = buildFinishEvent(
      baselineStart,
      review({ noteId: 'baseline-note' }),
      { source: '/tmp/baseline.jsonl', text: rollout() },
      '2026-08-29T00:01:00.000Z'
    )
    const candidateFinish = buildFinishEvent(
      candidateStart,
      review({ noteId: 'candidate-note' }),
      {
        source: '/tmp/candidate.jsonl',
        text: rollout({ skillVersion: '0.1.2+codex.candidate' })
      },
      '2026-08-29T00:01:00.000Z'
    )

    expect(() =>
      validateComparisonRecords([
        { start: baselineStart, finish: baselineFinish },
        { start: candidateStart, finish: candidateFinish }
      ])
    ).not.toThrow()
    expect(() =>
      validateComparisonRecords([
        {
          start: baselineStart,
          finish: {
            ...baselineFinish,
            rollout: {
              ...baselineFinish.rollout!,
              skills: {
                ...baselineFinish.rollout!.skills!,
                contextFingerprint: 'd'.repeat(64)
              }
            }
          }
        },
        { start: candidateStart, finish: candidateFinish }
      ])
    ).not.toThrow()
    expect(() =>
      validateComparisonRecords([
        { start: baselineStart, finish: baselineFinish },
        {
          start: candidateStart,
          finish: {
            ...candidateFinish,
            rollout: {
              ...candidateFinish.rollout!,
              runtime: {
                ...candidateFinish.rollout!.runtime,
                hubFingerprint: 'c'.repeat(64)
              }
            }
          }
        }
      ])
    ).toThrow('supporting context or runtime')
  })

  it('records abandonment with a reason instead of phase taxonomy', () => {
    const start = buildStartEvent(note(), preflight(), '2026-08-29T00:00:11.000Z')
    const abandon = buildAbandonEvent(
      start.note.id,
      'The native task surface returned an unknown dispatch outcome.',
      '2026-08-29T00:00:12.000Z'
    )
    const state = parseRunLogState(`${JSON.stringify(start)}\n${JSON.stringify(abandon)}\n`)

    expect(state.pending).toEqual([])
    expect(state.abandoned).toEqual([abandon])
    expect(abandon).not.toHaveProperty('phase')
    expect(abandon).not.toHaveProperty('reasonCode')
  })
})
