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
})
