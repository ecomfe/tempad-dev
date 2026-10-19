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
    size: 8
  })
}))

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
  'keeps a bound base color and image through get_code with resolveTokens=%s',
  async (resolveTokens) => {
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
      getImageByHash: () => ({
        getBytesAsync: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
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
        { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' }
      ],
      strokes: [],
      effects: [],
      boundVariables: { fills: [undefined, { type: 'VARIABLE_ALIAS', id: 'base' }] },
      getCSSAsync: async () => ({
        background: 'url("image.png") lightgray 50% / cover no-repeat'
      })
    } as unknown as SceneNode

    const result = await handleGetCode([root], undefined, resolveTokens)

    expect(result.code).toContain(resolveTokens ? 'bg-[#F00]' : 'bg-(--Base)')
    expect(result.code).toContain('https://assets.test/image.png')
    expect(result.code).not.toContain('lightgray')
    expect(result.tokens?.['--Base']).toEqual({ kind: 'color', value: '#F00' })
    expect(result.assets).toEqual([
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
