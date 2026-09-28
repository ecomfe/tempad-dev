import { describe, expect, it, vi } from 'vitest'

import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { formatNodeStyleForMcp } from '@/utils/variable-output'

vi.mock('@/utils/figma-style/style-resolver', () => ({
  resolveStylesFromNodeData: vi.fn((style) => style)
}))

vi.mock('@/utils/variable-output', () => ({
  formatNodeStyleForMcp: vi.fn((style) => style)
}))

vi.mock('@/mcp/tools/code/assets', () => ({
  hasMediaFills: vi.fn(() => false),
  replaceMediaUrlsWithAssets: vi.fn((style) => Promise.resolve(style))
}))

vi.mock('@/mcp/tools/code/styles', () => ({
  preprocessStyles: vi.fn((style) => style),
  stripInertShadows: vi.fn()
}))

describe('mcp/code collectNodeData operation counts', () => {
  it('reuses raw CSS across overlapping root reads without sharing processed styles or later requests', async () => {
    const snapshot = createSnapshot({ id: 'shared', type: 'FRAME' })
    const getCSSAsync = vi.fn().mockResolvedValue({ color: 'red' })
    snapshot.node = {
      id: 'shared',
      type: 'FRAME',
      visible: true,
      getCSSAsync
    } as unknown as SceneNode
    const tree = createTree([snapshot])
    const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
    const cache = createGetCodeCacheContext()
    const first = await collectNodeData(tree, config, new Map(), cache)
    first.styles.get('shared')!.color = 'blue'
    const second = await collectNodeData(tree, config, new Map(), cache)
    expect(getCSSAsync).toHaveBeenCalledOnce()
    expect(second.styles.get('shared')?.color).toBe('red')
    await collectNodeData(tree, config, new Map(), createGetCodeCacheContext())
    expect(getCSSAsync).toHaveBeenCalledTimes(2)
  })

  it('reuses root CSS for a shell and stops collection when a timed-out child settles', async () => {
    const snapshots = ['root', 'slow', 'unread'].map((id) => createSnapshot({ id }))
    let finish!: (css: Record<string, string>) => void
    const slow = new Promise<Record<string, string>>((resolve) => {
      finish = resolve
    })
    const reads = snapshots.map((snapshot, index) => {
      const read = vi.fn(() => (index === 1 ? slow : Promise.resolve({ display: 'flex' })))
      snapshot.node = {
        id: snapshot.id,
        type: 'FRAME',
        visible: true,
        getCSSAsync: read
      } as unknown as SceneNode
      return read
    })
    const tree = createTree(snapshots)
    const cache = createGetCodeCacheContext()
    const controller = new AbortController()
    const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
    const full = collectNodeData(tree, config, new Map(), { ...cache, signal: controller.signal })
    await vi.waitFor(() => expect(reads[1]).toHaveBeenCalledOnce())
    const reason = new Error('deadline')
    controller.abort(reason)
    const shell = await collectNodeData(tree, config, new Map(), cache, new Set(['slow', 'unread']))
    expect(shell.styles.get('root')).toEqual({ display: 'flex' })
    expect(reads[0]).toHaveBeenCalledOnce()
    const rejected = expect(full).rejects.toBe(reason)
    finish({ color: 'red' })
    await rejected
    expect(reads[2]).not.toHaveBeenCalled()
  })

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
    const nodeVariableIds = new Map(
      snapshots.map((snapshot, index) => [snapshot.id, new Set([`var-${index}`])])
    )

    const result = await collectNodeData(
      tree,
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      new Map(),
      cache,
      new Set(['node-1', 'node-4']),
      nodeVariableIds
    )

    expect(cssReaders.map((read) => read.mock.calls.length)).toEqual([1, 0, 1, 1, 0, 1])
    expect(result.styles.size).toBe(4)
    expect(result.textSegments.get('node-2')).toEqual([{ characters: 'copy' }])
    expect(
      vi.mocked(formatNodeStyleForMcp).mock.calls.map(([, node, , ids]) => [node.id, ids])
    ).toEqual([
      ['node-0', new Set(['var-0'])],
      ['node-2', new Set(['var-2'])],
      ['node-3', new Set(['var-3'])],
      ['node-5', new Set(['var-5'])]
    ])
    expect(cache.metrics).toMatchObject({
      nodeSemanticHits: 0,
      nodeSemanticMisses: 4
    })
  })
})
