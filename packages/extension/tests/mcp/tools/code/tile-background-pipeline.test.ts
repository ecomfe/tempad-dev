import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'
import { options } from '@/ui/state'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: async (bytes: Uint8Array) => ({
    hash: 'image',
    url: 'https://assets.test/image.png',
    mimeType: 'image/png',
    size: bytes.length
  })
}))

afterEach(() => vi.unstubAllGlobals())

it.each([
  { lang: 'jsx', cssUnit: 'px', scale: 1, layered: false, size: '48px' },
  { lang: 'vue', cssUnit: 'px', scale: 1, layered: true, size: '48px' },
  { lang: 'jsx', cssUnit: 'rem', scale: 2, layered: true, size: '6rem' },
  { lang: 'vue', cssUnit: 'rem', scale: 2, layered: false, size: '6rem' }
] as const)(
  'preserves native Tile size through $lang $cssUnit output (layered=$layered)',
  async ({ lang, cssUnit, scale, layered, size }) => {
    Object.assign(options.value, { cssUnit, rootFontSize: 16, scale })
    const getSizeAsync = vi.fn(async () => ({ width: 96, height: 96 }))
    vi.stubGlobal('__DEV__', false)
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: { getVariableById: () => null },
      getStyleById: () => null,
      getImageByHash: () => ({
        getBytesAsync: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
        getSizeAsync
      })
    })
    const root = {
      id: 'root',
      type: 'FRAME',
      name: 'root',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 100 },
      children: [],
      fills: [
        ...(layered ? [{ type: 'IMAGE', imageHash: 'crop', scaleMode: 'CROP' }] : []),
        { type: 'IMAGE', imageHash: 'tile', scaleMode: 'TILE', scalingFactor: 0.5 }
      ],
      strokes: [],
      effects: [],
      getCSSAsync: async () => ({
        background: [
          'url("tile.png") lightgray 0% 0% / 50px 50px repeat',
          ...(layered
            ? ['url("crop.png") lightgray -2.08px -14.75px / 104.167% 145.833% no-repeat']
            : [])
        ].join(', ')
      })
    } as unknown as SceneNode

    const result = await handleGetCode([root], lang)

    if (layered) {
      expect(result.code).toContain(`0% 0% / ${size} ${size} repeat`)
      expect(result.code).toContain('104.167% 145.833% no-repeat')
      expect(result.code).not.toContain('bg-[length:')
    } else {
      expect(result.code).toContain(`bg-[length:${size}_${size}]`)
    }
    expect(result.code).toContain('https://assets.test/image.png')
    expect(result.code).not.toContain('50px')
    expect(getSizeAsync).toHaveBeenCalledTimes(1)
    expect(result.assets).toHaveLength(1)
  }
)
