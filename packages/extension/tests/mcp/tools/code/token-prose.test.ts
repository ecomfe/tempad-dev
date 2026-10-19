import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'
import { processTokens } from '@/mcp/tools/code/tokens/process'
import { stringifyComponent } from '@/utils/component'

const state = vi.hoisted(() => ({
  activePlugin: { value: undefined as undefined | { name: string; code: string } },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))
vi.mock('@/ui/state', () => state)
vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: async (refs: Array<{ name: string }>) =>
    refs.map(({ name }) => `var(--renamed-${name})`)
}))

const prose =
  'Use var(--brand, #fff) and --brand as a fallback; color-mix(in srgb, #fff 50%, transparent)'

function fixture(bound: boolean) {
  vi.stubGlobal('__DEV__', false)
  const variable = {
    id: 'brand',
    name: 'brand',
    resolvedType: 'FLOAT',
    variableCollectionId: 'collection',
    valuesByMode: { base: 24 },
    resolveForConsumer: () => ({ resolvedType: 'FLOAT', value: 24 })
  }
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: {
      getVariableById: (id: string) => (id === variable.id ? variable : null),
      getVariableCollectionById: () => ({
        id: 'collection',
        name: 'Theme',
        defaultModeId: 'base',
        modes: [{ modeId: 'base', name: 'Default' }]
      })
    },
    getStyleById: () => null
  })
  return {
    id: 'text',
    name: '--brand',
    type: 'TEXT',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    characters: prose,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 40 },
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    strokes: [],
    effects: [],
    boundVariables: bound ? { width: { type: 'VARIABLE_ALIAS', id: variable.id } } : {},
    getCSSAsync: async () => ({ width: bound ? 'var(--brand, 24px)' : '100px', color: '#000' }),
    getStyledTextSegments: () => []
  } as unknown as TextNode
}

afterEach(() => {
  state.activePlugin.value = undefined
  vi.unstubAllGlobals()
})

describe('get_code token transformations preserve literal content', () => {
  it('does not detect token names in literal text or attributes', async () => {
    fixture(false)
    const result = await processTokens({
      component: { name: 'span', props: { title: prose }, children: [prose] },
      serialize: (component) => stringifyComponent(component, 'jsx'),
      variableIds: new Set(['brand']),
      usedCandidateIds: new Set(),
      variableCache: new Map(),
      styles: new Map(),
      textSegments: new Map(),
      svgs: new Map(),
      config: { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      pluginCode: 'rename-plugin'
    })
    expect(result.code).toContain(`title="${prose}"`)
    expect(result.code).toContain(prose)
    expect(result.tokensByCanonical).toEqual({})
  })

  it.each(['jsx', 'vue'] as const)(
    'preserves var() prose without variables in %s',
    async (lang) => {
      const result = await handleGetCode([fixture(false)], lang)
      expect(result.code).toContain(prose)
      expect(result.tokens).toBeUndefined()
    }
  )

  it.each([false, true])(
    'renames only style references with resolveTokens=%s',
    async (resolveTokens) => {
      state.activePlugin.value = { name: 'Rename', code: 'rename-plugin' }
      const result = await handleGetCode([fixture(true)], 'jsx', resolveTokens)
      expect(result.code).toContain(prose)
      expect(result.tokens).toHaveProperty('--renamed-brand')
      expect(result.code).toContain(resolveTokens ? 'w-[24px]' : '--renamed-brand')
      if (resolveTokens) expect(result.code).not.toContain('w-(--renamed-brand)')
    }
  )
})
