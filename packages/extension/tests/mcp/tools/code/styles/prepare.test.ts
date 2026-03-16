import { describe, expect, it, vi } from 'vitest'

import type { GetCodeCacheContext } from '@/mcp/tools/code/cache'
import type { VisibleTree } from '@/mcp/tools/code/model'
import type { VariableMappings } from '@/mcp/tools/token/mapping'

import { sanitizeStyles } from '@/mcp/tools/code/sanitize'
import { buildLayoutStyles } from '@/mcp/tools/code/styles/normalize'
import { prepareStyles } from '@/mcp/tools/code/styles/prepare'
import { normalizeStyleVars } from '@/mcp/tools/token/mapping'

vi.mock('@/mcp/tools/token/mapping', () => ({
  normalizeStyleVars: vi.fn()
}))

vi.mock('@/mcp/tools/code/sanitize', () => ({
  sanitizeStyles: vi.fn()
}))

vi.mock('@/mcp/tools/code/styles/normalize', () => ({
  buildLayoutStyles: vi.fn()
}))

describe('mcp/code styles prepare', () => {
  it('normalizes vars, sanitizes styles, builds layout and stamps trace stages', () => {
    const tree = { order: ['node-1'] } as unknown as VisibleTree
    const styles = new Map([['node-1', { width: 'var(--size)' }]])
    const mappings = {} as VariableMappings
    const variableCache = new Map<string, Variable | null>()
    const vectorRoots = new Set(['node-1'])
    const usedCandidateIds = new Set(['var-1'])
    const layout = new Map([['node-1', { display: 'flex' }]])
    const cache = createCache()

    vi.mocked(normalizeStyleVars).mockReturnValue(usedCandidateIds)
    vi.mocked(buildLayoutStyles).mockReturnValue(layout)

    const stamps: Array<[string, number]> = []
    let now = 100
    const result = prepareStyles({
      tree,
      styles,
      mappings,
      variableCache,
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

    expect(normalizeStyleVars).toHaveBeenCalledWith(styles, mappings, variableCache)
    expect(sanitizeStyles).toHaveBeenCalledWith(tree, styles, vectorRoots, cache)
    expect(buildLayoutStyles).toHaveBeenCalledWith(styles, vectorRoots)
    expect(stamps).toEqual([
      ['normalize-vars', 110],
      ['layout', 120]
    ])
    expect(result).toEqual({
      styles,
      layout,
      usedCandidateIds
    })
  })

  it('works without trace hooks', () => {
    const usedCandidateIds = new Set<string>()
    const layout = new Map<string, Record<string, string>>()
    const cache = createCache()
    vi.mocked(normalizeStyleVars).mockReturnValue(usedCandidateIds)
    vi.mocked(buildLayoutStyles).mockReturnValue(layout)

    const result = prepareStyles({
      tree: {} as VisibleTree,
      styles: new Map(),
      mappings: {} as VariableMappings,
      variableCache: new Map(),
      vectorRoots: new Set(),
      cache
    })

    expect(result.usedCandidateIds).toBe(usedCandidateIds)
    expect(result.layout).toBe(layout)
  })
})

function createCache(): GetCodeCacheContext {
  return {
    readers: {
      getStyleById: () => null,
      getVariableById: () => null
    },
    variables: new Map(),
    styles: new Map(),
    paintStyles: new Map(),
    nodeSemantics: new Map(),
    vectorAnalysis: new Map()
  }
}
