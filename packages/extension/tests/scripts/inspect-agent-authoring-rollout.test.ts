import { describe, expect, it } from 'vitest'

import { inspectAuthoringRollout } from '@/scripts/inspect-agent-authoring-rollout'

function row(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function customCall(input: string, timestamp?: string): string {
  return row({
    ...(timestamp ? { timestamp } : {}),
    type: 'response_item',
    payload: { type: 'custom_tool_call', name: 'exec', input }
  })
}

function message(role: string, text: string): string {
  return row({
    type: 'response_item',
    payload: { type: 'message', role, content: [{ type: 'input_text', text }] }
  })
}

function createThreadOutput(text: string): string {
  return row({
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      namespace: 'codex_app',
      name: 'create_thread',
      output: `<codex_delegation><input>${text}</input></codex_delegation>`
    }
  })
}

function applyCall(
  argumentsValue: unknown,
  result: unknown,
  status: 'completed' | 'failed' = 'completed',
  timing?: { timestamp: string; startedAtMs: number; completedAtMs: number }
): string {
  return row({
    ...(timing ? { timestamp: timing.timestamp } : {}),
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      ...(timing
        ? { started_at_ms: timing.startedAtMs, completed_at_ms: timing.completedAtMs }
        : {}),
      item: {
        type: 'McpToolCall',
        server: 'tempad-dev-dev',
        tool: 'apply_canvas',
        arguments: argumentsValue,
        result,
        status
      }
    }
  })
}

function imageView(path: string): string {
  return row({
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: { type: 'ImageView', path }
    }
  })
}

function timedItem(
  timestamp: string,
  item: unknown,
  startedAtMs?: number,
  completedAtMs?: number
): string {
  return row({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      ...(startedAtMs === undefined || completedAtMs === undefined
        ? {}
        : { started_at_ms: startedAtMs, completed_at_ms: completedAtMs }),
      item
    }
  })
}

function commandExecution(command: string): string {
  return timedItem('2026-08-26T00:00:03.000Z', {
    type: 'CommandExecution',
    command: ['/bin/zsh', '-lc', command],
    status: 'completed'
  })
}

