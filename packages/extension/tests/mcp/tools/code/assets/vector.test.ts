import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

vi.mock('@/mcp/tools/token/raw-name', () => ({
  getVariableRawName: vi.fn((variable: Variable) => variable.name)
}))

import { ensureAssetUploaded } from '@/mcp/assets'
import { normalizeThemeableSvg } from '@/mcp/tools/code/assets/svg'
import {
  exportSvgEntry,
  extractSvgAttributes,
  transformSvgAttributes
} from '@/mcp/tools/code/assets/vector'
import { analyzeVectorColorModel } from '@/mcp/tools/code/assets/vector-semantics'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: vi.fn()
}))

vi.mock('@/utils/log', () => ({
  logger: {
    warn: vi.fn()
  }
}))

const remConfig = {
  cssUnit: 'rem',
  rootFontSize: 16,
  scale: 1
} as const

const pxConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
} as const

type Snapshot = VisibleTree['nodes'] extends Map<string, infer T> ? T : never

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('assets/vector', () => {
  it.each(
    ['SVG export', 'asset upload'].flatMap((stage) =>
      ['resolve', 'reject'].map((outcome) => ({ stage, outcome }))
    )
  )('stops expired $stage after $outcome', async ({ stage, outcome }) => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let finish!: () => void
    const stall = <T>(value: T) =>
      new Promise<T>((resolve, reject) => {
        finish = () =>
          outcome === 'resolve' ? resolve(value) : reject(new Error('Native request failed'))
        started()
      })
    const bytes = new TextEncoder().encode(
      '<svg width="10" height="10"><path d="M0 0H10V10Z"/></svg>'
    )
    const asset = {
      hash: 'asset',
      url: 'https://assets.test/asset.svg',
      mimeType: 'image/svg+xml',
      size: bytes.length
    }
    vi.mocked(ensureAssetUploaded).mockImplementation(() =>
      stage === 'asset upload' ? stall(asset) : Promise.resolve(asset)
    )
    const exportAsync = vi.fn(() =>
      stage === 'SVG export' ? stall(bytes) : Promise.resolve(bytes)
    )
    const registry = new Map()
    const controller = new AbortController()
    const pending = exportSvgEntry(
      { id: 'vector', width: 10, height: 10, exportAsync } as unknown as SceneNode,
      pxConfig,
      registry,
      { assertActive: () => controller.signal.throwIfAborted() }
    )
    await ready
    const reason = new Error('Code generation timed out')
    controller.abort(reason)
    const rejected = expect(pending).rejects.toBe(reason)
    finish()
    await rejected

    expect(exportAsync).toHaveBeenCalledOnce()
    expect(ensureAssetUploaded).toHaveBeenCalledTimes(stage === 'asset upload' ? 1 : 0)
    expect(registry.size).toBe(0)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each(['smart', 'snapshot'] as const)(
    'preserves visible zero-height LINE stroke in %s mode',
    async (vectorMode) => {
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: 'line',
        url: 'https://assets.test/line.svg',
        mimeType: 'image/svg+xml',
        size: 1
      })
      const node = {
        id: 'line',
        width: 80,
        height: 0,
        absoluteTransform: [
          [1, 0, 100],
          [0, 1, 200]
        ],
        absoluteRenderBounds: { x: 100, y: 198, width: 80, height: 4 },
        exportAsync: vi.fn(async (options: ExportSettingsSVG) => {
          if (options.useAbsoluteBounds) throw new Error('Zero-height export viewport')
          return new TextEncoder().encode(
            '<svg viewBox="0 0 80 4"><path d="M0 2H80" stroke="red" stroke-width="4"/></svg>'
          )
        })
      } as unknown as SceneNode
      const entry = await exportSvgEntry(node, pxConfig, new Map(), { vectorMode })
      expect(entry?.props).toMatchObject({
        width: '80px',
        height: '4px',
        viewBox: '0 -2 80 4',
        'data-src': 'https://assets.test/line.svg'
      })
      expect(entry?.wrapper).toEqual({ width: '80px', height: '0px', left: '0px', top: '-2px' })
      expect(node.exportAsync).toHaveBeenCalledWith({ format: 'SVG', useAbsoluteBounds: false })
    }
  )

  it.each([
    {
      file: 'native-outside-stroke.svg',
      bounds: { x: 88, y: 188, width: 88, height: 72 },
      viewBox: '-12 -12 88 72'
    },
    {
      file: 'native-shadow.svg',
      bounds: { x: 100, y: 200, width: 88, height: 68 },
      viewBox: '0 0 88 68'
    }
  ])(
    'expands the viewport around captured native overflow: $file',
    async ({ file, bounds, viewBox }) => {
      const native = readFileSync(new URL(`../../../../fixtures/svg/${file}`, import.meta.url))
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: file,
        url: `https://assets.test/${file}`,
        mimeType: 'image/svg+xml',
        size: native.length
      })
      const node = {
        id: file,
        width: 64,
        height: 48,
        absoluteTransform: [
          [1, 0, 100],
          [0, 1, 200]
        ],
        absoluteRenderBounds: bounds,
        exportAsync: vi.fn(async () => native)
      } as unknown as SceneNode
      const entry = await exportSvgEntry(node, { ...pxConfig, scale: 2 }, new Map())
      const uploaded = new TextDecoder().decode(vi.mocked(ensureAssetUploaded).mock.lastCall![0])
      expect(extractSvgAttributes(uploaded).viewBox).toBe(viewBox)
      expect(entry?.props.width).toBe('176px')
      expect(entry?.wrapper?.width).toBe('64px')
      expect(uploaded).toContain(
        file.includes('stroke') ? 'stroke-width="12"' : 'filter0_d_2772_20'
      )
    }
  )

  it.each([
    {
      transform: [
        [1, 0.5, 100],
        [0, 1, 200]
      ],
      bounds: { x: 98, y: 198, width: 31, height: 14 },
      local: '-8 -2 38 14',
      flow: '-2 -2 31 14'
    },
    {
      transform: [
        [0, -1, 100],
        [1, 0, 200]
      ],
      bounds: { x: 88, y: 198, width: 14, height: 24 },
      local: '-2 -2 24 14',
      flow: '-2 -2 14 24'
    }
  ])(
    'maps overflow through positioned and flow transforms: $transform',
    async ({ transform, bounds, local, flow }) => {
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: 'transform',
        url: 'https://assets.test/transformed.svg',
        mimeType: 'image/svg+xml',
        size: 1
      })
      const node = {
        id: 'transform',
        width: 20,
        height: 10,
        absoluteTransform: transform,
        relativeTransform: transform,
        absoluteRenderBounds: bounds,
        exportAsync: async () =>
          new TextEncoder().encode('<svg viewBox="0 0 25 20"><path d="M0 0H20V10H0Z"/></svg>')
      } as unknown as SceneNode
      expect((await exportSvgEntry(node, pxConfig, new Map()))?.props.viewBox).toBe(local)
      expect((await exportSvgEntry(node, pxConfig, new Map(), { flow: true }))?.props.viewBox).toBe(
        flow
      )
    }
  )
  it.each([
    [
      [-1, 0, 20],
      [0, -1, 10]
    ],
    [
      [-1, 0, 20],
      [0, 1, 0]
    ],
    [
      [0, -1, 10],
      [1, 0, 0]
    ]
  ] as Transform[])(
    'bakes flow transforms into the SVG and reserves the transformed slot',
    async (...rows) => {
      const transform = rows as unknown as Transform
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: 'flow',
        url: 'https://assets.test/flow.svg',
        mimeType: 'image/svg+xml',
        size: 10
      })
      const node = {
        id: 'flow',
        width: 20,
        height: 10,
        relativeTransform: transform,
        absoluteTransform: transform,
        exportAsync: vi.fn(async () =>
          new TextEncoder().encode('<svg width="20" height="10"><path d="M0 0H20V10H0Z"/></svg>')
        )
      } as unknown as SceneNode
      const result = await exportSvgEntry(node, pxConfig, new Map(), { flow: true })
      expect(result?.presentationStyle).not.toHaveProperty('transform')
      expect(result?.presentationStyle?.width).toBe(transform[0][0] === 0 ? '10px' : '20px')
      expect(result?.presentationStyle?.height).toBe(transform[0][0] === 0 ? '20px' : '10px')
      const svg = new TextDecoder().decode(vi.mocked(ensureAssetUploaded).mock.calls[0]![0])
      expect(svg).not.toContain('matrix(-1')
    }
  )

  it.each([
    { cropWidth: 491, cropHeight: 465, y: 0 },
    { cropWidth: 317, cropHeight: 406, y: -59 }
  ])(
    'exports full node coordinates when an ancestor clips to $cropWidth x $cropHeight',
    async ({ cropWidth, cropHeight, y }) => {
      const full =
        '<svg width="669.352" height="465" viewBox="0 0 669.352 465"><path d="M0 0h669.352v465H0Z"/></svg>'
      const cropped = `<svg width="${cropWidth}" height="${cropHeight}" viewBox="0 0 ${cropWidth} ${cropHeight}"><path d="M0 ${y}h669.352v465H0Z"/></svg>`
      const fullBytes = new TextEncoder().encode(full)
      const node = {
        id: 'clipped-vector',
        width: 669.352,
        height: 465,
        absoluteTransform: [
          [1, 0, 0],
          [0, 1, 0]
        ],
        absoluteRenderBounds: { x: 0, y: -y, width: cropWidth, height: cropHeight },
        exportAsync: vi.fn(async (settings: ExportSettingsSVG) =>
          settings.useAbsoluteBounds ? fullBytes : new TextEncoder().encode(cropped)
        )
      } as unknown as SceneNode
      const asset = {
        hash: 'full',
        url: 'http://assets.test/full.svg',
        mimeType: 'image/svg+xml',
        size: fullBytes.length
      }

      for (const vectorMode of ['smart', 'snapshot'] as const) {
        vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)
        const entry = await exportSvgEntry(node, pxConfig, new Map(), { vectorMode })
        expect(entry?.props).toMatchObject({
          width: '669.352px',
          height: '465px',
          viewBox: '0 0 669.352 465'
        })
        expect(ensureAssetUploaded).toHaveBeenLastCalledWith(
          expect.any(Uint8Array),
          'image/svg+xml',
          {
            width: 669,
            height: 465
          }
        )
        const uploaded = new TextDecoder().decode(vi.mocked(ensureAssetUploaded).mock.lastCall![0])
        expect(extractSvgAttributes(uploaded)).toEqual({
          width: '669.352px',
          height: '465px',
          viewBox: '0 0 669.352 465'
        })
        expect(uploaded).toContain('d="M0 0h669.352v465H0Z"')

        vi.mocked(ensureAssetUploaded).mockRejectedValue(new Error('upload failed'))
        const fallback = await exportSvgEntry(node, pxConfig, new Map(), { vectorMode })
        expect(fallback?.raw).toContain('viewBox="0 0 669.352 465"')
        expect(fallback?.raw).toContain('d="M0 0h669.352v465H0Z"')
      }
      expect(node.exportAsync).toHaveBeenCalledWith({ format: 'SVG', useAbsoluteBounds: true })
    }
  )

  it('uploads themeable vectors as asset-backed svg placeholders in smart mode', async () => {
    const svg = '<svg viewBox="0 0 16 16"><path fill="#111" d="M0 0h16v16z"/></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      id: '12:34',
      width: 16,
      height: 16,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode
    const asset = {
      hash: 'themeable-hash',
      mimeType: 'image/svg+xml',
      url: 'http://assets.test/themeable.svg',
      size: bytes.byteLength,
      themeable: true
    }
    vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)

    const registry = new Map<string, unknown>()
    const result = await exportSvgEntry(node, remConfig, registry as Map<string, never>, {
      vectorMode: 'smart',
      colorModel: { kind: 'single-channel', color: 'var(--icon-color)' }
    })

    expect(result).toEqual({
      props: {
        height: '1rem',
        viewBox: '0 0 16 16',
        width: '1rem',
        'data-src': 'http://assets.test/themeable.svg'
      },
      presentationStyle: {
        color: 'var(--icon-color)'
      }
    })
    expect(ensureAssetUploaded).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/svg+xml', {
      width: 16,
      height: 16,
      themeable: true
    })
    expect(registry.get('themeable-hash')).toEqual(asset)
  })

  it('uploads zero-height fixed vectors without invalid height metadata', async () => {
    const svg =
      '<svg width="16" height="16"><path fill="#111" d="M0 0h8v16z"/><path fill="#f00" d="M8 0h8v16z"/></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      id: 'vector-fixed',
      width: 16,
      height: 0,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    const asset = {
      hash: 'asset-hash',
      mimeType: 'image/svg+xml',
      url: 'http://assets.test/hash.svg',
      size: bytes.byteLength
    }
    vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)

    const registry = new Map<string, unknown>()
    const result = await exportSvgEntry(node, remConfig, registry as Map<string, never>, {
      vectorMode: 'smart',
      colorModel: { kind: 'fixed' }
    })

    expect(result).toEqual({
      props: {
        width: '1rem',
        height: '0',
        viewBox: '0 0 16 16',
        'data-src': 'http://assets.test/hash.svg'
      }
    })
    expect(ensureAssetUploaded).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/svg+xml', {
      width: 16
    })
    expect(registry.get('asset-hash')).toEqual(asset)
  })

  it('keeps themeable vectors as assets in snapshot mode and marks the asset as themeable', async () => {
    const svg = '<svg width="20" height="10"><path fill="#222" d="M0 0h20v10z"/></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      id: 'vector-themeable',
      width: 20,
      height: 10,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    const asset = {
      hash: 'asset-hash',
      mimeType: 'image/svg+xml',
      url: 'http://assets.test/hash.svg',
      size: bytes.byteLength,
      themeable: true
    }
    vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)

    const registry = new Map<string, unknown>()
    const result = await exportSvgEntry(node, pxConfig, registry as Map<string, never>, {
      vectorMode: 'snapshot',
      colorModel: { kind: 'single-channel', color: '#222' }
    })

    expect(result).toEqual({
      props: {
        width: '20px',
        height: '10px',
        viewBox: '0 0 20 10',
        'data-src': 'http://assets.test/hash.svg'
      },
      presentationStyle: {
        color: '#222'
      }
    })
    expect(registry.get('asset-hash')).toEqual(asset)
  })

  it('falls back to sized raw svg when uploading vector assets fails', async () => {
    const svg =
      '<svg width="20" height="10"><path fill="#f00" d="M0 0h20v10z"/><path fill="#0f0" d="M0 0h10v10z"/></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      id: 'vector-upload-fail',
      width: 20,
      height: 10,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    vi.mocked(ensureAssetUploaded).mockRejectedValue(new Error('upload failed'))
    const result = await exportSvgEntry(node, pxConfig, new Map(), {
      vectorMode: 'smart',
      colorModel: { kind: 'fixed' }
    })

    expect(result).toEqual({
      props: {
        width: '20px',
        height: '10px',
        viewBox: '0 0 20 10'
      },
      raw: '<svg height="10px" viewBox="0 0 20 10" width="20px"><path d="M0 0h20v10z" fill="#f00"/><path d="M0 0h10v10z" fill="#0f0"/></svg>'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to upload vector asset; inlining SVG fallback to preserve source of truth.',
      expect.any(Error)
    )
  })

  it('returns minimal fallback when exporting svg throws', async () => {
    const node = {
      id: 'vector-error',
      width: 10.456,
      height: 20.123,
      exportAsync: vi.fn(async () => {
        throw new Error('export failed')
      })
    } as unknown as SceneNode

    const result = await exportSvgEntry(node, pxConfig, new Map())

    expect(result).toEqual({
      props: {
        width: `${toDecimalPlace(10.456)}px`,
        height: `${toDecimalPlace(20.123)}px`
      }
    })
    expect(logger.warn).toHaveBeenCalledWith('Failed to export vector node:', expect.any(Error))
  })

  it('treats same-color fills with different opacities as themeable', () => {
    const tree = makeTree([
      makeSnapshot(
        'root',
        {
          id: 'root',
          type: 'FRAME',
          visible: true,
          fills: [],
          strokes: [],
          effects: []
        } as unknown as SceneNode,
        ['left', 'right']
      ),
      makeSnapshot('left', {
        id: 'left',
        type: 'RECTANGLE',
        visible: true,
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
        strokes: [],
        effects: []
      } as unknown as SceneNode),
      makeSnapshot('right', {
        id: 'right',
        type: 'RECTANGLE',
        visible: true,
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 0.4 }],
        strokes: [],
        effects: []
      } as unknown as SceneNode)
    ])

    expect(analyzeVectorColorModel(tree, 'root')).toEqual({
      kind: 'single-channel',
      color: '#F00'
    })
  })

  it('treats consistent stroke-only vectors as themeable', () => {
    const tree = makeTree([
      makeSnapshot(
        'root',
        {
          id: 'root',
          type: 'FRAME',
          visible: true,
          fills: [],
          strokes: [],
          effects: []
        } as unknown as SceneNode,
        ['left', 'right']
      ),
      makeSnapshot('left', {
        id: 'left',
        type: 'RECTANGLE',
        visible: true,
        fills: [],
        strokes: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
        strokeWeight: 1,
        effects: []
      } as unknown as SceneNode),
      makeSnapshot('right', {
        id: 'right',
        type: 'RECTANGLE',
        visible: true,
        fills: [],
        strokes: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
        strokeWeight: 2,
        effects: []
      } as unknown as SceneNode)
    ])

    expect(analyzeVectorColorModel(tree, 'root')).toEqual({
      kind: 'single-channel',
      color: '#000'
    })
  })

  it('treats gradients and visible effects as fixed', () => {
    const gradientTree = makeTree([
      makeSnapshot(
        'root',
        {
          id: 'root',
          type: 'FRAME',
          visible: true,
          fills: [],
          strokes: [],
          effects: []
        } as unknown as SceneNode,
        ['child']
      ),
      makeSnapshot('child', {
        id: 'child',
        type: 'RECTANGLE',
        visible: true,
        fills: [{ type: 'GRADIENT_LINEAR', visible: true, gradientStops: [] }],
        strokes: [],
        effects: []
      } as unknown as SceneNode)
    ])

    const effectedTree = makeTree([
      makeSnapshot(
        'root',
        {
          id: 'root',
          type: 'FRAME',
          visible: true,
          fills: [],
          strokes: [],
          effects: []
        } as unknown as SceneNode,
        ['child']
      ),
      makeSnapshot('child', {
        id: 'child',
        type: 'RECTANGLE',
        visible: true,
        fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
        strokes: [],
        effects: [{ type: 'DROP_SHADOW', visible: true }]
      } as unknown as SceneNode)
    ])

    expect(analyzeVectorColorModel(gradientTree, 'root')).toEqual({ kind: 'fixed' })
    expect(analyzeVectorColorModel(effectedTree, 'root')).toEqual({ kind: 'fixed' })
  })

  it('prefers bound variable colors for single-channel vectors', () => {
    vi.stubGlobal('figma', {
      variables: {
        getVariableById: vi.fn((id: string) =>
          id === 'var-color' ? ({ id, name: 'Color / Icon' } as Variable) : null
        )
      }
    })

    const tree = makeTree([
      makeSnapshot('root', {
        id: 'root',
        type: 'RECTANGLE',
        visible: true,
        fills: [
          {
            type: 'SOLID',
            visible: true,
            color: { r: 1, g: 0, b: 0 },
            opacity: 1,
            boundVariables: { color: { id: 'var-color' } }
          }
        ],
        strokes: [],
        effects: []
      } as unknown as SceneNode)
    ])

    expect(analyzeVectorColorModel(tree, 'root')).toEqual({
      kind: 'single-channel',
      color: 'var(--Color---Icon)'
    })
  })

  it('keeps native vector colors when a token consumer has a different mode from its SVG root', () => {
    const root = createSnapshot({ id: 'root', children: ['light', 'dark'] })
    const light = createSnapshot({ id: 'light', type: 'VECTOR', parentId: 'root' })
    const dark = createSnapshot({ id: 'dark', type: 'VECTOR', parentId: 'root' })
    const variable = { id: 'v', name: 'icon' } as Variable
    vi.stubGlobal('figma', {
      variables: { getVariableById: (id: string) => ({ ...variable, id }) }
    })
    for (const snapshot of [light, dark]) {
      Object.assign(snapshot.node, {
        fills: [
          {
            type: 'SOLID',
            color: { r: 1, g: 0, b: 0 },
            boundVariables: { color: { id: 'v', type: 'VARIABLE_ALIAS' } }
          }
        ],
        resolvedVariableModes: { palette: 'light' }
      })
    }
    Object.assign(root.node, { resolvedVariableModes: { palette: 'light' } })
    Object.assign(dark.node, { resolvedVariableModes: { palette: 'dark' } })
    expect(analyzeVectorColorModel(createTree([root, light, dark]), 'root')).toEqual({
      kind: 'fixed'
    })
    Object.assign(dark.node, { resolvedVariableModes: { palette: 'light' } })
    expect(analyzeVectorColorModel(createTree([root, light, dark]), 'root')).toMatchObject({
      kind: 'single-channel'
    })
    Object.assign(dark.node, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0 },
          boundVariables: { color: { id: 'different', type: 'VARIABLE_ALIAS' } }
        }
      ]
    })
    // Identical CSS names do not establish identical variable identity.
    expect(analyzeVectorColorModel(createTree([root, light, dark]), 'root')).toEqual({
      kind: 'fixed'
    })
  })

  it('skips style lookups when multiple visible paints already determine the channel', () => {
    const getStyleById = vi.fn(() => {
      throw new Error('style lookup should be skipped')
    })
    vi.stubGlobal('figma', {
      getStyleById,
      variables: {
        getVariableById: vi.fn()
      }
    })

    const tree = makeTree([
      makeSnapshot('root', {
        id: 'root',
        type: 'RECTANGLE',
        visible: true,
        fillStyleId: 'style-1',
        fills: [
          { type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 },
          { type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 0.4 }
        ],
        strokes: [],
        effects: []
      } as unknown as SceneNode)
    ])

    expect(analyzeVectorColorModel(tree, 'root')).toEqual({
      kind: 'single-channel',
      color: '#000'
    })
    expect(getStyleById).not.toHaveBeenCalled()
  })

  it('normalizes themeable svg content and stabilizes ids', () => {
    const themeable = normalizeThemeableSvg(
      '<svg width="16" height="16"><g fill="#111"><path id="shape" fill="#111" d="M0 0h16v16z"/></g></svg>',
      remConfig,
      {
        width: 16,
        height: 16,
        idPrefix: 'n:1'
      }
    )

    expect(themeable?.props).toEqual({
      height: '1rem',
      viewBox: '0 0 16 16',
      width: '1rem'
    })
    expect(themeable?.content).toContain('fill="currentColor"')
    expect(themeable?.content).toContain('id="tp-n-1-0"')
  })

  it('updates id references when stabilizing themeable svg definitions', () => {
    const themeable = normalizeThemeableSvg(
      '<svg width="16" height="16"><defs><clipPath id="clip"><rect width="8" height="8"/></clipPath></defs><g clip-path="url(#clip)"><path fill="#111" d="M0 0h16v16z"/></g></svg>',
      pxConfig,
      {
        width: 16,
        height: 16,
        idPrefix: 'clip-ref'
      }
    )

    expect(themeable?.content).toContain('id="tp-clip-ref-0"')
    expect(themeable?.content).toContain('clip-path="url(#tp-clip-ref-0)"')
  })

  it('lifts presentation styles before rewriting themeable colors', () => {
    const themeable = normalizeThemeableSvg(
      '<svg width="16" height="16"><path style="fill:#111;display:block" d="M0 0h16v16z"/></svg>',
      pxConfig,
      {
        width: 16,
        height: 16,
        idPrefix: 'style-fill'
      }
    )

    expect(themeable?.content).toContain('fill="currentColor"')
    expect(themeable?.content).toContain('style="display:block"')
  })

  it('does not synthesize currentColor fills for stroke-only shapes that omitted fill', () => {
    const themeable = normalizeThemeableSvg(
      '<svg width="16" height="16"><rect stroke="#111" stroke-width="2" width="12" height="12" x="2" y="2"/></svg>',
      pxConfig,
      {
        width: 16,
        height: 16,
        idPrefix: 'stroke-only'
      }
    )

    expect(themeable?.content).toContain('stroke="currentColor"')
    expect(themeable?.content).not.toContain('fill="currentColor"')
  })

  it('normalizes width and height attributes with configured css units', () => {
    const svg = '<svg width="16" height="32px" preserveAspectRatio="none"></svg>'

    expect(transformSvgAttributes(svg, remConfig)).toBe(
      '<svg width="1rem" height="2rem" preserveAspectRatio="none"></svg>'
    )
  })

  it('extracts svg attributes and handles non-svg inputs', () => {
    expect(extractSvgAttributes("<svg width='12px' height=\"24px\" role='img'></svg>")).toEqual({
      width: '12px',
      height: '24px',
      role: 'img'
    })
    expect(extractSvgAttributes('<div></div>')).toEqual({})
  })
})

function makeSnapshot(id: string, node: SceneNode, children: string[] = []): Snapshot {
  return {
    id,
    type: node.type,
    tag: node.type === 'RECTANGLE' ? 'svg' : 'div',
    name: id,
    visible: true,
    children,
    bounds: { x: 0, y: 0, width: 16, height: 16 },
    renderBounds: null,
    assetKind: node.type === 'RECTANGLE' ? 'vector' : undefined,
    node
  } as Snapshot
}

function makeTree(nodes: Snapshot[]): VisibleTree {
  return {
    rootIds: [nodes[0]?.id ?? 'root'],
    order: nodes.map((node) => node.id),
    stats: { totalNodes: nodes.length, maxDepth: 1, capped: false },
    nodes: new Map(nodes.map((node) => [node.id, node]))
  }
}
