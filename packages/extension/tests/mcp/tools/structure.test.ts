import { describe, expect, it, vi } from 'vitest'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'
import { handleGetStructure } from '@/mcp/tools/structure'

vi.mock('@/mcp/semantic-tree', () => ({
  buildSemanticTree: vi.fn(),
  semanticTreeToOutline: vi.fn()
}))

function mockOutline(roots: unknown[]): void {
  vi.mocked(buildSemanticTree).mockReturnValue({ roots: [] } as unknown as ReturnType<
    typeof buildSemanticTree
  >)
  vi.mocked(semanticTreeToOutline).mockReturnValue(roots as never)
}

describe('mcp/tools/structure', () => {
  it('uses undefined depth when input depth is falsy and returns outline payload', () => {
    vi.mocked(buildSemanticTree).mockReturnValue({
      roots: [{ id: 'root-1' }]
    } as unknown as ReturnType<typeof buildSemanticTree>)
    vi.mocked(semanticTreeToOutline).mockReturnValue([{ id: 'outline-1' }] as never)

    const result = handleGetStructure([{ id: 'node-1', visible: true } as unknown as SceneNode], 0)

    expect(buildSemanticTree).toHaveBeenCalledWith([{ id: 'node-1', visible: true }], {
      depthLimit: undefined
    })
    expect(result).toEqual({
      roots: [
        {
          id: 'outline-1',
          name: '',
          type: 'UNKNOWN',
          x: 0,
          y: 0,
          width: 0,
          height: 0
        }
      ]
    })
  })

  it('passes explicit depth limit through to semantic tree builder', () => {
    mockOutline([])

    handleGetStructure([], 3)

    expect(buildSemanticTree).toHaveBeenCalledWith([], { depthLimit: 3 })
  })

  it('returns stable authoring keys only for managed nodes', () => {
    const child = {
      id: 'child-1',
      visible: true,
      getSharedPluginData: vi.fn(() => 'managed/child')
    }
    const root = {
      id: 'root-1',
      children: [child],
      getSharedPluginData: vi.fn(() => '')
    }
    mockOutline([
      {
        id: 'root-1',
        name: 'Root',
        type: 'FRAME',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        children: [
          {
            id: 'child-1',
            name: 'Child',
            type: 'TEXT',
            x: 0,
            y: 0,
            width: 20,
            height: 10
          }
        ]
      }
    ])

    const result = handleGetStructure([root as unknown as SceneNode])

    expect(result.roots[0]).toMatchObject({
      id: 'root-1',
      children: [{ id: 'child-1', authoringKey: 'managed/child' }]
    })
    expect(result.roots[0]).not.toHaveProperty('authoringKey')
    expect(child.getSharedPluginData).toHaveBeenCalledWith('tempad_dev', 'canvas-key')
  })

  it('does not expose definition keys inherited by an instance subtree', () => {
    const component = {
      id: 'component-1',
      getSharedPluginData: vi.fn(() => 'component/card')
    }
    const child = {
      id: 'instance-child-1',
      type: 'TEXT',
      visible: true,
      getSharedPluginData: vi.fn(() => 'component/card/label')
    }
    const instance = {
      id: 'instance-1',
      type: 'INSTANCE',
      visible: true,
      children: [child],
      mainComponent: component,
      getSharedPluginData: vi.fn(() => 'component/card')
    }
    mockOutline([{ id: 'instance-1', children: [{ id: 'instance-child-1' }] }])

    const result = handleGetStructure([instance as unknown as SceneNode])

    expect(result.roots[0]).not.toHaveProperty('authoringKey')
    expect(result.roots[0]?.children?.[0]).not.toHaveProperty('authoringKey')
    expect(child.getSharedPluginData).not.toHaveBeenCalled()
  })

  it('does not expose an inherited key when an instance descendant is the root', () => {
    const instance = {
      id: 'instance-1',
      type: 'INSTANCE',
      parent: null
    }
    const child = {
      id: 'instance-child-1',
      type: 'TEXT',
      visible: true,
      parent: instance,
      getSharedPluginData: vi.fn(() => 'component/card/label')
    }
    mockOutline([{ id: 'instance-child-1' }])

    const result = handleGetStructure([child as unknown as SceneNode])

    expect(result.roots[0]).not.toHaveProperty('authoringKey')
    expect(child.getSharedPluginData).not.toHaveBeenCalled()
  })

  it('optionally returns compact native mask, image, grid, and guide read-back', () => {
    const mask = {
      id: 'mask-1',
      name: 'Mask',
      type: 'RECTANGLE',
      visible: true,
      fills: [],
      isMask: true,
      maskType: 'ALPHA',
      getSharedPluginData: vi.fn(() => '')
    }
    const image = {
      id: 'image-1',
      name: 'Image',
      type: 'RECTANGLE',
      visible: true,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'figma-image-hash',
          scaleMode: 'FILL',
          visible: false,
          opacity: 0.75
        }
      ],
      getSharedPluginData: vi.fn(() => '')
    }
    const root = {
      id: 'root-1',
      name: 'Poster',
      type: 'FRAME',
      visible: true,
      children: [mask, image],
      layoutGrids: [
        {
          pattern: 'COLUMNS',
          alignment: 'STRETCH',
          gutterSize: 14,
          count: 6,
          offset: 44,
          visible: true,
          color: { r: 1, g: 0, b: 0, a: 0.1 }
        }
      ],
      guides: [
        { axis: 'X', offset: 44 },
        { axis: 'Y', offset: 244 }
      ],
      getSharedPluginData: vi.fn(() => '')
    }
    mockOutline([
      {
        id: 'root-1',
        name: 'Poster',
        type: 'FRAME',
        x: 0,
        y: 0,
        width: 700,
        height: 1000,
        children: [
          {
            id: 'mask-1',
            name: 'Mask',
            type: 'RECTANGLE',
            x: 44,
            y: 244,
            width: 612,
            height: 458
          },
          {
            id: 'image-1',
            name: 'Image',
            type: 'RECTANGLE',
            x: -30,
            y: 201,
            width: 760,
            height: 544
          }
        ]
      }
    ])

    const result = handleGetStructure([root as unknown as SceneNode], undefined, true)

    expect(result.roots[0]?.native).toEqual({
      layoutGrids: [
        {
          pattern: 'COLUMNS',
          alignment: 'STRETCH',
          gutterSize: 14,
          count: 6,
          offset: 44,
          visible: true,
          color: { r: 1, g: 0, b: 0, a: 0.1 }
        }
      ],
      guides: [
        { axis: 'X', offset: 44 },
        { axis: 'Y', offset: 244 }
      ]
    })
    expect(result.roots[0]?.children?.[0]?.native).toEqual({ mask: 'ALPHA' })
    expect(result.roots[0]?.children?.[1]?.native).toEqual({
      imageFills: [
        {
          imageHash: 'figma-image-hash',
          scaleMode: 'FILL',
          visible: false,
          opacity: 0.75
        }
      ]
    })

    const compactResult = handleGetStructure([root as unknown as SceneNode])
    expect(compactResult.roots[0]).not.toHaveProperty('native')
    expect(compactResult.roots[0]?.children?.[0]).not.toHaveProperty('native')
  })

  it('compacts large outlines to keep structure output small', () => {
    mockOutline(
      Array.from({ length: 400 }, (_, i) => ({
        id: `node-${i}`,
        name: 'Very long layer name '.repeat(20),
        type: 'FRAME',
        x: i + 0.1234,
        y: i + 0.5678,
        width: 100,
        height: 200
      }))
    )

    const result = handleGetStructure([])
    expect(countNodes(result.roots)).toBeLessThanOrEqual(240)
    expect(result.roots[0]?.name.length).toBeLessThanOrEqual(48)
    expect(result.roots[0]?.x).toBe(0.1)
  })
})

function countNodes(nodes: Array<{ children?: unknown[] }>): number {
  let count = 0
  const walk = (list: Array<{ children?: unknown[] }>) => {
    for (const node of list) {
      count += 1
      if (node.children?.length) {
        walk(node.children as Array<{ children?: unknown[] }>)
      }
    }
  }
  walk(nodes)
  return count
}
