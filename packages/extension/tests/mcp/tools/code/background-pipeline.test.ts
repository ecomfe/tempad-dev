import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: async (bytes: Uint8Array) => {
    const hash = bytes.at(-1) === 1 ? 'front' : 'image'
    return {
      hash,
      url: `https://assets.test/${hash}.png`,
      mimeType: 'image/png',
      size: bytes.length
    }
  }
}))

afterEach(() => vi.unstubAllGlobals())

it.each(
  [false, true].flatMap((resolveTokens) => [
    { resolveTokens, layered: false, lang: 'jsx' as const },
    { resolveTokens, layered: true, lang: 'jsx' as const },
    { resolveTokens, layered: true, lang: 'vue' as const }
  ])
)(
  'keeps a bound base color and images through get_code ($lang, layered=$layered, resolved=$resolveTokens)',
  async ({ resolveTokens, layered, lang }) => {
    const variable = {
      id: 'base',
      name: 'Base',
      variableCollectionId: 'collection',
      resolvedType: 'COLOR',
      scopes: ['ALL_FILLS'],
      valuesByMode: { base: { r: 1, g: 0, b: 0, a: 1 } },
      resolveForConsumer: () => ({ value: { r: 1, g: 0, b: 0, a: 1 }, resolvedType: 'COLOR' })
    }
    vi.stubGlobal('__DEV__', false)
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: {
        getVariableById: () => variable,
        getVariableCollectionById: () => ({
          id: 'collection',
          name: 'Colors',
          defaultModeId: 'base',
          modes: [{ modeId: 'base', name: 'Default' }]
        })
      },
      getStyleById: () => null,
      getImageByHash: (hash: string) => ({
        getBytesAsync: async () =>
          Uint8Array.from([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
            ...(hash === 'front' ? [1] : [])
          ])
      })
    })
    const root = {
      id: 'root',
      type: 'FRAME',
      name: 'root',
      visible: true,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
      absoluteRenderBounds: { x: 0, y: 0, width: 40, height: 40 },
      children: [],
      fills: [
        { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, visible: false },
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0 },
          boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'base' } }
        },
        { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' },
        ...(layered ? [{ type: 'IMAGE', imageHash: 'front', scaleMode: 'FILL' }] : [])
      ],
      strokes: [],
      effects: [],
      boundVariables: { fills: [undefined, { type: 'VARIABLE_ALIAS', id: 'base' }] },
      getCSSAsync: async () => ({
        background: [
          ...(layered ? ['url("front.png") lightgray left / contain repeat-x'] : []),
          'url("image.png") lightgray 50% / cover no-repeat'
        ].join(', ')
      })
    } as unknown as SceneNode

    const result = await handleGetCode([root], lang, resolveTokens)

    if (layered) {
      expect(result.code).toContain(lang === 'jsx' ? 'style={{' : ':style="')
      expect(result.code).toContain(`backgroundColor: '${resolveTokens ? '#F00' : 'var(--Base)'}'`)
      expect(result.code).not.toContain('bg-[')
      expect(result.code).toContain('left / contain repeat-x')
      expect(result.code).toContain('50% / cover no-repeat')
      expect(result.code).toContain('https://assets.test/front.png')
      expect(result.code.indexOf('front.png')).toBeLessThan(result.code.indexOf('image.png'))
    } else {
      expect(result.code).toContain(resolveTokens ? 'bg-[#F00]' : 'bg-(--Base)')
    }
    expect(result.code).toContain('https://assets.test/image.png')
    expect(result.code).not.toContain('lightgray')
    expect(result.tokens?.['--Base']).toEqual({ kind: 'color', value: '#F00' })
    expect(result.assets).toEqual([
      ...(layered
        ? [
            {
              hash: 'front',
              url: 'https://assets.test/front.png',
              mimeType: 'image/png',
              size: 9,
              figmaImageHash: 'front'
            }
          ]
        : []),
      {
        hash: 'image',
        url: 'https://assets.test/image.png',
        mimeType: 'image/png',
        size: 8,
        figmaImageHash: 'image'
      }
    ])
  }
)
