import { describe, expect, it } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

import { planAssets } from '@/mcp/tools/code/assets/plan'

function node(
  id: string,
  children: string[] = [],
  assetKind?: 'vector' | 'image'
): Record<string, unknown> {
  return {
    id,
    children,
    assetKind
  }
}

describe('mcp/code/assets plan', () => {
  it('marks pure vector groups as roots and skips all descendants', () => {
    const tree = {
      order: ['group', 'v1', 'child-group', 'v2', 'standalone-vector', 'missing-node'],
      nodes: new Map([
        ['group', node('group', ['v1', 'child-group'])],
        ['v1', node('v1', [], 'vector')],
        ['child-group', node('child-group', ['v2', 'v2'])],
        ['v2', node('v2', [], 'vector')],
        ['standalone-vector', node('standalone-vector', [], 'vector')]
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
        ['mixed', node('mixed', ['mv', 'mi'])],
        ['mv', node('mv', [], 'vector')],
        ['mi', node('mi', [], 'image')],
        ['single', node('single', ['sv'])],
        ['sv', node('sv', [], 'vector')]
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
        ['broken-parent', node('broken-parent', ['leaf', 'ghost-child'])],
        ['leaf', node('leaf', [], 'vector')]
      ])
    } as unknown as VisibleTree

    const result = planAssets(tree)

    expect(result.vectorRoots).toEqual(new Set(['leaf']))
    expect(result.skippedIds).toEqual(new Set())
  })

  it('keeps traversal defensive when descendants disappear during skipping', () => {
    const rawNodes = new Map([
      ['group', node('group', ['left', 'right'])],
      ['left', node('left', [], 'vector')],
      ['right', node('right', ['volatile'])],
      ['volatile', node('volatile', [], 'vector')]
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
})
