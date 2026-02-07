import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getVariableByIdCached } from '@/mcp/tools/token/cache'

type VariableLookup = {
  getVariableById: ReturnType<typeof vi.fn>
}

function setFigmaVariableLookup(lookup: VariableLookup): void {
  ;(globalThis as { figma?: { variables: VariableLookup } }).figma = {
    variables: lookup
  }
}

describe('token/cache getVariableByIdCached', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (globalThis as { figma?: unknown }).figma
  })

  it('reads directly from figma when cache is not provided', () => {
    const variable = { id: 'v-1', name: 'Primary' } as unknown as Variable
    const getVariableById = vi.fn(() => variable)
    setFigmaVariableLookup({ getVariableById })

    expect(getVariableByIdCached('v-1')).toBe(variable)
    expect(getVariableById).toHaveBeenCalledWith('v-1')
  })

  it('returns cached values for hits including explicit nulls', () => {
    const getVariableById = vi.fn()
    setFigmaVariableLookup({ getVariableById })

    const variable = { id: 'v-2', name: 'Secondary' } as unknown as Variable
    const cache = new Map<string, Variable | null>([
      ['v-2', variable],
      ['v-null', null]
    ])

    expect(getVariableByIdCached('v-2', cache)).toBe(variable)
    expect(getVariableByIdCached('v-null', cache)).toBeNull()
    expect(getVariableById).not.toHaveBeenCalled()
  })

  it('writes through cache for misses, including absent variables', () => {
    const variable = { id: 'v-3', name: 'Accent' } as unknown as Variable
    const getVariableById = vi
      .fn<(id: string) => Variable | null>()
      .mockImplementation((id: string) => (id === 'v-3' ? variable : null))
    setFigmaVariableLookup({ getVariableById })

    const cache = new Map<string, Variable | null>()

    expect(getVariableByIdCached('v-3', cache)).toBe(variable)
    expect(cache.get('v-3')).toBe(variable)

    expect(getVariableByIdCached('v-missing', cache)).toBeNull()
    expect(cache.get('v-missing')).toBeNull()

    expect(getVariableById).toHaveBeenCalledTimes(2)
  })
})
