import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/shared'
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
      roots: [{ id: 'outline-1' }]
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

  it('throws when serialized payload exceeds max allowed size', () => {
    vi.mocked(buildSemanticTree).mockReturnValue({ roots: [] } as unknown as ReturnType<
      typeof buildSemanticTree
    >)
    vi.mocked(semanticTreeToOutline).mockReturnValue([
      { id: 'big', name: 'x'.repeat(MCP_MAX_PAYLOAD_BYTES) }
    ] as never)

    expect(() => handleGetStructure([])).toThrow(
      'Structure payload too large to return. Reduce selection or depth and retry.'
    )
  })
})
