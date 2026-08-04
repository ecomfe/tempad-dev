import { describe, expect, it } from 'vitest'

import {
  buildSemanticTree,
  semanticTreeToOutline,
  suggestDepthLimit,
  type SemanticNode
} from '@/mcp/semantic-tree'

function first<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('Expected a non-empty array')
  return item
}

function createNode(
  type: SceneNode['type'],
  id: string,
  overrides: Record<string, unknown> = {},
  children?: SceneNode[]
): SceneNode {
  const base: Record<string, unknown> = {
    id,
    name: id,
    type,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides
  }

  if (children) {
    base.children = children
  }

  return base as unknown as SceneNode
}

describe('mcp/semantic-tree', () => {
  it('suggestDepthLimit returns undefined for small trees and a depth for oversized trees', () => {
    const smallRoots = [createNode('FRAME', 'r1')]
    expect(suggestDepthLimit(smallRoots)).toBeUndefined()

    const oversizedRoots = Array.from({ length: 2050 }, (_, idx) => createNode('FRAME', `n-${idx}`))
    expect(suggestDepthLimit(oversizedRoots)).toBe(0)
  })

  it('buildSemanticTree flattens wrappers and keeps semantic hints', () => {
    const text = createNode('TEXT', 'text-1', { characters: 'line1\nline2' })

    const instance = createNode(
      'INSTANCE',
      'instance-1',
      {
        layoutMode: 'HORIZONTAL',
        itemSpacing: 8,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'MIN',
        paddingTop: 4,
        paddingRight: 6,
        paddingBottom: 8,
        paddingLeft: 10,
        mainComponent: {
          name: 'Button',
          parent: {
            type: 'COMPONENT_SET',
            name: 'Button Group'
          }
        },
        componentProperties: {
          Size: { type: 'VARIANT', value: 'Large' },
          disabled: { type: 'BOOLEAN', value: false },
          text: { type: 'TEXT', value: 'Submit' },
          swap: { type: 'INSTANCE_SWAP', value: 'ignored' }
        }
      },
      [text]
    )

    const wrapper = createNode('FRAME', 'wrapper-1', {}, [instance])
    const tree = buildSemanticTree([wrapper])

    expect(tree.stats.totalNodes).toBe(2)
    expect(tree.roots).toHaveLength(1)
    const treeRoot = first(tree.roots)
    expect(treeRoot.id).toBe('instance-1')
    expect(treeRoot.depth).toBe(0)
    expect(treeRoot.tag).toBe('div')
    expect(treeRoot.dataHint).toBeDefined()
    expect(treeRoot.dataHint?.['data-hint-design-component']).toContain('ButtonGroup')
    expect(treeRoot.dataHint?.['data-hint-design-component']).toContain('[Size=Large]')
    expect(treeRoot.dataHint?.['data-hint-design-component']).toContain('[disabled=off]')
    expect(treeRoot.dataHint?.['data-hint-design-component']).toContain('[text=Submit]')
    expect(treeRoot.dataHint?.['data-hint-auto-layout']).toBeUndefined()
    expect(treeRoot.autoLayout).toEqual({
      direction: 'row',
      gap: 8,
      alignPrimary: 'CENTER',
      alignCounter: 'MIN',
      padding: { top: 4, right: 6, bottom: 8, left: 10 }
    })

    expect(treeRoot.children).toHaveLength(1)
    const treeChild = first(treeRoot.children)
    expect(treeChild.id).toBe('text-1')
    expect(treeChild.tag).toBe('p')
    expect(treeChild.layout).toBe('absolute')
  })

  it('adds inferred auto-layout hint when inferred metadata exists without explicit layout mode', () => {
    const root = createNode('FRAME', 'root-inferred', {
      layoutMode: 'NONE',
      inferredAutoLayout: {
        layoutMode: 'NONE'
      }
    })

    const tree = buildSemanticTree([root])
    const treeRoot = first(tree.roots)

    expect(treeRoot.dataHint?.['data-hint-auto-layout']).toBe('inferred')
    expect(treeRoot.autoLayout).toBeUndefined()
  })

  it('classifies a video-filled rectangle as a media asset', () => {
    const video = createNode('RECTANGLE', 'video-1', {
      fills: [{ type: 'VIDEO', videoHash: 'video-hash', visible: true }]
    })

    const node = first(buildSemanticTree([video]).roots)

    expect(node.tag).toBe('img')
    expect(node.isAsset).toBe(true)
    expect(node.assetKind).toBe('image')
  })

  it('caps nodes at depth limit and reports capped ids', () => {
    const visibleFill = [
      {
        type: 'SOLID',
        visible: true,
        color: { r: 1, g: 0, b: 0 },
        opacity: 1
      }
    ] as unknown as Paint[]

    const leaf = createNode('FRAME', 'leaf-1', { fills: visibleFill })
    const child = createNode('FRAME', 'child-1', { fills: visibleFill }, [leaf])
    const root = createNode('FRAME', 'root-1', { fills: visibleFill }, [child])

    const tree = buildSemanticTree([root], { depthLimit: 1 })

    expect(tree.stats.capped).toBe(true)
    expect(tree.cappedNodeIds).toContain('child-1')

    const cappedChild = first(first(tree.roots).children)
    expect(cappedChild.id).toBe('child-1')
    expect(cappedChild.capped).toBe(true)
    expect(cappedChild.children).toEqual([])
  })

  it('converts semantic tree nodes into outline nodes recursively', () => {
    const semanticNodes: SemanticNode[] = [
      {
        id: 'a',
        name: 'A',
        type: 'FRAME',
        tag: 'div',
        depth: 0,
        index: 0,
        layout: 'absolute',
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        isComponentInstance: false,
        isAsset: false,
        children: [
          {
            id: 'b',
            name: 'B',
            type: 'TEXT',
            tag: 'span',
            depth: 1,
            index: 0,
            layout: 'absolute',
            bounds: { x: 10, y: 20, width: 30, height: 40 },
            isComponentInstance: false,
            isAsset: false,
            children: []
          }
        ]
      }
    ]

    expect(semanticTreeToOutline(semanticNodes)).toEqual([
      {
        id: 'a',
        name: 'A',
        type: 'FRAME',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        children: [
          {
            id: 'b',
            name: 'B',
            type: 'TEXT',
            x: 10,
            y: 20,
            width: 30,
            height: 40
          }
        ]
      }
    ])
  })
})
