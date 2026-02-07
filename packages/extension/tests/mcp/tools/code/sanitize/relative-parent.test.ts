import { describe, expect, it } from 'vitest'

import { ensureRelativeForAbsoluteChildren } from '@/mcp/tools/code/sanitize/relative-parent'

import { createSnapshot, createTree } from '../test-helpers'

describe('mcp/code sanitize relative-parent', () => {
  it('adds position:relative to the nearest layout parent of absolute children', () => {
    const root = createSnapshot({ id: 'root', children: ['group'] })
    const group = createSnapshot({
      id: 'group',
      type: 'GROUP',
      parentId: 'root',
      children: ['child']
    })
    const child = createSnapshot({ id: 'child', parentId: 'group' })
    const tree = createTree([root, group, child])

    const styles = new Map<string, Record<string, string>>([['child', { position: 'absolute' }]])

    ensureRelativeForAbsoluteChildren(tree, styles)

    expect(styles.get('root')).toEqual({ position: 'relative' })
  })

  it('does not overwrite existing parent position and ignores non-absolute children', () => {
    const root = createSnapshot({ id: 'root', children: ['c1', 'c2'] })
    const c1 = createSnapshot({ id: 'c1', parentId: 'root' })
    const c2 = createSnapshot({ id: 'c2', parentId: 'root' })
    const tree = createTree([root, c1, c2])

    const styles = new Map<string, Record<string, string>>([
      ['root', { position: 'sticky' }],
      ['c1', { position: 'absolute' }],
      ['c2', { position: 'relative' }]
    ])

    ensureRelativeForAbsoluteChildren(tree, styles)

    expect(styles.get('root')).toEqual({ position: 'sticky' })
  })
})
