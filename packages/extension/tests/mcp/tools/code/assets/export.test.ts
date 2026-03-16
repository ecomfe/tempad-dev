import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

import { exportVectorAssets } from '@/mcp/tools/code/assets/export'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'

vi.mock('@/mcp/tools/code/assets/vector', () => ({
  exportSvgEntry: vi.fn()
}))

function makeSnapshot(
  id: string,
  bounds: { width: number; height: number },
  renderBounds: { width: number; height: number } | null = null,
  node: Record<string, unknown> = {}
): VisibleTree['nodes'] extends Map<string, infer T> ? T : never {
  return {
    id,
    type: 'FRAME',
    tag: 'div',
    name: id,
    visible: true,
    children: [],
    bounds: { x: 0, y: 0, ...bounds },
    renderBounds: renderBounds ? { x: 0, y: 0, ...renderBounds } : renderBounds,
    node: { id, ...node } as unknown as SceneNode
  } as VisibleTree['nodes'] extends Map<string, infer T> ? T : never
}

const config = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
} as const

describe('assets/export exportVectorAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exports vector roots and skips missing or zero-sized snapshots without render bounds', async () => {
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false, cappedNodeIds: [] },
      nodes: new Map([
        ['vector-ok', makeSnapshot('vector-ok', { width: 10, height: 20 })],
        ['zero-no-render', makeSnapshot('zero-no-render', { width: 0, height: 0 }, null)],
        [
          'zero-with-render',
          makeSnapshot('zero-with-render', { width: 0, height: 0 }, { width: 1, height: 1 })
        ]
      ])
    } as unknown as VisibleTree

    vi.mocked(exportSvgEntry)
      .mockResolvedValueOnce({ props: { width: '10px' } })
      .mockResolvedValueOnce({ props: { width: '1px' } })

    const result = await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['missing', 'zero-no-render', 'vector-ok', 'zero-with-render']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'smart'
    )

    expect(Array.from(result.keys())).toEqual(['vector-ok', 'zero-with-render'])
    expect(result.get('vector-ok')).toEqual({ props: { width: '10px' } })
    expect(result.get('zero-with-render')).toEqual({ props: { width: '1px' } })
    expect(exportSvgEntry).toHaveBeenCalledTimes(2)
  })

  it('omits entries when svg export returns null', async () => {
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false, cappedNodeIds: [] },
      nodes: new Map([['vector-null', makeSnapshot('vector-null', { width: 2, height: 3 })]])
    } as unknown as VisibleTree

    vi.mocked(exportSvgEntry).mockResolvedValueOnce(null)

    const result = await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['vector-null']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'snapshot'
    )

    expect(result).toEqual(new Map())
    expect(exportSvgEntry).toHaveBeenCalledTimes(1)
  })

  it('reuses style and variable lookups across vector roots', async () => {
    const getStyleById = vi.fn(() => ({
      paints: [
        {
          type: 'SOLID',
          visible: true,
          color: { r: 1, g: 0, b: 0 },
          boundVariables: { color: { id: 'var-1' } }
        }
      ]
    }))
    const getVariableById = vi.fn((id: string) =>
      id === 'var-1'
        ? ({
            id,
            name: 'Color / Icon'
          } as Variable)
        : null
    )
    vi.stubGlobal('figma', {
      getStyleById,
      variables: { getVariableById }
    })

    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false, cappedNodeIds: [] },
      nodes: new Map([
        [
          'vector-a',
          makeSnapshot('vector-a', { width: 16, height: 16 }, null, {
            fillStyleId: 'style-1',
            fills: [
              {
                type: 'SOLID',
                visible: true,
                color: { r: 1, g: 0, b: 0 },
                boundVariables: { color: { id: 'var-1' } }
              }
            ],
            strokes: [],
            effects: []
          })
        ],
        [
          'vector-b',
          makeSnapshot('vector-b', { width: 16, height: 16 }, null, {
            fillStyleId: 'style-1',
            fills: [
              {
                type: 'SOLID',
                visible: true,
                color: { r: 1, g: 0, b: 0 },
                boundVariables: { color: { id: 'var-1' } }
              }
            ],
            strokes: [],
            effects: []
          })
        ]
      ])
    } as unknown as VisibleTree

    vi.mocked(exportSvgEntry).mockResolvedValue(null)

    const variableCache = new Map<string, Variable | null>()
    await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['vector-a', 'vector-b']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'smart',
      variableCache
    )

    expect(getStyleById).toHaveBeenCalledTimes(1)
    expect(getVariableById).toHaveBeenCalledTimes(1)
    expect(variableCache.get('var-1')).toEqual({
      id: 'var-1',
      name: 'Color / Icon'
    })
    expect(exportSvgEntry).toHaveBeenCalledTimes(2)
  })
})
