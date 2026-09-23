import { describe, expect, it } from 'vitest'

import {
  buildBoundedStructureOutline,
  classifySemanticAsset,
  resolveSemanticTag,
  suggestDepthLimit,
  summarizeComponentHint
} from '@/mcp/semantic-tree'

function createNode(
  type: SceneNode['type'],
  id: string,
  overrides: Record<string, unknown> = {},
  children?: SceneNode[]
): SceneNode {
  return {
    id,
    name: id,
    type,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
    ...(children ? { children } : {})
  } as unknown as SceneNode
}

function ids(nodes: ReturnType<typeof buildBoundedStructureOutline>['roots']): unknown[] {
  return nodes.map((node) => [node.id, ids(node.children ?? [])])
}

describe('mcp/semantic-tree', () => {
  it('suggests the same physical depth cap for oversized trees', () => {
    expect(suggestDepthLimit([createNode('FRAME', 'small')])).toBeUndefined()
    expect(
      suggestDepthLimit(Array.from({ length: 2050 }, (_, index) => createNode('FRAME', `${index}`)))
    ).toBe(0)
    expect(
      suggestDepthLimit([
        createNode(
          'FRAME',
          'root',
          {},
          Array.from({ length: 2047 }, (_, index) => createNode('RECTANGLE', `${index}`))
        )
      ])
    ).toBeUndefined()
    expect(
      suggestDepthLimit([
        createNode(
          'FRAME',
          'root',
          {},
          Array.from({ length: 2048 }, (_, index) => createNode('RECTANGLE', `${index}`))
        )
      ])
    ).toBe(1)
    expect(
      suggestDepthLimit([
        createNode(
          'FRAME',
          'root',
          {},
          Array.from({ length: 1000 }, (_, index) =>
            createNode(
              'FRAME',
              `parent-${index}`,
              {},
              Array.from({ length: 3 }, (_, childIndex) =>
                createNode('RECTANGLE', `child-${index}-${childIndex}`)
              )
            )
          )
        )
      ])
    ).toBe(2)
  })

  it('stops depth counting after the threshold without reading a wide suffix', () => {
    let visibilityReads = 0
    const roots = Array.from({ length: 10_000 }, (_, index) => {
      const node = createNode('RECTANGLE', `${index}`)
      Object.defineProperty(node, 'visible', {
        get() {
          visibilityReads += 1
          return true
        }
      })
      return node
    })

    expect(suggestDepthLimit(roots)).toBe(0)
    expect(visibilityReads).toBe(2049)
  })

  it('matches the complete depth count for mixed visible and hidden trees', () => {
    const completeDepthLimit = (roots: SceneNode[]): number | undefined => {
      const counts: number[] = []
      const count = (nodes: SceneNode[], depth: number): void => {
        for (const node of nodes) {
          if (!node.visible) continue
          counts[depth] = (counts[depth] ?? 0) + 1
          if ('children' in node) count([...node.children], depth + 1)
        }
      }
      count(roots, 0)
      if (counts.reduce((sum, value) => sum + value, 0) <= 2048) return undefined
      let cumulative = 0
      for (const [depth, value] of counts.entries()) {
        cumulative += value
        if (cumulative > 1536) return depth
      }
      throw new Error('Expected a depth after the physical node cap')
    }

    for (let seed = 0; seed < 13; seed += 1) {
      const roots = Array.from({ length: 80 + seed * 3 }, (_, rootIndex) =>
        createNode(
          'FRAME',
          `root-${seed}-${rootIndex}`,
          { visible: (rootIndex + seed) % 17 !== 0 },
          Array.from({ length: (rootIndex * 7 + seed * 13) % 35 }, (_, childIndex) =>
            createNode(
              'FRAME',
              `child-${rootIndex}-${childIndex}`,
              { visible: (rootIndex + childIndex + seed) % 9 !== 0 },
              Array.from({ length: (rootIndex + childIndex + seed) % 5 }, (_, leafIndex) =>
                createNode('RECTANGLE', `leaf-${rootIndex}-${childIndex}-${leafIndex}`)
              )
            )
          )
        )
      )
      expect(suggestDepthLimit(roots)).toBe(completeDepthLimit(roots))
    }
  })

  it('classifies tags, media, and component hints used by get_code', () => {
    expect(resolveSemanticTag(createNode('TEXT', 'text', { characters: 'A\nB' }))).toBe('p')
    const video = createNode('RECTANGLE', 'video', {
      fills: [{ type: 'VIDEO', videoHash: 'hash', visible: true }]
    })
    expect(classifySemanticAsset(video)).toBe('image')
    expect(resolveSemanticTag(video)).toBe('img')
    const instance = createNode('INSTANCE', 'button', {
      mainComponent: { name: 'Button', parent: { type: 'COMPONENT_SET', name: 'Button Group' } },
      componentProperties: {
        Size: { type: 'VARIANT', value: 'Large' },
        disabled: { type: 'BOOLEAN', value: false },
        swap: { type: 'INSTANCE_SWAP', value: 'ignored' }
      }
    }) as InstanceNode
    expect(summarizeComponentHint(instance)).toBe('ButtonGroup[Size=Large][disabled=off]')
  })

  it.each([undefined, 0, 1, 2])(
    'keeps wrapper, hidden, mask, sibling, and depth behavior at depth %s',
    (depthLimit) => {
      const branch = createNode('FRAME', 'branch', { layoutMode: 'VERTICAL' }, [
        createNode('RECTANGLE', 'first', { x: 12 }),
        createNode('RECTANGLE', 'hidden', { visible: false }),
        createNode('FRAME', 'inner', {}, [
          createNode('FRAME', 'nested-wrapper', {}, [createNode('TEXT', 'second', { y: 18 })])
        ]),
        createNode('FRAME', 'mask', { isMask: true }, [createNode('RECTANGLE', 'masked')])
      ])
      const roots = [
        createNode('FRAME', 'hidden-root', { visible: false }),
        createNode('FRAME', 'outer', {}, [branch]),
        createNode('FRAME', 'sibling-wrapper', {}, [createNode('RECTANGLE', 'sibling')])
      ]
      const outline = buildBoundedStructureOutline(roots, depthLimit, 240)

      expect(ids(outline.roots)).toEqual([
        [
          'branch',
          [
            ['first', []],
            [depthLimit === 1 ? 'inner' : 'second', []],
            ['mask', depthLimit === 1 ? [] : [['masked', []]]]
          ]
        ],
        ['sibling', []]
      ])
      expect(outline.observedNodes).toBe(depthLimit === 1 ? 5 : 6)
      expect(outline.physicalNodes.map((node) => node.id)).toEqual(
        depthLimit === 1
          ? ['branch', 'first', 'inner', 'mask', 'sibling']
          : ['branch', 'first', 'second', 'mask', 'masked', 'sibling']
      )
      expect(outline.roots[0]?.children?.[0]?.x).toBe(12)
      if (depthLimit !== 1) expect(outline.roots[0]?.children?.[1]?.y).toBe(18)
    }
  )

  it('observes one node beyond the bounded prefix to prove truncation', () => {
    const roots = Array.from({ length: 260 }, (_, index) =>
      createNode('RECTANGLE', `sibling-${index}`)
    )
    const outline = buildBoundedStructureOutline(roots, undefined, 240)

    expect(outline.observedNodes).toBe(241)
    expect(outline.roots).toHaveLength(240)
    expect(outline.physicalNodes).toEqual(roots.slice(0, 240))
    expect(outline.roots.at(-1)?.id).toBe('sibling-239')
  })

  it('retains the automatic depth cap when physical width exceeds the threshold', () => {
    const roots = Array.from({ length: 2050 }, (_, index) =>
      createNode('FRAME', `wrapper-${index}`, {}, [createNode('RECTANGLE', `child-${index}`)])
    )
    const outline = buildBoundedStructureOutline(roots, undefined, 240)

    expect(outline.observedNodes).toBe(241)
    expect(outline.roots).toHaveLength(240)
    expect(outline.roots[0]?.id).toBe('wrapper-0')
    expect(outline.roots[0]?.children).toBeUndefined()
  })

  it('does not read metadata that the structure outline discards', () => {
    const node = createNode('TEXT', 'text')
    Object.defineProperty(node, 'characters', {
      get() {
        throw new Error('text content should not be read for structure')
      }
    })

    expect(buildBoundedStructureOutline([node], undefined, 240).roots).toEqual([
      { id: 'text', name: 'text', type: 'TEXT', x: 0, y: 0, width: 100, height: 100 }
    ])
  })

  it('stops after proving truncation when an explicit depth avoids the depth-count pass', () => {
    let visibilityReads = 0
    const roots = Array.from({ length: 1000 }, (_, index) => {
      const node = createNode('RECTANGLE', `${index}`)
      Object.defineProperty(node, 'visible', {
        get() {
          visibilityReads += 1
          return true
        }
      })
      return node
    })

    const outline = buildBoundedStructureOutline(roots, 1, 240)

    expect(outline.roots).toHaveLength(240)
    expect(outline.observedNodes).toBe(241)
    expect(visibilityReads).toBe(241)
  })

  it('does not scan a wide child suffix after proving the outline is truncated', () => {
    let visibilityReads = 0
    const children = Array.from({ length: 10_000 }, (_, index) => {
      const child = createNode('RECTANGLE', `${index}`)
      Object.defineProperty(child, 'visible', {
        get() {
          visibilityReads += 1
          return true
        }
      })
      return child
    })
    const root = createNode('FRAME', 'root', {}, children)

    const outline = buildBoundedStructureOutline([root], 2, 240)

    expect(outline.observedNodes).toBe(241)
    expect(outline.roots[0]?.children).toHaveLength(239)
    expect(outline.roots[0]?.children?.at(-1)?.id).toBe('238')
    expect(visibilityReads).toBeLessThan(500)
  })

  it('reuses the only visible child when flattening a sparse wide wrapper', () => {
    let visibilityReads = 0
    const children = Array.from({ length: 10_000 }, (_, index) => {
      const child = createNode('RECTANGLE', `${index}`)
      Object.defineProperty(child, 'visible', {
        get() {
          visibilityReads += 1
          return index === 9_999
        }
      })
      return child
    })
    const root = createNode('FRAME', 'wrapper', {}, children)

    const outline = buildBoundedStructureOutline([root], 2, 240)

    expect(outline.roots.map((node) => node.id)).toEqual(['9999'])
    expect(outline.observedNodes).toBe(1)
    expect(visibilityReads).toBe(10_001)
  })
})