describe('agent authoring rollout inspection', () => {
  it('summarizes research, acquisition, icon, component, and apply evidence', () => {
    const rollout = [
      customCall('await tools.web__run({ image_query: [{ q: "editorial travel" }] })'),
      customCall('await browser.goto("https://example.com/reference")'),
      customCall('await browser.screenshot()'),
      customCall('await tools.image_gen__imagegen({ prompt: "bespoke fictional object" })'),
      imageView('file:///tmp/work/references/category-reference.png'),
      imageView('file:///tmp/work/research/product-screenshot.png'),
      imageView('file:///tmp/tempad-dev/assets/final-screen.png'),
      imageView('file:///tmp/unclassified.png'),
      applyCall(
        {
          markup:
            '<div data-key="root"><div data-key="photo"></div><div data-key="card"></div></div>',
          assets: {
            icon: {
              type: 'SVG',
              svg: '<!-- @license lucide-static v0.468.0 - ISC --><svg></svg>'
            }
          },
          native: {
            photo: {
              figma: {
                fills: [
                  {
                    type: 'IMAGE',
                    imageUrl: 'https://images.unsplash.com/photo-1',
                    scaleMode: 'FILL'
                  }
                ]
              }
            },
            card: { figma: { type: 'COMPONENT' } }
          }
        },
        { isError: false },
        'completed'
      ),
      applyCall(
        {
          markup: '<div data-key="root"><div data-key="instance"></div></div>',
          native: { instance: { component: { id: '1:2' } } }
        },
        { isError: false },
        'completed'
      )
    ].join('')

    expect(inspectAuthoringRollout(rollout)).toMatchObject({
      applyCanvas: {
        calls: 2,
        failures: 0,
        failureCodes: {},
        nodeLimitAttempts: [],
        maxMarkupCharacters: 82,
        maxDataKeyCount: 3
      },
      research: {
        webCalls: 1,
        imageQueryCalls: 1,
        openedSourceCalls: 1,
        browserScreenshotCalls: 1
      },
      imageViews: { total: 4, references: 2, tempadScreenshots: 1, other: 1 },
      assets: {
        imageGenerationCalls: 1,
        appliedRemoteImageDomains: ['images.unsplash.com'],
        iconLibraries: ['Lucide']
      },
      components: { authoredComponentCalls: 1, instanceBindingCalls: 1 }
    })
  })

  it('records failure codes and measured node-limit attempts', () => {
    const markup = `<div data-key="root">${Array.from(
      { length: 160 },
      (_, index) => `<div data-key="child-${index}"></div>`
    ).join('')}</div>`
    const rollout = applyCall(
      { markup },
      {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Tool "apply_canvas" failed [INVALID_CANVAS_SPEC]: Canvas markup contains more than 160 elements.'
          }
        ]
      },
      'failed'
    )

    expect(inspectAuthoringRollout(rollout).applyCanvas).toEqual({
      calls: 1,
      failures: 1,
      failureCodes: { INVALID_CANVAS_SPEC: 1 },
      nodeLimitAttempts: [{ limit: 160, dataKeyCount: 161, markupCharacters: markup.length }],
      maxMarkupCharacters: markup.length,
      maxDataKeyCount: 161
    })
  })

  it('reports wall-clock milestones without treating a screenshot as usable-design proof', () => {
    const rollout = [
      row({ timestamp: '2026-08-26T00:00:00.000Z', type: 'session_meta', payload: {} }),
      applyCall({ markup: '<div data-key="root"></div>' }, { isError: false }, 'completed', {
        timestamp: '2026-08-26T00:00:05.000Z',
        startedAtMs: Date.parse('2026-08-26T00:00:04.000Z'),
        completedAtMs: Date.parse('2026-08-26T00:00:05.000Z')
      }),
      timedItem(
        '2026-08-26T00:00:06.000Z',
        { type: 'CommandExecution' },
        Date.parse('2026-08-26T00:00:04.500Z'),
        Date.parse('2026-08-26T00:00:06.000Z')
      ),
      timedItem(
        '2026-08-26T00:00:08.000Z',
        { type: 'ImageView', path: '/tmp/tempad-dev/assets/screen.png' },
        Date.parse('2026-08-26T00:00:07.500Z'),
        Date.parse('2026-08-26T00:00:08.000Z')
      ),
      applyCall(
        { markup: '<div data-key="root"><div data-key="section"></div></div>' },
        { isError: false },
        'completed',
        {
          timestamp: '2026-08-26T00:00:12.000Z',
          startedAtMs: Date.parse('2026-08-26T00:00:11.000Z'),
          completedAtMs: Date.parse('2026-08-26T00:00:12.000Z')
        }
      ),
      timedItem('2026-08-26T00:00:15.000Z', { type: 'AgentMessage' })
    ].join('')

    const inspection = inspectAuthoringRollout(rollout)

    expect(inspection.timing).toEqual({
      rolloutStartedAt: '2026-08-26T00:00:00.000Z',
      finalResponseAt: '2026-08-26T00:00:15.000Z',
      totalWallClockMs: 15_000,
      firstToolCallMs: 5_000,
      firstApplyAttemptMs: 5_000,
      firstSuccessfulApplyMs: 5_000,
      firstResearchCallMs: null,
      lastResearchCallMs: null,
      firstOpenedTempadScreenshotMs: 8_000,
      firstApplyToOpenedScreenshotMs: 3_000,
      lastSuccessfulApplyMs: 12_000,
      finalizationAfterLastApplyMs: 3_000,
      observedToolBusyMs: 3_500,
      nonToolWallClockMs: 11_500
    })
    expect(inspection.limitations).toContain(
      'Timing milestones identify trace events, not the first usable design: an apply may be scaffolding and a screenshot may show a component or partial screen. Inspect the opened pixels and record usability separately.'
    )
  })

  it('records the exact delegated brief, effective skill reads, tools, and runtime identity', () => {
    const extensionFingerprint = 'a'.repeat(64)
    const hubFingerprint = 'b'.repeat(64)
    const rollout = [
      row({ timestamp: '2026-08-26T00:00:00.000Z', type: 'session_meta', payload: {} }),
      message(
        'developer',
        '<codex_delegation><input>Design a focused control room.</input></codex_delegation>'
      ),
      customCall(
        'await tools.exec_command({ cmd: "sed -n 1,220p /plugins/tempad/skills/figma-canvas-authoring/SKILL.md /plugins/tempad/skills/figma-canvas-authoring/references/component-authoring.md" })',
        '2026-08-26T00:00:01.000Z'
      ),
      customCall(
        'await tools.web__run({ image_query: [{ q: "control room" }] })',
        '2026-08-26T00:00:02.000Z'
      ),
      applyCall(
        { markup: '<div data-key="root"></div>' },
        {
          isError: false,
          structuredContent: {
            runtime: {
              locked: true,
              valid: true,
              issues: [],
              hub: { runtimeFingerprint: hubFingerprint },
              extension: { runtimeFingerprint: extensionFingerprint }
            }
          }
        },
        'completed',
        {
          timestamp: '2026-08-26T00:00:04.000Z',
          startedAtMs: Date.parse('2026-08-26T00:00:03.000Z'),
          completedAtMs: Date.parse('2026-08-26T00:00:04.000Z')
        }
      ),
      timedItem('2026-08-26T00:00:05.000Z', { type: 'AgentMessage' })
    ].join('')

    const inspection = inspectAuthoringRollout(rollout)
    expect(inspection.prompt).toMatchObject({
      text: 'Design a focused control room.',
      wordCount: 5,
      characterCount: 30
    })
    expect(inspection.prompt.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(inspection.skillContext).toEqual({
      readCalls: 1,
      uniqueResources: [
        'figma-canvas-authoring/SKILL.md',
        'figma-canvas-authoring/references/component-authoring.md'
      ]
    })
    expect(inspection.tools).toEqual({
      completedCalls: 1,
      failures: 0,
      byName: { 'tempad-dev-dev.apply_canvas': 1 }
    })
    expect(inspection.runtime).toEqual({
      observations: 1,
      locked: true,
      valid: true,
      hubFingerprints: [hubFingerprint],
      extensionFingerprints: [extensionFingerprint],
      issues: []
    })
    expect(inspection.timing).toMatchObject({
      firstResearchCallMs: 2_000,
      lastResearchCallMs: 2_000,
      firstApplyAttemptMs: 4_000
    })
  })

  it('uses completed shell commands to resolve skill paths assembled inside an exec call', () => {
    const rollout = [
      customCall(
        'const base = "/plugins/tempad/skills/figma-canvas-authoring/references"; for (const file of ["visual-composition.md", "variables.md"]) await tools.exec_command({ cmd: `sed -n 1,260p "${base}/${file}"` })'
      ),
      commandExecution(
        'sed -n 1,260p /plugins/tempad/skills/figma-canvas-authoring/references/visual-composition.md'
      ),
      commandExecution(
        'sed -n 1,260p /plugins/tempad/skills/figma-canvas-authoring/references/variables.md'
      )
    ].join('')

    expect(inspectAuthoringRollout(rollout).skillContext).toEqual({
      readCalls: 2,
      uniqueResources: [
        'figma-canvas-authoring/references/variables.md',
        'figma-canvas-authoring/references/visual-composition.md'
      ]
    })
  })

  it('expands skill reference paths grouped by a shell brace expression', () => {
    const rollout = commandExecution(
      'wc -l /plugins/tempad/skills/figma-canvas-authoring/references/{visual-composition.md,style-grounding.md,visual-assets.md,canvas-html.md}'
    )

    expect(inspectAuthoringRollout(rollout).skillContext).toEqual({
      readCalls: 1,
      uniqueResources: [
        'figma-canvas-authoring/references/canvas-html.md',
        'figma-canvas-authoring/references/style-grounding.md',
        'figma-canvas-authoring/references/visual-assets.md',
        'figma-canvas-authoring/references/visual-composition.md'
      ]
    })
  })

  it('decodes XML entities in the delegated brief before fingerprinting it', () => {
    const rollout = [
      row({ timestamp: '2026-08-26T00:00:00.000Z', type: 'session_meta', payload: {} }),
      message(
        'developer',
        '<codex_delegation><input>Book Shape &amp; finish &lt;review&gt; &quot;now&quot; &apos;today&apos;.</input></codex_delegation>'
      )
    ].join('')

    expect(inspectAuthoringRollout(rollout).prompt.text).toBe(
      'Book Shape & finish <review> "now" \'today\'.'
    )
  })

  it('reads a delegated brief from the native create-thread output', () => {
    const rollout = createThreadOutput(
      'Design a four-state transfer flow &amp; preserve safe retry behavior.'
    )

    expect(inspectAuthoringRollout(rollout).prompt.text).toBe(
      'Design a four-state transfer flow & preserve safe retry behavior.'
    )
  })
})
