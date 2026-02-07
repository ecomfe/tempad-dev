import { describe, expect, it } from 'vitest'

import { applyAbsoluteStackingOrder } from '@/mcp/tools/code/sanitize/stacking'

import { createSnapshot, createTree } from '../test-helpers'

describe('mcp/code sanitize stacking', () => {
  it('pushes absolute children behind later in-flow siblings and isolates parent', () => {
    const root = createSnapshot({ id: 'root', children: ['a1', 'flow'] })
    const a1 = createSnapshot({ id: 'a1', parentId: 'root' })
    const flow = createSnapshot({ id: 'flow', parentId: 'root' })
    const tree = createTree([root, a1, flow])

    const styles = new Map<string, Record<string, string>>([
      ['a1', { position: 'absolute' }],
      ['flow', { position: 'relative' }]
    ])

    applyAbsoluteStackingOrder(tree, styles)

    expect(styles.get('a1')).toEqual({ position: 'absolute', 'z-index': '-1' })
    expect(styles.get('root')).toEqual({ isolation: 'isolate' })
  })

  it('keeps existing z-index and skips isolation when later siblings are also absolute', () => {
    const root = createSnapshot({ id: 'root', children: ['a1', 'a2'] })
    const a1 = createSnapshot({ id: 'a1', parentId: 'root' })
    const a2 = createSnapshot({ id: 'a2', parentId: 'root' })
    const tree = createTree([root, a1, a2])

    const styles = new Map<string, Record<string, string>>([
      ['a1', { position: 'absolute', 'z-index': '9' }],
      ['a2', { position: 'absolute' }]
    ])

    applyAbsoluteStackingOrder(tree, styles)

    expect(styles.get('a1')).toEqual({ position: 'absolute', 'z-index': '9' })
    expect(styles.get('root')).toBeUndefined()
  })

  it('handles missing roots, leaf roots, and keeps existing z-index/isolation', () => {
    const root = createSnapshot({ id: 'root', children: ['a1', 'flow'] })
    const a1 = createSnapshot({ id: 'a1', parentId: 'root' })
    const flow = createSnapshot({ id: 'flow', parentId: 'root' })
    const leaf = createSnapshot({ id: 'leaf' })
    ;(leaf as unknown as { children?: string[] }).children = undefined
    const tree = createTree([root, a1, flow, leaf])
    tree.rootIds.push('missing-root')

    const styles = new Map<string, Record<string, string>>([
      ['root', { isolation: 'isolate' }],
      ['a1', { position: 'absolute', 'z-index': '3' }],
      ['flow', { position: 'relative' }]
    ])

    applyAbsoluteStackingOrder(tree, styles)

    expect(styles.get('a1')).toEqual({ position: 'absolute', 'z-index': '3' })
    expect(styles.get('root')).toEqual({ isolation: 'isolate' })
  })
})
