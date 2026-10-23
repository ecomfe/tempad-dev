import { describe, expect, it } from 'vitest'

import { walkRemovalOwnershipNodes } from '@/mcp/tools/canvas/reconcile/removals'
import { createApplyState } from '@/mcp/tools/canvas/reconcile/state'
import { walkAuthoringNodes, walkPhysicalNodes } from '@/mcp/tools/canvas/traversal'

function leaf(id: string): SceneNode {
  return { id, type: 'RECTANGLE' } as SceneNode
}

describe.each([
  ['authoring', walkAuthoringNodes],
  ['physical', walkPhysicalNodes],
  [
    'removal ownership',
    (roots: Iterable<SceneNode>) =>
      walkRemovalOwnershipNodes(roots, createApplyState(null, new Set()))
  ]
] as const)('canvas %s traversal', (_name, walk) => {
  it('retains reverse depth-first order through a wide native container', () => {
    const children = Array.from({ length: 150_000 }, (_, index) => leaf(String(index)))
    const root = {
      id: 'root',
      type: 'FRAME',
      children,
      getSharedPluginData: () => ''
    } as unknown as SceneNode
    const visited = Array.from(walk([leaf('first'), root]), (node) => node.id)

    expect(visited).toEqual(['root', ...children.map((node) => node.id).reverse(), 'first'])
  })
})

it('keeps instance descendants outside authoring traversal but inside physical traversal', () => {
  const child = leaf('definition-child')
  const instance = { id: 'instance', type: 'INSTANCE', children: [child] } as unknown as SceneNode
  const root = {
    id: 'root',
    type: 'FRAME',
    children: [leaf('sibling'), instance]
  } as unknown as SceneNode

  expect(Array.from(walkAuthoringNodes([root]), (node) => node.id)).toEqual([
    'root',
    'instance',
    'sibling'
  ])
  expect(Array.from(walkPhysicalNodes([root]), (node) => node.id)).toEqual([
    'root',
    'instance',
    'definition-child',
    'sibling'
  ])
})
