import { afterEach, describe, expect, it, vi } from 'vitest'

import { getVariableByIdCached } from '@/mcp/tools/code/tokens/cache'

function setFigmaVariableGetter(fn: (id: string) => Variable | null) {
  ;(globalThis as { figma?: PluginAPI }).figma = {
    variables: {
      getVariableById: vi.fn(fn)
    }
  } as unknown as PluginAPI
}

afterEach(() => {
  delete (globalThis as { figma?: PluginAPI }).figma
  vi.restoreAllMocks()
})

describe('tokens/cache getVariableByIdCached', () => {
  it('reads directly from figma api when cache is omitted', () => {
    const token = { id: 'var-1' } as Variable
    setFigmaVariableGetter(() => token)

    expect(getVariableByIdCached('var-1')).toBe(token)
  })

  it('returns cached values (including null) without hitting figma api', () => {
    setFigmaVariableGetter(() => {
      throw new Error('should not call figma')
    })

    const cache = new Map<string, Variable | null>([
      ['var-1', { id: 'var-1' } as Variable],
      ['var-2', null]
    ])

    expect(getVariableByIdCached('var-1', cache)).toEqual({ id: 'var-1' })
    expect(getVariableByIdCached('var-2', cache)).toBeNull()
  })

  it('caches and returns fetched variable when key is missing', () => {
    const token = { id: 'var-1' } as Variable
    setFigmaVariableGetter(() => token)

    const cache = new Map<string, Variable | null>()
    expect(getVariableByIdCached('var-1', cache)).toBe(token)
    expect(cache.get('var-1')).toBe(token)
  })

  it('caches null when figma api cannot find the variable', () => {
    setFigmaVariableGetter(() => null)

    const cache = new Map<string, Variable | null>()
    expect(getVariableByIdCached('missing', cache)).toBeNull()
    expect(cache.get('missing')).toBeNull()
  })
})
