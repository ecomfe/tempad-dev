import { describe, expect, it } from 'vitest'

import { parseNumber, toDecimalPlace } from '@/utils/number'

describe('utils/number', () => {
  it('parses finite numbers and rejects empty/non-finite values', () => {
    expect(parseNumber('42')).toBe(42)
    expect(parseNumber('  3.5  ')).toBe(3.5)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber('Infinity')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })

  it('rounds to decimal place with string and number inputs', () => {
    expect(toDecimalPlace(1.23456)).toBe(1.235)
    expect(toDecimalPlace('1.23456', 2)).toBe(1.23)
    expect(toDecimalPlace('bad')).toBe(0)
    expect(toDecimalPlace('', 4)).toBe(0)
  })
})
