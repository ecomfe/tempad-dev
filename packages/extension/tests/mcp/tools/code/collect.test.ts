import { describe, expect, it, vi } from 'vitest'

import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

vi.mock('@/utils/figma-style/style-resolver', () => ({
  resolveStylesFromNodeData: vi.fn((style) => style)
}))

vi.mock('@/utils/variable-output', () => ({
  formatNodeStyleForMcp: vi.fn((style) => style)
}))

vi.mock('@/mcp/tools/code/assets', () => ({
  hasImageFills: vi.fn(() => false),
  replaceImageUrlsWithAssets: vi.fn((style) => Promise.resolve(style))
}))

vi.mock('@/mcp/tools/code/styles', () => ({
  preprocessStyles: vi.fn((style) => style),
  stripInertShadows: vi.fn()
}))

describe('mcp/code collectNodeData operation counts', () => {
  it('reads CSS exactly once for every collected node and skips omitted descendants', async () => {
    const snapshots = Array.from({ length: 6 }, (_, index) =>
      createSnapshot({ id: `node-${index}`, type: index === 2 ? 'TEXT' : 'FRAME' })
    )
    const cssReaders = snapshots.map((snapshot, index) => {
      const getCSSAsync = vi.fn().mockResolvedValue({ display: `block-${index}` })
      snapshot.node = {
        id: snapshot.id,
        type: snapshot.type,
        visible: true,
        getCSSAsync,
        ...(snapshot.type === 'TEXT'
          ? { getStyledTextSegments: vi.fn(() => [{ characters: 'copy' }]) }
          : {})
      } as unknown as SceneNode
      return getCSSAsync
    })
    const tree = createTree(snapshots)
    const cache = createGetCodeCacheContext(new Map(), { metrics: true })

    const result = await collectNodeData(
      tree,
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      new Map(),
      cache,
      new Set(['node-1', 'node-4'])
    )

    expect(cssReaders.map((read) => read.mock.calls.length)).toEqual([1, 0, 1, 1, 0, 1])
    expect(result.styles.size).toBe(4)
    expect(result.textSegments.get('node-2')).toEqual([{ characters: 'copy' }])
    expect(cache.metrics).toMatchObject({
      nodeSemanticHits: 0,
      nodeSemanticMisses: 4
    })
  })
})
