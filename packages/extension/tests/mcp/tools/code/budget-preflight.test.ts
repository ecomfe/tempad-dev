import { describe, expect, it } from 'vitest'

import { preflightGetCodeBudget } from '@/mcp/tools/code/budget-preflight'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

describe('get_code budget preflight', () => {
  it('proves an oversized UTF-8 text shell before scanning the remaining large tree', () => {
    const root = createSnapshot({ id: 'root', children: ['copy'] })
    const copy = createSnapshot({ id: 'copy', type: 'TEXT', parentId: 'root' })
    copy.node = textNode('文'.repeat(22_000))
    const trailing = Array.from({ length: 10_000 }, (_, index) =>
      createSnapshot({ id: `trailing-${index}`, parentId: 'root' })
    )
    const tree = createTree([root, copy, ...trailing])

    expect(
      preflightGetCodeBudget(tree, 'root', {
        maxResultBytes: 64 * 1024,
        pluginEnabled: false,
        unbounded: false
      })
    ).toEqual({
      kind: 'shell',
      scannedDescendants: 1
    })
  })

  it('accumulates smaller text nodes and keeps full mode while they fit', () => {
    const root = createSnapshot({ id: 'root', children: ['a', 'b'] })
    const first = createSnapshot({ id: 'a', type: 'TEXT', parentId: 'root' })
    first.node = textNode('hello')
    const second = createSnapshot({ id: 'b', type: 'TEXT', parentId: 'root' })
    second.node = textNode('world')

    expect(
      preflightGetCodeBudget(createTree([root, first, second]), 'root', {
        maxResultBytes: 100,
        pluginEnabled: false,
        unbounded: false
      })
    ).toEqual({ kind: 'full' })
  })

  it('preserves full processing for plugins, unbounded calls, text roots, and vector roots', () => {
    const root = createSnapshot({ id: 'root', children: ['copy'] })
    const copy = createSnapshot({ id: 'copy', type: 'TEXT', parentId: 'root' })
    copy.node = textNode('x'.repeat(100))
    const tree = createTree([root, copy])
    const baseOptions = { maxResultBytes: 1, pluginEnabled: false, unbounded: false }

    expect(preflightGetCodeBudget(tree, 'root', { ...baseOptions, pluginEnabled: true }).kind).toBe(
      'full'
    )
    expect(preflightGetCodeBudget(tree, 'root', { ...baseOptions, unbounded: true }).kind).toBe(
      'full'
    )

    root.node = textNode('root')
    expect(preflightGetCodeBudget(tree, 'root', baseOptions).kind).toBe('full')
    root.node = { id: 'root', type: 'FRAME', visible: true } as unknown as SceneNode
    root.assetKind = 'vector'
    expect(preflightGetCodeBudget(tree, 'root', baseOptions).kind).toBe('full')
  })
})

function textNode(characters: string): TextNode {
  return { characters, id: 'text', type: 'TEXT', visible: true } as unknown as TextNode
}
