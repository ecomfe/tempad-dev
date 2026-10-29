import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

afterEach(() => vi.unstubAllGlobals())

it.each(['jsx', 'vue'] as const)(
  'preserves template delimiters in %s get_code text',
  async (lang) => {
    vi.stubGlobal('__DEV__', false)
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: { getVariableById: () => null, getVariableCollectionById: () => null },
      getStyleById: () => null
    })
    const text = {
      id: 'text',
      type: 'TEXT',
      name: 'Greeting',
      visible: true,
      characters: 'Hello {customer}; {{customer}}',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 40 },
      fills: [],
      strokes: [],
      effects: [],
      getCSSAsync: async () => ({ width: '100px', height: '40px' })
    } as unknown as TextNode

    const result = await handleGetCode([text], lang)
    expect(result.lang).toBe(lang)
    expect(result.code).toContain('Hello &#123;customer&#125;; &#123;&#123;customer&#125;&#125;')
  }
)
