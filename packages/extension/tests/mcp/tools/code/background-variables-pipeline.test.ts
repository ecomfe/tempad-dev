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

const solid = {
  type: 'SOLID',
  color: { r: 1, g: 0, b: 0 },
  boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'base' } }
}
const image = { type: 'IMAGE', imageHash: 'native-image', scaleMode: 'FILL' }
const gradient = {
  type: 'GRADIENT_LINEAR',
  gradientStops: [
    {
      position: 0,
      color: { r: 1, g: 0, b: 0, a: 1 },
      boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'base' } }
    },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
  ],
  gradientTransform: [
    [1, 0, 0],
    [0, 1, 0]
  ]
}
const nativeImage = 'url(<path-to-image>) lightgray 50% / cover no-repeat'
const cases = [
  {
    name: 'bottom color',
    fills: [solid, image, { ...image, imageHash: 'front' }],
    background: `${nativeImage}, ${nativeImage}, var(--Base, #F00)`,
    imageCount: 2
  },
  {
    name: 'gradient stop',
    fills: [gradient, image],
    background: `${nativeImage}, linear-gradient(90deg, var(--Base, #F00) 0%, #00F 100%)`,
    imageCount: 1
  },
  {
    name: 'translucent foreground',
    fills: [image, { ...solid, opacity: 0.5 }],
    background: `linear-gradient(0deg, var(--Base, rgba(255, 0, 0, 0.50)) 0%, var(--Base, rgba(255, 0, 0, 0.50)) 100%), ${nativeImage}`,
    imageCount: 1
  }
]

it.each(
  cases.flatMap((sample) =>
    [false, true].flatMap((resolveTokens) =>
      (['jsx', 'vue'] as const).map((lang) => ({ ...sample, resolveTokens, lang }))
    )
  )
)(
  'preserves images beside a variable-backed $name ($lang, resolved=$resolveTokens)',
  async ({ name, fills, background, imageCount, resolveTokens, lang }) => {
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
      children: [],
      fills,
      strokes: [],
      effects: [],
      getCSSAsync: async () => ({ background })
    } as unknown as SceneNode

    const result = await handleGetCode([root], lang, resolveTokens)

    expect(result.code.match(/https:\/\/assets.test\/(?:image|front).png/g)).toHaveLength(
      imageCount
    )
    expect(result.code).not.toContain('<path-to-image>')
    expect(result.code).not.toContain('lightgray')
    const translucent = name === 'translucent foreground'
    expect(result.code).toContain(
      resolveTokens ? (translucent ? 'rgba(255, 0, 0, 0.5)' : '#F00') : 'var(--Base)'
    )
    expect(result.tokens?.['--Base']).toEqual({ kind: 'color', value: '#F00' })
    expect(result.assets).toEqual([
      ...(imageCount === 2
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
        figmaImageHash: 'native-image'
      }
    ])
    if (imageCount === 2) {
      expect(result.code.indexOf('front.png')).toBeLessThan(result.code.indexOf('image.png'))
    }
    if (name === 'gradient stop') {
      expect(result.code).toContain('linear-gradient(90deg,')
      expect(result.code).not.toContain('backgroundColor:')
    }
    if (translucent) {
      expect(result.code).toContain(
        resolveTokens ? 'rgba(255, 0, 0, 0.5)' : 'color-mix(in srgb, var(--Base) 50%, transparent)'
      )
      expect(result.code.indexOf('linear-gradient')).toBeLessThan(result.code.indexOf('url('))
    }
  }
)
