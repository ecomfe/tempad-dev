import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasMediaFills, replaceMediaUrlsWithAssets } from '@/mcp/tools/code/assets'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { withCodeDeadline } from '@/mcp/tools/code/deadline'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { resolveStylesFromNodeData } from '@/utils/figma-style/style-resolver'
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

afterEach(() => vi.restoreAllMocks())

describe('mcp/code collectNodeData operation counts', () => {
  it.each(['css', 'cached CSS', 'text', 'styles', 'media'])(
    'stops collection when %s exceeds the deadline before the timer runs and reuses root CSS for a shell',
    async (stage) => {
      let elapsed = 0
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
      const snapshots = ['root', 'unread'].map((id) =>
        createSnapshot({ id, type: stage === 'text' && id === 'root' ? 'TEXT' : 'FRAME' })
      )
      const cssReaders = snapshots.map((snapshot, index) => {
        const getCSSAsync = vi.fn(async () => {
          if (index === 0 && stage === 'css') elapsed = 21
          return { display: 'block' }
        })
        snapshot.node = {
          id: snapshot.id,
          type: snapshot.type,
          visible: true,
          getCSSAsync,
          getStyledTextSegments: () => {
            elapsed = 21
            return []
          }
        } as unknown as SceneNode
        return getCSSAsync
      })
      const cache = createGetCodeCacheContext()
      if (stage === 'cached CSS')
        cache.rawCss.set(
          'root',
          Promise.resolve().then(() => {
            elapsed = 21
            return { display: 'block' }
          })
        )
      if (stage === 'styles')
        vi.mocked(resolveStylesFromNodeData).mockImplementationOnce(async (style) => {
          elapsed = 21
          return style
        })
      const completedMedia = vi.fn()
      if (stage === 'media') {
        vi.mocked(hasMediaFills).mockReturnValueOnce(true)
        vi.mocked(replaceMediaUrlsWithAssets).mockImplementationOnce(
          async (
            style,
            _node,
            _config,
            _registry,
            _videoHashes,
            _imageBytes,
            _imageSizes,
            assertActive
          ) => {
            elapsed = 21
            assertActive?.()
            completedMedia()
            return style
          }
        )
      }
      const tree = createTree(snapshots)
      const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
      await expect(
        withCodeDeadline(20, (signal, checkpoint) =>
          collectNodeData(
            tree,
            config,
            new Map(),
            { ...cache, signal },
            undefined,
            undefined,
            undefined,
            checkpoint
          )
        )
      ).rejects.toThrow('Code generation timed out')
      expect(cssReaders[1]).not.toHaveBeenCalled()
      if (stage === 'text' || stage === 'cached CSS') expect(cssReaders[0]).not.toHaveBeenCalled()
      if (stage === 'css' || stage === 'cached CSS')
        expect(resolveStylesFromNodeData).not.toHaveBeenCalled()
      if (stage === 'styles') expect(formatNodeStyleForMcp).not.toHaveBeenCalled()
      expect(completedMedia).not.toHaveBeenCalled()

      const shell = await withCodeDeadline(5, (signal, checkpoint) =>
        collectNodeData(
          tree,
          config,
          new Map(),
          { ...cache, signal },
          new Set(['unread']),
          undefined,
          undefined,
          checkpoint
        )
      )
      expect(shell.styles.get('root')).toEqual({ display: 'block' })
      expect(cssReaders[0]).toHaveBeenCalledTimes(stage === 'cached CSS' ? 0 : 1)
      expect(cssReaders[1]).not.toHaveBeenCalled()
    }
  )

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
      nodeSemanticHits: 4,
      nodeSemanticMisses: 4
    })
  })
})
