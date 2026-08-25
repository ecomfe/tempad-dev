import { describe, expect, it } from 'vitest'

import { inspectAuthoringRollout } from '@/scripts/inspect-agent-authoring-rollout'

function row(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function customCall(input: string): string {
  return row({
    type: 'response_item',
    payload: { type: 'custom_tool_call', name: 'exec', input }
  })
}

function applyCall(
  argumentsValue: unknown,
  result: unknown,
  status: 'completed' | 'failed' = 'completed'
): string {
  return row({
    type: 'event_msg',
    payload: {
      type: 'item_completed',
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

describe('agent authoring rollout inspection', () => {
  it('summarizes research, acquisition, icon, component, and apply evidence', () => {
    const rollout = [
      customCall('await tools.web__run({ image_query: [{ q: "editorial travel" }] })'),
      customCall('await browser.goto("https://example.com/reference")'),
      customCall('await browser.screenshot()'),
      customCall('await tools.image_gen__imagegen({ prompt: "bespoke fictional object" })'),
      imageView('file:///tmp/work/references/category-reference.png'),
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
      applyCanvas: { calls: 2, failures: 0, failureCodes: {}, nodeLimitAttempts: [] },
      research: {
        webCalls: 1,
        imageQueryCalls: 1,
        openedSourceCalls: 1,
        browserScreenshotCalls: 1
      },
      imageViews: { total: 3, references: 1, tempadScreenshots: 1, other: 1 },
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
      nodeLimitAttempts: [{ limit: 160, dataKeyCount: 161, markupCharacters: markup.length }]
    })
  })
})
