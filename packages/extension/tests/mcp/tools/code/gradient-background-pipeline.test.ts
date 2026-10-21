import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))
vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: async () => ({
    hash: 'image',
    url: 'https://assets.test/image.png',
    mimeType: 'image/png',
    size: 4
  })
}))
afterEach(() => vi.unstubAllGlobals())

const samples = [
  {
    type: 'GRADIENT_LINEAR',
    css: 'linear-gradient(90deg, var(--Base, #F008) 25%, #00F8 75%)',
    first: '25%',
    last: '75%'
  },
  {
    type: 'GRADIENT_RADIAL',
    css: 'radial-gradient(20% 30% at 40% 50%, var(--Base, #F008) 25%, #00F8 75%)',
    first: '25%',
    last: '75%'
  },
  {
    type: 'GRADIENT_DIAMOND',
    css: 'radial-gradient(closest-side at 40% 50%, var(--Base, #F008) 25%, #00F8 75%)',
    first: '25%',
    last: '75%'
  },
  {
    type: 'GRADIENT_ANGULAR',
    css: 'conic-gradient(from 30deg at 40% 50%, var(--Base, #F008) 90deg, #00F8 270deg)',
    first: '90deg',
    last: '270deg'
  }
]

it.each(
  samples.flatMap((sample) =>
    [false, true].flatMap((image) =>
      [false, true].map((resolveTokens) => ({ ...sample, image, resolveTokens }))
    )
  )
)(
  'preserves $type colors and positions (image=$image, resolve=$resolveTokens)',
  async ({ type, css, first, last, image, resolveTokens }) => {
    const variable = {
      id: 'base',
      name: 'Base',
      variableCollectionId: 'colors',
      resolvedType: 'COLOR',
      scopes: ['ALL_FILLS'],
      valuesByMode: { base: { r: 1, g: 0, b: 0, a: 1 } },
      resolveForConsumer: () => ({ value: { r: 1, g: 0, b: 0, a: 1 }, resolvedType: 'COLOR' })
    }
    vi.stubGlobal('__DEV__', false)
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      getStyleById: () => null,
      variables: {
        getVariableById: () => variable,
        getVariableCollectionById: () => ({
          id: 'colors',
          name: 'Colors',
          defaultModeId: 'base',
          modes: [{ modeId: 'base', name: 'Default' }]
        })
      },
      getImageByHash: () => ({
        getBytesAsync: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
      })
    })
    const root = {
      id: 'root',
      type: 'FRAME',
      name: 'root',
      visible: true,
      width: 40,
      height: 40,
      x: 0,
      y: 0,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
      children: [],
      strokes: [],
      effects: [],
      fills: [
        {
          type,
          opacity: 0.5,
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0]
          ],
          gradientStops: [
            {
              position: 0,
              color: { r: 1, g: 0, b: 0, a: 1 },
              boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'base' } }
            },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
          ]
        },
        ...(image ? [{ type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' }] : [])
      ],
      getCSSAsync: async () => ({
        background: `${image ? 'url(image) lightgray center / cover no-repeat, ' : ''}${css}`
      })
    } as unknown as SceneNode
    const result = await handleGetCode([root], 'jsx', resolveTokens)
    expect(result.code).toContain(first)
    expect(result.code).toContain(last)
    expect(result.code).toContain(resolveTokens ? 'rgba(255, 0, 0, 0.5)' : 'color-mix(')
    if (!resolveTokens) {
      expect(result.code).toContain('var(--Base)')
      expect(result.code).toMatch(/50%(?:_|,)/)
    }
    expect(result.tokens?.['--Base']).toEqual({ kind: 'color', value: '#F00' })
    expect(result.assets?.length ?? 0).toBe(image ? 1 : 0)
  }
)
