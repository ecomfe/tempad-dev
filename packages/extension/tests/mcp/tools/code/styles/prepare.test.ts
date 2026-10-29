import { describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { sanitizeStyles } from '@/mcp/tools/code/sanitize'
import { buildLayoutStyles } from '@/mcp/tools/code/styles/normalize'
import { prepareStyles } from '@/mcp/tools/code/styles/prepare'

vi.mock('@/mcp/tools/code/sanitize', () => ({
  sanitizeStyles: vi.fn()
}))

vi.mock('@/mcp/tools/code/styles/normalize', () => ({
  buildLayoutStyles: vi.fn()
}))

describe('mcp/code styles prepare', () => {
  it('sanitizes projected styles, builds layout and stamps the stage', () => {
    const tree = { order: ['node-1'] } as unknown as VisibleTree
    const styles = new Map([['node-1', { width: 'var(--size)' }]])
    const vectorRoots = new Set(['node-1'])
    const layout = new Map([['node-1', { display: 'flex' }]])
    const cache = createGetCodeCacheContext()

    vi.mocked(buildLayoutStyles).mockReturnValue(layout)

    const stamps: Array<[string, number]> = []
    let now = 100
    const result = prepareStyles({
      tree,
      styles,
      vectorRoots,
      cache,
      trace: {
        now: () => {
          now += 10
          return now
        },
        stamp: (label, start) => {
          stamps.push([label, start])
        }
      }
    })

    expect(sanitizeStyles).toHaveBeenCalledWith(tree, styles, vectorRoots, cache)
    expect(buildLayoutStyles).toHaveBeenCalledWith(styles, vectorRoots)
    expect(stamps).toEqual([['layout', 110]])
    expect(result).toEqual({
      styles,
      layout
    })
  })

  it('works without trace hooks', () => {
    const layout = new Map<string, Record<string, string>>()
    const cache = createGetCodeCacheContext()
    vi.mocked(buildLayoutStyles).mockReturnValue(layout)

    const result = prepareStyles({
      tree: {} as VisibleTree,
      styles: new Map(),
      vectorRoots: new Set(),
      cache
    })

    expect(result.layout).toBe(layout)
  })
})
