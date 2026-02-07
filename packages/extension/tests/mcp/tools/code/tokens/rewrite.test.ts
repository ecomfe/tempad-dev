import { describe, expect, it } from 'vitest'

import { filterBridge, rewriteTokenNamesInCode } from '@/mcp/tools/code/tokens/rewrite'

describe('mcp/code tokens rewrite', () => {
  it('rewrites matched token names while preserving token boundaries', () => {
    const code = 'rounded-2xl color-red color-red-1 xcolor-red'
    const out = rewriteTokenNamesInCode(
      code,
      new Map([
        ['rounded-2xl', 'radius-2xl'],
        ['color-red', 'brand-red'],
        ['color-red-1', 'brand-red-1']
      ])
    )

    expect(out).toBe('radius-2xl brand-red brand-red-1 xcolor-red')
  })

  it('returns source code unchanged when rewrite map is empty', () => {
    const code = 'color-red'
    expect(rewriteTokenNamesInCode(code, new Map())).toBe(code)
  })

  it('returns source code unchanged when rewrite regex cannot be built', () => {
    const code = 'color-red'
    expect(rewriteTokenNamesInCode(code, new Map([['', 'ignored']]))).toBe(code)
  })

  it('filters bridge map to used names only', () => {
    const bridge = new Map([
      ['a', 'id-a'],
      ['b', 'id-b'],
      ['empty', '']
    ])

    expect(filterBridge(bridge, new Set(['b', 'c']))).toEqual(new Map([['b', 'id-b']]))
    expect(filterBridge(bridge, new Set(['empty']))).toEqual(new Map())
  })
})
