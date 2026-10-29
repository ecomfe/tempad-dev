import { CanvasVariableCollectionsSchema } from '@tempad-dev/shared'
import { expect, it } from 'vitest'

import type { CanvasNodeSpec } from '@/mcp/tools/canvas/model'

import { createApplyState } from '@/mcp/tools/canvas/reconcile/state'
import {
  authoredVariableFallbackWarnings,
  layoutWarnings
} from '@/mcp/tools/canvas/reconcile/warnings'

import { createFixture } from '../../fakes/figma'

it('inspects a wide instance subtree for overflow and skips hidden subtrees', () => {
  const fixture = createFixture()
  const parent = fixture.createNode('FRAME')
  parent.setSharedPluginData('tempad_dev', 'canvas-key', 'parent')
  const instance = fixture.createNode('INSTANCE')
  const container = fixture.createNode('FRAME')
  parent.appendChild(instance)
  instance.appendChild(container)
  Object.defineProperty(instance, 'absoluteBoundingBox', {
    value: { x: 0, y: 0, width: 100, height: 100 }
  })
  Object.defineProperty(container, 'children', {
    value: Array.from({ length: 150_000 }, (_, index) => ({
      type: 'RECTANGLE',
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: index === 149_999 ? 120 : 40 }
    }))
  })
  const state = createApplyState(null, new Set(['instance']))
  state.keyedNodes.set('instance', instance)
  const specs = [{ key: 'instance', type: 'INSTANCE' as const, size: {} }]

  expect(layoutWarnings(specs, state)).toEqual([
    {
      code: 'managed-content-overflow',
      key: 'instance',
      message: expect.stringMatching(/instance content.*bottom 20px/)
    }
  ])
  container.visible = false
  expect(layoutWarnings(specs, state)).toEqual([])
})

it.each(['HORIZONTAL', 'VERTICAL'] as const)(
  'measures the trailing inset of a wide %s container',
  (mode) => {
    createFixture()
    const root = figma.createFrame()
    root.layoutMode = mode
    root.primaryAxisSizingMode = 'FIXED'
    root.paddingRight = 0
    root.paddingBottom = 0
    root.strokes = []
    const horizontal = mode === 'HORIZONTAL'
    Object.defineProperties(root, {
      absoluteBoundingBox: {
        value: {
          x: 0,
          y: 0,
          width: horizontal ? 150_100 : 100,
          height: horizontal ? 100 : 150_100
        }
      },
      children: {
        value: Array.from({ length: 150_000 }, (_, index) => ({
          type: 'RECTANGLE',
          absoluteBoundingBox: {
            x: horizontal ? index : 0,
            y: horizontal ? 0 : index,
            width: 1,
            height: 1
          }
        }))
      }
    })
    const state = createApplyState(null, new Set(['root']))
    state.keyedNodes.set('root', root)

    expect(
      layoutWarnings(
        [{ key: 'root', type: 'FRAME', size: { horizontal: 'FIXED', vertical: 'FIXED' } }],
        state
      )
    ).toEqual([
      {
        code: 'managed-auto-layout-inset-mismatch',
        key: 'root',
        message: expect.stringContaining('100px of unmodeled trailing space')
      }
    ])
  }
)

it('bounds fallback inspection when both modes repeatedly alias the same variable', () => {
  const variableCollections = CanvasVariableCollectionsSchema.parse({
    tokens: {
      name: 'Tokens',
      modes: { day: { name: 'Day' }, night: { name: 'Night' } },
      variables: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => {
          const alias = { variable: { variableKey: `space/${index + 1}` } }
          return [
            `space/${index}`,
            {
              name: `Space/${index}`,
              type: 'FLOAT',
              values: index === 16 ? { day: 24, night: 32 } : { day: alias, night: alias }
            }
          ]
        })
      )
    }
  })
  let reads = 0
  // Bound work deterministically without a wall-clock performance assertion.
  for (const variable of Object.values(variableCollections.tokens!.variables!)) {
    for (const value of Object.values(variable!.values!)) {
      if (typeof value !== 'object' || !('variable' in value) || !('variableKey' in value.variable))
        continue
      const key = value.variable.variableKey
      Object.defineProperty(value.variable, 'variableKey', {
        get() {
          if (++reads > 512) throw new Error('Repeated alias traversal exceeded the read budget.')
          return key
        }
      })
    }
  }
  const spec: CanvasNodeSpec = {
    key: 'root',
    type: 'FRAME',
    size: {},
    layout: { mode: 'HORIZONTAL', gap: 14 },
    variables: { gap: { variableKey: 'space/0' } }
  }

  expect(authoredVariableFallbackWarnings([spec], variableCollections)).toEqual([
    {
      code: 'variable-fallback-mismatch',
      key: 'root',
      message: expect.stringContaining('direct mode values are 24, 32.')
    }
  ])
  expect(
    authoredVariableFallbackWarnings(
      [{ ...spec, layout: { mode: 'HORIZONTAL', gap: 32 } }],
      variableCollections
    )
  ).toEqual([])
})
