import { describe, expect, it } from 'vitest'

import {
  buildTokenRegex,
  createTokenMatcher,
  extractTokenNames
} from '@/mcp/tools/code/tokens/extract'

describe('mcp/code tokens extract', () => {
  it('builds regex with token boundary checks', () => {
    expect(buildTokenRegex()).toBeNull()
    expect(buildTokenRegex(new Set())).toBeNull()
    expect(buildTokenRegex(new Set(['']))).toBeNull()

    const tokenRe = buildTokenRegex(new Set(['color-red', 'color-red-1']), true)
    expect(tokenRe).not.toBeNull()
    expect('color-red-1'.match(tokenRe!)).toEqual(['color-red-1'])
    expect('xcolor-red'.match(tokenRe!)).toBeNull()

    const specialRe = buildTokenRegex(new Set(['a+b', 'x.y']))
    expect(specialRe?.flags).toBe('')
    expect('a+b'.match(specialRe!)?.[2]).toBe('a+b')
    expect('x.y'.match(specialRe!)?.[2]).toBe('x.y')
  })

  it('extracts tokens from plain css variable strings when token set is not provided', () => {
    const names = extractTokenNames('var(--radius-lg) var(--color-primary)')
    expect(names).toEqual(new Set(['--radius-lg', '--color-primary']))

    expect(extractTokenNames('', new Set(['token']))).toEqual(new Set())
    expect(extractTokenNames('plain-text', new Set(['token']))).toEqual(new Set())
  })

  it('extracts configured token names with global regex scanning', () => {
    const names = extractTokenNames(
      'rounded-2xl and color-red-1 and color-red and color-red',
      new Set(['rounded-2xl', 'color-red', 'color-red-1'])
    )
    expect(names).toEqual(new Set(['rounded-2xl', 'color-red-1', 'color-red']))
    expect(extractTokenNames('rounded-2xl', new Set(['']))).toEqual(new Set())
  })

  it('creates token matcher function with safe fallback', () => {
    const fallbackMatcher = createTokenMatcher()
    expect(fallbackMatcher('anything')).toBe(false)

    const matcher = createTokenMatcher(new Set(['token-a']))
    expect(matcher(' token-a ')).toBe(true)
    expect(matcher('xtoken-a')).toBe(false)
    expect(matcher('')).toBe(false)
  })
})
