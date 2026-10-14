import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

import { exportVectorAssets } from '@/mcp/tools/code/assets/export'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'
import { analyzeVectorColorModel } from '@/mcp/tools/code/assets/vector-semantics'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { withCodeDeadline } from '@/mcp/tools/code/deadline'
import { buildVisibleTree } from '@/mcp/tools/code/tree'

vi.mock('@/mcp/tools/code/assets/vector', () => ({
  exportSvgEntry: vi.fn()
}))

vi.mock('@/mcp/tools/code/assets/vector-semantics', () => ({
  analyzeVectorColorModel: vi.fn(() => ({ kind: 'fixed' }))
}))

function makeSnapshot(
  id: string,
  bounds: { width: number; height: number },
  renderBounds: { width: number; height: number } | null = null
): VisibleTree['nodes'] extends Map<string, infer T> ? T : never {
  return {
    id,
    type: 'FRAME',
    tag: 'div',
    name: id,
    visible: true,
    children: [],
    bounds: { x: 0, y: 0, ...bounds },
    renderBounds: renderBounds ? { x: 0, y: 0, ...renderBounds } : renderBounds,
    node: { id } as unknown as SceneNode
  } as VisibleTree['nodes'] extends Map<string, infer T> ? T : never
}

const config = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
} as const

