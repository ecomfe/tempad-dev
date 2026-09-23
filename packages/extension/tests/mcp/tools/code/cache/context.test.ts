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
import { collectCandidateVariableIds } from '@/mcp/tools/token/candidates'
import { TEXT_VARIABLE_FIELDS } from '@/utils/figma-variables'
import { formatNodeStyleForMcp } from '@/utils/variable-output'

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

  it('extracts inferred-layout semantics once per node across repeated pipeline reads', () => {
    const ctx = createGetCodeCacheContext(new Map(), { metrics: true })
    const nodes = Array.from(
      { length: 12 },
      (_, index) =>
        ({
          id: `layout-${index}`,
          type: 'FRAME',
          visible: true,
          inferredAutoLayout: { layoutMode: index % 2 ? 'VERTICAL' : 'HORIZONTAL' }
        }) as unknown as SceneNode
    )

    nodes.forEach((node) => getNodeSemanticsCached(node, ctx))
    nodes.forEach((node) => getNodeSemanticsCached(node, ctx))

    expect(ctx.metrics).toMatchObject({
      nodeSemanticHits: nodes.length,
      nodeSemanticMisses: nodes.length
    })
  })

  it('reuses text range bindings between candidate scanning and style formatting within one call', () => {
    vi.stubGlobal('__DEV__', false)
    const getRangeBoundVariable = vi.fn(
      (_start: number, _end: number, field: VariableBindableTextField) =>
        field === 'fontSize' ? { id: 'size' } : null
    )
    const getVariableById = vi.fn((id: string) =>
      id === 'size' ? ({ id, name: 'Font Size' } as Variable) : null
    )
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      getStyleById: vi.fn(() => null),
      variables: { getVariableById }
    })
    const node = {
      id: 'text',
      type: 'TEXT',
      visible: true,
      characters: 'Text',
      fills: [],
      strokes: [],
      effects: [],
      getRangeBoundVariable
    } as unknown as TextNode
    const ctx = createGetCodeCacheContext(new Map(), { metrics: true })

    let nodeVariableIds: ReadonlySet<string> | undefined
    const mappings = collectCandidateVariableIds([node], ctx.variables, ctx.readers, {
      onNodeVariableIds: (_id, ids) => {
        nodeVariableIds = ids
      }
    })
    const style = formatNodeStyleForMcp({ 'font-size': '12px' }, node, ctx.readers, nodeVariableIds)

    expect(mappings.variableIds).toEqual(new Set(['size']))
    expect(style['font-size']).toBe('var(--Font-Size)')
    expect(getRangeBoundVariable).toHaveBeenCalledTimes(TEXT_VARIABLE_FIELDS.length)
    expect(ctx.metrics).toMatchObject({
      textRangeHits: 1,
      textRangeMisses: TEXT_VARIABLE_FIELDS.length
    })

    const nextCtx = createGetCodeCacheContext()
    collectCandidateVariableIds([node], nextCtx.variables, nextCtx.readers)
    expect(getRangeBoundVariable).toHaveBeenCalledTimes(TEXT_VARIABLE_FIELDS.length * 2)
  })

  it('keeps null and mixed bindings distinct across text nodes, ranges, and fields', () => {
    const mixed = Symbol('mixed') as typeof figma.mixed
    const alias = { type: 'VARIABLE_ALIAS' as const, id: 'size' }
    const getRangeBoundVariable = vi.fn(
      (_start: number, end: number, field: VariableBindableTextField) =>
        field === 'fontFamily' ? null : end === 5 ? mixed : alias
    )
    const first = { getRangeBoundVariable } as unknown as TextNode
    const second = { getRangeBoundVariable } as unknown as TextNode
    const read = createGetCodeCacheContext().readers.getRangeBoundVariable!

    for (let repeat = 0; repeat < 2; repeat += 1) {
      expect(read(first, 0, 5, 'fontSize')).toBe(mixed)
      expect(read(first, 0, 5, 'fontFamily')).toBeNull()
      expect(read(first, 0, 2, 'fontSize')).toBe(alias)
      expect(read(first, 1, 2, 'fontSize')).toBe(alias)
      expect(read(second, 0, 5, 'fontSize')).toBe(mixed)
    }
    expect(getRangeBoundVariable).toHaveBeenCalledTimes(5)
  })

  it('does not cache a failed text binding read', () => {
    const error = new Error('Binding temporarily unavailable')
    const alias = { type: 'VARIABLE_ALIAS' as const, id: 'size' }
    const getRangeBoundVariable = vi
      .fn()
      .mockImplementationOnce(() => {
        throw error
      })
      .mockReturnValue(alias)
    const node = { getRangeBoundVariable } as unknown as TextNode
    const read = createGetCodeCacheContext().readers.getRangeBoundVariable!

    expect(() => read(node, 0, 5, 'fontSize')).toThrow(error)
    expect(read(node, 0, 5, 'fontSize')).toBe(alias)
    expect(read(node, 0, 5, 'fontSize')).toBe(alias)
    expect(getRangeBoundVariable).toHaveBeenCalledTimes(2)
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
      stats: { totalNodes: 1, maxDepth: 0, capped: false },
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
