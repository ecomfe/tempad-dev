import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'rem', rootFontSize: 16, scale: 2 } }
}))

afterEach(() => vi.unstubAllGlobals())

it('retains a px-suffixed bound variable and its token definition through get_code', async () => {
  const variable = {
    id: 'spacing',
    name: 'spacing-16px',
    variableCollectionId: 'collection',
    resolvedType: 'FLOAT',
    scopes: ['WIDTH_HEIGHT'],
    valuesByMode: { base: 16 },
    resolveForConsumer: () => ({ value: 16, resolvedType: 'FLOAT' })
  }
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: {
      getVariableById: () => variable,
      getVariableCollectionById: () => ({
        id: 'collection',
        name: 'Spacing',
        defaultModeId: 'base',
        modes: [{ modeId: 'base', name: 'Default' }]
      })
    },
    getStyleById: () => null
  })
  const root = {
    id: 'root',
    type: 'FRAME',
    name: 'root',
    visible: true,
    x: 0,
    y: 0,
    width: 16,
    height: 40,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 16, height: 40 },
    absoluteRenderBounds: { x: 0, y: 0, width: 16, height: 40 },
    children: [],
    fills: [],
    strokes: [],
    effects: [],
    boundVariables: { width: { type: 'VARIABLE_ALIAS', id: 'spacing' } },
    getCSSAsync: async () => ({ width: 'var(--spacing-16px, 16px)', height: '40px' })
  } as unknown as SceneNode

  const unresolved = await handleGetCode([root])
  expect(unresolved.code).toContain('w-(--spacing-16px)')
  expect(unresolved.tokens).toEqual({ '--spacing-16px': { kind: 'number', value: '2rem' } })

  const resolved = await handleGetCode([root], undefined, true)
  expect(resolved.code).toContain('w-[2rem]')
  expect(resolved.tokens).toEqual(unresolved.tokens)
})
