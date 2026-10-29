import { describe, expect, it } from 'vitest'

import { canonicalVectorPaths, vectorPathsEqual } from '@/mcp/tools/canvas/vector'

describe('canvas vector canonicalization', () => {
  it('rejects overflow in derived cubic controls before native mutation', () => {
    const paths = [{ windingRule: 'NONZERO', data: 'M -1e308 0 Q 1e308 0 0 0' }] as const
    expect(() => canonicalVectorPaths(paths)).toThrow(/finite/)
  })

  it('keeps equivalent quadratic and cubic paths equal across subpaths', () => {
    const desired = [{ windingRule: 'EVENODD', data: 'M -0 0 Q 3 3 6 0 Z M 0 0 L 4 4' }] as const
    const canonical = canonicalVectorPaths(desired)
    expect(canonical[0]?.data).toBe('M 0 0 C 2 2 4 2 6 0 Z M 0 0 L 4 4')
    expect(vectorPathsEqual(canonical, desired)).toBe(true)
    expect(vectorPathsEqual([{ windingRule: 'NONZERO', data: canonical[0]!.data }], desired)).toBe(
      false
    )
    expect(
      vectorPathsEqual([{ windingRule: 'EVENODD', data: 'M 0 0 L Infinity 0' }], desired)
    ).toBe(false)
  })
})
