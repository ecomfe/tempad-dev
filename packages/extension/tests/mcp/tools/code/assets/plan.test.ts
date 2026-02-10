import { describe, expect, it } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

import { planAssets } from '@/mcp/tools/code/assets/plan'

type NodeOptions = {
  children?: string[]
  assetKind?: 'vector' | 'image'
  type?: SceneNode['type']
  isMask?: boolean
}

function node(
  id: string,
  { children = [], assetKind, type = 'GROUP', isMask = false }: NodeOptions = {}
): Record<string, unknown> {
  return {
    id,
    children,
    assetKind,
    type,
    node: { isMask }
  }
}

describe('mcp/code/assets plan', () => {
  it('marks pure vector groups as roots and skips all descendants', () => {
    const tree = {
      order: ['group', 'v1', 'child-group', 'v2', 'standalone-vector', 'missing-node'],
      nodes: new Map([
        ['group', node('group', { children: ['v1', 'child-group'], type: 'GROUP' })],
        ['v1', node('v1', { assetKind: 'vector', type: 'VECTOR' })],
        ['child-group', node('child-group', { children: ['v2', 'v2'], type: 'GROUP' })],
        ['v2', node('v2', { assetKind: 'vector', type: 'VECTOR' })],
        ['standalone-vector', node('standalone-vector', { assetKind: 'vector', type: 'VECTOR' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['group', 'standalone-vector']))
    expect(result.skippedIds).toEqual(new Set(['v1', 'child-group', 'v2']))
  })

  it('does not treat mixed or single-leaf groups as vector groups', () => {
    const tree = {
      order: ['mixed', 'mv', 'mi', 'single', 'sv'],
      nodes: new Map([
        ['mixed', node('mixed', { children: ['mv', 'mi'], type: 'GROUP' })],
        ['mv', node('mv', { assetKind: 'vector', type: 'VECTOR' })],
        ['mi', node('mi', { assetKind: 'image', type: 'RECTANGLE' })],
        ['single', node('single', { children: ['sv'], type: 'GROUP' })],
        ['sv', node('sv', { assetKind: 'vector', type: 'VECTOR' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['mv', 'sv']))
    expect(result.skippedIds).toEqual(new Set())
  })

  it('handles missing child metadata without promoting the parent group', () => {
    const tree = {
      order: ['broken-parent', 'leaf'],
      nodes: new Map([
        [
          'broken-parent',
          node('broken-parent', { children: ['leaf', 'ghost-child'], type: 'GROUP' })
        ],
        ['leaf', node('leaf', { assetKind: 'vector', type: 'VECTOR' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['leaf']))
    expect(result.skippedIds).toEqual(new Set())
  })

  it('keeps traversal defensive when descendants disappear during skipping', () => {
    const rawNodes = new Map([
      ['group', node('group', { children: ['left', 'right'], type: 'GROUP' })],
      ['left', node('left', { assetKind: 'vector', type: 'VECTOR' })],
      ['right', node('right', { children: ['volatile'], type: 'GROUP' })],
      ['volatile', node('volatile', { assetKind: 'vector', type: 'VECTOR' })]
    ])

    const accesses = new Map<string, number>()
    const flakyNodes = {
      get(id: string) {
        const next = (accesses.get(id) ?? 0) + 1
        accesses.set(id, next)

        if (id === 'volatile' && next >= 2) {
          return undefined
        }

        return rawNodes.get(id)
      }
    } as unknown as VisibleTree['nodes']

    const tree = {
      order: ['group', 'left', 'right', 'volatile'],
      nodes: flakyNodes
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['group']))
    expect(result.skippedIds).toEqual(new Set(['left', 'right']))
  })

  it('promotes GROUP with mask and vector-only non-mask descendants', () => {
    const tree = {
      order: ['group', 'mask', 'content-group', 'v1'],
      nodes: new Map([
        ['group', node('group', { children: ['mask', 'content-group'], type: 'GROUP' })],
        ['mask', node('mask', { type: 'RECTANGLE', isMask: true })],
        ['content-group', node('content-group', { children: ['v1'], type: 'GROUP' })],
        ['v1', node('v1', { assetKind: 'vector', type: 'VECTOR' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['group']))
    expect(result.skippedIds).toEqual(new Set(['mask', 'content-group', 'v1']))
  })

  it('promotes FRAME with mask and vector-like non-mask descendants', () => {
    const tree = {
      order: ['frame', 'mask', 'line'],
      nodes: new Map([
        ['frame', node('frame', { children: ['mask', 'line'], type: 'FRAME' })],
        ['mask', node('mask', { type: 'RECTANGLE', isMask: true })],
        ['line', node('line', { type: 'LINE' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['frame']))
    expect(result.skippedIds).toEqual(new Set(['mask', 'line']))
  })

  it('does not promote INSTANCE even when non-mask descendants are vector-like', () => {
    const tree = {
      order: ['instance', 'mask', 'vector'],
      nodes: new Map([
        ['instance', node('instance', { children: ['mask', 'vector'], type: 'INSTANCE' })],
        ['mask', node('mask', { type: 'RECTANGLE', isMask: true })],
        ['vector', node('vector', { assetKind: 'vector', type: 'VECTOR' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['vector']))
    expect(result.skippedIds).toEqual(new Set())
  })

  it('does not promote mask groups that contain non-vector non-mask descendants', () => {
    const tree = {
      order: ['group', 'mask', 'text'],
      nodes: new Map([
        ['group', node('group', { children: ['mask', 'text'], type: 'GROUP' })],
        ['mask', node('mask', { type: 'RECTANGLE', isMask: true })],
        ['text', node('text', { type: 'TEXT' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set())
    expect(result.skippedIds).toEqual(new Set())
  })

  it('promotes geometry-only GROUP/FRAME without masks as vector-like containers', () => {
    const tree = {
      order: ['group', 'rect', 'line', 'frame', 'ellipse', 'polygon'],
      nodes: new Map([
        ['group', node('group', { children: ['rect', 'line'], type: 'GROUP' })],
        ['rect', node('rect', { type: 'RECTANGLE' })],
        ['line', node('line', { type: 'LINE' })],
        ['frame', node('frame', { children: ['ellipse', 'polygon'], type: 'FRAME' })],
        ['ellipse', node('ellipse', { type: 'ELLIPSE' })],
        ['polygon', node('polygon', { type: 'POLYGON' })]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['group', 'frame']))
    expect(result.skippedIds).toEqual(new Set(['rect', 'line', 'ellipse', 'polygon']))
  })
})
