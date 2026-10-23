import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

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

function fixture(syntax: string, type: Variable['resolvedType'] = 'COLOR') {
  const value = type === 'COLOR' ? { r: 0, g: 0, b: 1, a: 1 } : 16
  const variable = {
    id: 'token',
    name: 'Brand',
    codeSyntax: { WEB: syntax },
    variableCollectionId: 'collection',
    resolvedType: type,
    valuesByMode: { mode: value },
    resolveForConsumer: () => ({ value, resolvedType: type })
  }
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    getStyleById: () => null,
    variables: {
      getVariableById: () => variable,
      getVariableCollectionById: () => ({
        id: 'collection',
        name: 'Theme',
        defaultModeId: 'mode',
        modes: [{ modeId: 'mode', name: 'Default' }]
      })
    },
    getImageByHash: () => ({
      getBytesAsync: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    })
  })
}

function frame(id: string, css: Record<string, string>, properties: Record<string, unknown> = {}) {
  return {
    id,
    type: 'FRAME',
    name: id,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    children: [],
    fills: [],
    strokes: [],
    effects: [],
    getCSSAsync: async () => css,
    ...properties
  } as unknown as SceneNode
}

it.each([false, true])(
  'does not turn an unbound sibling color into another node’s token (resolved=%s)',
  async (resolveTokens) => {
    fixture('#F00')
    const bound = frame(
      'bound',
      { background: 'var(--Brand)' },
      {
        fills: [
          { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, boundVariables: { color: { id: 'token' } } }
        ]
      }
    )
    const literal = frame(
      'literal',
      { background: '#F00' },
      {
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
      }
    )
    const root = frame(
      'root',
      { display: 'flex' },
      {
        layoutMode: 'HORIZONTAL',
        children: [bound, literal]
      }
    )
    for (const child of [bound, literal]) Object.assign(child, { parent: root })

    const result = await handleGetCode([root], 'jsx', resolveTokens)

    expect(result.code).toContain('bg-[#F00]')
    expect(result.code.match(resolveTokens ? /bg-\[#00F\]/g : /bg-\(--Brand\)/g)).toHaveLength(1)
    expect(result.tokens).toEqual({ '--Brand': { kind: 'color', value: '#00F' } })
  }
)

it('keeps a token-like asset URL and quoted font family literal through final codegen', async () => {
  fixture('image', 'FLOAT')
  const root = frame(
    'root',
    {
      width: 'image',
      'font-family': '"image"',
      background: 'url(image.png) center / cover no-repeat'
    },
    {
      boundVariables: { width: { id: 'token' } },
      fills: [{ type: 'IMAGE', imageHash: 'native-image', scaleMode: 'FILL' }]
    }
  )

  const result = await handleGetCode([root])

  expect(result.code).toContain('https://assets.test/image.png')
  expect(result.code).toContain('font-[family-name:&quot;image&quot;]')
  expect(result.code).toContain('w-(--Brand)')
  expect(result.assets).toEqual([expect.objectContaining({ figmaImageHash: 'native-image' })])
})