describe('assets/export exportVectorAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([true, false])(
    'reuses the bounded tree’s inferred flow decision (%s)',
    async (inferred) => {
      let layoutReads = 0
      let transformReads = 0
      const child = {
        id: 'vector',
        name: 'Vector',
        type: 'VECTOR',
        visible: true,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        get relativeTransform() {
          transformReads++
          return [
            [1, 0, 0],
            [0, 1, 0]
          ]
        }
      } as unknown as SceneNode
      const root = {
        id: 'root',
        name: 'Root',
        type: 'FRAME',
        visible: true,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        layoutMode: 'NONE',
        clipsContent: true,
        children: [child],
        get inferredAutoLayout() {
          layoutReads++
          return inferred ? { layoutMode: 'HORIZONTAL' } : null
        }
      } as unknown as SceneNode
      const tree = buildVisibleTree([root])
      vi.mocked(exportSvgEntry).mockResolvedValueOnce({ props: { width: '10px' } })
      await exportVectorAssets(
        tree,
        { vectorRoots: new Set([child.id]), skippedIds: new Set() },
        config,
        new Map()
      )
      expect(exportSvgEntry).toHaveBeenCalledWith(
        child,
        config,
        expect.any(Map),
        expect.objectContaining({ flow: inferred })
      )
      expect(layoutReads).toBe(1)
      expect(transformReads).toBe(1)
    }
  )

  it.each(['geometry', 'analysis', 'export'])(
    'stops scheduling after %s exceeds the deadline before the timer runs',
    async (stage) => {
      let elapsed = 0
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
      const ids = ['a', 'b', 'c']
      const snapshots = ids.map((id) => makeSnapshot(id, { width: 10, height: 10 }))
      if (stage === 'geometry')
        Object.defineProperty(snapshots[0]!.bounds, 'width', {
          get() {
            elapsed = 21
            return 10
          }
        })
      if (stage === 'analysis')
        vi.mocked(analyzeVectorColorModel).mockImplementationOnce(() => {
          elapsed = 21
          return { kind: 'fixed' }
        })
      const completedExport = vi.fn(() => ({ props: { width: '10px' } }))
      vi.mocked(exportSvgEntry).mockImplementation((_node, _config, _registry, options) =>
        Promise.resolve().then(() => {
          if (stage === 'export') elapsed = 21
          options?.assertActive?.()
          return completedExport()
        })
      )
      const tree = {
        nodes: new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
      } as VisibleTree
      await expect(
        withCodeDeadline(20, (signal, checkpoint) =>
          exportVectorAssets(
            tree,
            { vectorRoots: new Set(ids), skippedIds: new Set() },
            config,
            new Map(),
            'smart',
            { ...createGetCodeCacheContext(), signal },
            checkpoint
          )
        )
      ).rejects.toThrow('Code generation timed out')
      expect(exportSvgEntry).toHaveBeenCalledTimes(stage === 'export' ? 2 : 0)
      expect(completedExport).not.toHaveBeenCalled()
    }
  )

  it('stops scheduling export batches after the full read times out', async () => {
    const ids = ['a', 'b', 'c']
    const tree = {
      nodes: new Map(ids.map((id) => [id, makeSnapshot(id, { width: 10, height: 10 })]))
    } as VisibleTree
    let finish!: () => void
    const stalled = new Promise<null>((resolve) => {
      finish = () => resolve(null)
    })
    vi.mocked(exportSvgEntry).mockReturnValue(stalled)
    const controller = new AbortController()
    const pending = exportVectorAssets(
      tree,
      { vectorRoots: new Set(ids), skippedIds: new Set() },
      config,
      new Map(),
      'smart',
      { ...createGetCodeCacheContext(), signal: controller.signal }
    )
    expect(exportSvgEntry).toHaveBeenCalledTimes(2)
    const reason = new Error('deadline')
    controller.abort(reason)
    const rejected = expect(pending).rejects.toBe(reason)
    finish()
    await rejected
    expect(exportSvgEntry).toHaveBeenCalledTimes(2)
  })

  it('exports vector roots and skips missing or zero-sized snapshots without render bounds', async () => {
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false },
      nodes: new Map([
        ['vector-ok', makeSnapshot('vector-ok', { width: 10, height: 20 })],
        ['zero-no-render', makeSnapshot('zero-no-render', { width: 0, height: 0 }, null)],
        [
          'zero-with-render',
          makeSnapshot('zero-with-render', { width: 0, height: 0 }, { width: 1, height: 1 })
        ]
      ])
    } as unknown as VisibleTree

    vi.mocked(exportSvgEntry)
      .mockResolvedValueOnce({ props: { width: '10px' } })
      .mockResolvedValueOnce({ props: { width: '1px' } })

    const result = await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['missing', 'zero-no-render', 'vector-ok', 'zero-with-render']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'smart'
    )

    expect(Array.from(result.keys())).toEqual(['vector-ok', 'zero-with-render'])
    expect(result.get('vector-ok')).toEqual({ props: { width: '10px' } })
    expect(result.get('zero-with-render')).toEqual({ props: { width: '1px' } })
    expect(exportSvgEntry).toHaveBeenCalledTimes(2)
  })

  it('omits entries when svg export returns null', async () => {
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false },
      nodes: new Map([['vector-null', makeSnapshot('vector-null', { width: 2, height: 3 })]])
    } as unknown as VisibleTree

    vi.mocked(exportSvgEntry).mockResolvedValueOnce(null)

    const result = await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['vector-null']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'snapshot'
    )

    expect(result).toEqual(new Map())
    expect(exportSvgEntry).toHaveBeenCalledTimes(1)
  })

  it('passes the request cache through vector color analysis', async () => {
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false },
      nodes: new Map([['vector-ok', makeSnapshot('vector-ok', { width: 10, height: 20 })]])
    } as unknown as VisibleTree
    const cache = createGetCodeCacheContext()

    vi.mocked(exportSvgEntry).mockResolvedValueOnce({ props: { width: '10px' } })

    await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['vector-ok']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'smart',
      cache
    )

    expect(analyzeVectorColorModel).toHaveBeenCalledWith(tree, 'vector-ok', cache)
  })

  it('records vector export metrics on the request cache', async () => {
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false },
      nodes: new Map([
        ['vector-ok', makeSnapshot('vector-ok', { width: 10, height: 20 })],
        ['zero-no-render', makeSnapshot('zero-no-render', { width: 0, height: 0 }, null)]
      ])
    } as unknown as VisibleTree
    const cache = createGetCodeCacheContext(new Map(), { metrics: true })

    vi.mocked(exportSvgEntry).mockResolvedValueOnce({
      props: { width: '10px', 'data-src': 'https://assets.test/vector-ok.svg' }
    })

    await exportVectorAssets(
      tree,
      {
        vectorRoots: new Set(['missing', 'zero-no-render', 'vector-ok']),
        skippedIds: new Set()
      },
      config,
      new Map(),
      'smart',
      cache
    )

    expect(cache.metrics).toMatchObject({
      vectorExportCandidates: 3,
      vectorExportSkippedMissing: 1,
      vectorExportSkippedZeroBounds: 1,
      vectorExportUploaded: 1,
      vectorExportNull: 0,
      vectorExportThemeableInline: 0,
      vectorExportRawInline: 0
    })
  })

  it('bounds vector export concurrency and preserves deterministic asset order', async () => {
    const ids = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']
    const tree = {
      rootIds: ['root'],
      order: [],
      stats: { totalNodes: 0, maxDepth: 0, capped: false },
      nodes: new Map(ids.map((id) => [id, makeSnapshot(id, { width: 10, height: 10 })]))
    } as unknown as VisibleTree
    const started: string[] = []
    const finish = new Map<string, () => void>()
    let active = 0
    let maxActive = 0

    vi.mocked(exportSvgEntry).mockImplementation((node, _config, registry) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(node.id)
      return new Promise((resolve) => {
        finish.set(node.id, () => {
          registry.set(node.id, {
            hash: node.id,
            mimeType: 'image/svg+xml',
            size: 1,
            url: `http://assets.test/${node.id}.svg`
          })
          active -= 1
          resolve({ props: { id: node.id } })
        })
      })
    })

    const assetRegistry = new Map()
    const pending = exportVectorAssets(
      tree,
      { vectorRoots: new Set(ids), skippedIds: new Set() },
      config,
      assetRegistry
    )

    expect(started).toEqual(['aaaaaaaa', 'bbbbbbbb'])
    finish.get('bbbbbbbb')?.()
    await Promise.resolve()
    expect(started).toEqual(['aaaaaaaa', 'bbbbbbbb'])

    finish.get('aaaaaaaa')?.()
    await vi.waitFor(() => expect(started).toEqual(ids))
    finish.get('cccccccc')?.()

    await expect(pending).resolves.toEqual(new Map(ids.map((id) => [id, { props: { id } }])))
    expect([...assetRegistry.keys()]).toEqual(ids)
    expect(maxActive).toBe(2)
  })
})
