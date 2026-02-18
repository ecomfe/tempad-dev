import { describe, expect, it, vi } from 'vitest'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'
import { handleGetStructure } from '@/mcp/tools/structure'

vi.mock('@/mcp/semantic-tree', () => ({
  buildSemanticTree: vi.fn(),
  semanticTreeToOutline: vi.fn()
}))

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
    vi.mocked(buildSemanticTree).mockReturnValue({ roots: [] } as unknown as ReturnType<
      typeof buildSemanticTree
    >)
    vi.mocked(semanticTreeToOutline).mockReturnValue([])

    handleGetStructure([], 3)

    expect(buildSemanticTree).toHaveBeenCalledWith([], { depthLimit: 3 })
  })

  it('compacts large outlines to keep structure output small', () => {
    vi.mocked(buildSemanticTree).mockReturnValue({ roots: [] } as unknown as ReturnType<
      typeof buildSemanticTree
    >)
    vi.mocked(semanticTreeToOutline).mockReturnValue(
      Array.from({ length: 400 }, (_, i) => ({
        id: `node-${i}`,
        name: 'Very long layer name '.repeat(20),
        type: 'FRAME',
        x: i + 0.1234,
        y: i + 0.5678,
        width: 100,
        height: 200
      })) as never
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
