import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

vi.mock('@/mcp/tools/token/indexer', () => ({
  getVariableRawName: (variable: Variable) => variable.name
}))

vi.mock('@/mcp/tools/token/raw-name', () => ({
  getVariableRawName: (variable: Variable) => variable.name
}))

import { analyzeVectorColorModel } from '@/mcp/tools/code/assets/vector-semantics'
import { createGetCodeCacheContext, getNodeSemanticsCached } from '@/mcp/tools/code/cache'
import { cleanFigmaSpecificStyles } from '@/mcp/tools/code/styles/background'

describe('code cache context', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('caches node semantics per node id and records hit/miss metrics', () => {
    const ctx = createGetCodeCacheContext(new Map(), { metrics: true })
    const node = {
      id: 'mixed-node',
      type: 'RECTANGLE',
      visible: true,
      fills: Symbol('mixed'),
      effects: [],
      strokeWeight: 1
    } as unknown as SceneNode

    const first = getNodeSemanticsCached(node, ctx)
    const second = getNodeSemanticsCached(node, ctx)

    expect(first).toBe(second)
    expect(first.paint.fillsState).toMatchObject({ kind: 'unsupported' })
    expect(first.paint.strokesState).toEqual({ kind: 'missing' })
    expect(ctx.metrics).toMatchObject({
      nodeSemanticHits: 1,
      nodeSemanticMisses: 1
    })
  })

  it('dedupes style and variable lookups across style cleanup and vector analysis', () => {
    const getStyleById = vi.fn((id: string) =>
      id === 'style-fill'
        ? ({
            paints: [
              {
                type: 'SOLID',
                visible: true,
                color: { r: 1, g: 0, b: 0 },
                opacity: 1,
                boundVariables: { color: { id: 'var-fill' } }
              }
            ]
          } as unknown as PaintStyle)
        : null
    )
    const getVariableById = vi.fn((id: string) =>
      id === 'var-fill' ? ({ id, name: 'Color / Icon' } as Variable) : null
    )

    vi.stubGlobal('figma', {
      getStyleById,
      variables: {
        getVariableById
      }
    })

    const node = {
      id: 'root',
      type: 'RECTANGLE',
      visible: true,
      width: 16,
      height: 16,
      fillStyleId: 'style-fill',
      fills: [
        {
          type: 'SOLID',
          visible: true,
          color: { r: 1, g: 0, b: 0 },
          opacity: 1,
          boundVariables: { color: { id: 'var-fill' } }
        }
      ],
      strokes: [],
      effects: []
    } as unknown as SceneNode

    const tree = {
      rootIds: ['root'],
      order: ['root'],
      stats: { totalNodes: 1, maxDepth: 0, capped: false, cappedNodeIds: [] },
      nodes: new Map([
        [
          'root',
          {
            id: 'root',
            type: 'RECTANGLE',
            tag: 'div',
            name: 'root',
            visible: true,
            assetKind: 'vector',
            children: [],
            bounds: { x: 0, y: 0, width: 16, height: 16 },
            renderBounds: null,
            node
          }
        ]
      ])
    } as unknown as VisibleTree
    const ctx = createGetCodeCacheContext(new Map(), { metrics: true })

    const cleaned = cleanFigmaSpecificStyles({}, node, ctx)
    const colorModel = analyzeVectorColorModel(tree, 'root', ctx)

    expect(cleaned['background-color']).toMatch(/^var\(/)
    expect(cleaned['background-color']).not.toContain(',')
    expect(colorModel).toEqual({
      kind: 'single-channel',
      color: expect.stringMatching(/^var\(/)
    })
    expect(getStyleById).toHaveBeenCalledTimes(1)
    expect(getVariableById).toHaveBeenCalledTimes(1)
    expect(ctx.metrics).toMatchObject({
      styleMisses: 1,
      variableMisses: 1
    })
    expect((ctx.metrics?.styleHits ?? 0) + (ctx.metrics?.variableHits ?? 0)).toBeGreaterThan(0)
  })
})
