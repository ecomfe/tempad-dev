import { describe, expect, it } from 'vitest'

import { getLayoutParent } from '@/mcp/tools/code/layout-parent'

import { createSnapshot, createTree } from './test-helpers'

describe('mcp/code layout-parent', () => {
  it('skips GROUP and BOOLEAN_OPERATION when resolving layout parent', () => {
    const root = createSnapshot({ id: 'root', type: 'FRAME', children: ['group'] })
    const group = createSnapshot({
      id: 'group',
      type: 'GROUP',
      parentId: 'root',
      children: ['boolean']
    })
    const boolean = createSnapshot({
      id: 'boolean',
      type: 'BOOLEAN_OPERATION',
      parentId: 'group',
      children: ['child']
    })
    const child = createSnapshot({ id: 'child', type: 'RECTANGLE', parentId: 'boolean' })
    const tree = createTree([root, group, boolean, child])

    expect(getLayoutParent(tree, child)?.id).toBe('root')
  })

  it('returns undefined when parent cannot be found or when node is root', () => {
    const orphan = createSnapshot({ id: 'orphan', parentId: 'missing' })
    const root = createSnapshot({ id: 'root' })
    const tree = createTree([orphan, root])

    expect(getLayoutParent(tree, orphan)).toBeUndefined()
    expect(getLayoutParent(tree, root)).toBeUndefined()
  })

  it('keeps freeform 3D groups as layout boxes for rebased descendant offsets', () => {
    const root = createSnapshot({ id: 'root', children: ['group'] })
    const group = createSnapshot({
      id: 'group',
      type: 'GROUP',
      parentId: 'root',
      children: ['nested']
    })
    const nested = createSnapshot({
      id: 'nested',
      type: 'GROUP',
      parentId: 'group',
      children: ['child']
    })
    const child = createSnapshot({ id: 'child', parentId: 'nested' })
    Object.assign(group.node, {
      transform3d: { type: 'FIXED_ORDER', translateZ: 40, rotateX: 0, rotateY: 30, rotateZ: 0 }
    })
    const tree = createTree([root, group, nested, child])
    expect(getLayoutParent(tree, child)?.id).toBe('nested')
    expect(getLayoutParent(tree, nested)?.id).toBe('group')
    expect(getLayoutParent(tree, group)?.id).toBe('root')
  })
})
