import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

import { ensureAssetUploaded } from '@/mcp/assets'
import { normalizeThemeableSvg } from '@/mcp/tools/code/assets/svg'
import {
  exportSvgEntry,
  extractSvgAttributes,
  transformSvgAttributes
} from '@/mcp/tools/code/assets/vector'
import { isThemeableVector } from '@/mcp/tools/code/assets/vector-semantics'
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
  it('inlines themeable vectors in smart mode without uploading assets', async () => {
    const svg = '<svg viewBox="0 0 16 16"><path fill="#111" d="M0 0h16v16z"/></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      id: '12:34',
      width: 16,
      height: 16,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    const result = await exportSvgEntry(node, remConfig, new Map(), {
      vectorMode: 'smart',
      themeable: true
    })

    expect(result?.props).toEqual({
      height: '1rem',
      viewBox: '0 0 16 16',
      width: '1rem'
    })
    expect(result?.raw).toContain('fill="currentColor"')
    expect(ensureAssetUploaded).not.toHaveBeenCalled()
  })

  it('uploads fixed vectors as assets without extra vector metadata', async () => {
    const svg =
      '<svg width="16" height="16"><path fill="#111" d="M0 0h8v16z"/><path fill="#f00" d="M8 0h8v16z"/></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      id: 'vector-fixed',
      width: 16,
      height: 16,
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
      themeable: false
    })

    expect(result).toEqual({
      props: {
        width: '1rem',
        height: '1rem',
        viewBox: '0 0 16 16',
        'data-asset-url': 'http://assets.test/hash.svg'
      }
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
      size: bytes.byteLength
    }
    vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)

    const registry = new Map<string, unknown>()
    const result = await exportSvgEntry(node, pxConfig, registry as Map<string, never>, {
      vectorMode: 'snapshot',
      themeable: true
    })

    expect(result).toEqual({
      props: {
        width: '20px',
        height: '10px',
        viewBox: '0 0 20 10',
        'data-asset-url': 'http://assets.test/hash.svg'
      }
    })
    expect(registry.get('asset-hash')).toEqual({
      ...asset,
      themeable: true
    })
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
      vectorMode: 'smart'
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
      'Failed to upload vector asset; inlining raw SVG.',
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
      },
      raw: '<svg></svg>'
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

    expect(isThemeableVector(tree, 'root')).toBe(true)
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

    expect(isThemeableVector(tree, 'root')).toBe(true)
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

    expect(isThemeableVector(gradientTree, 'root')).toBe(false)
    expect(isThemeableVector(effectedTree, 'root')).toBe(false)
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
    stats: { totalNodes: nodes.length, maxDepth: 1, capped: false, cappedNodeIds: [] },
    nodes: new Map(nodes.map((node) => [node.id, node]))
  }
}
