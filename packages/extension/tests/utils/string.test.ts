import { describe, expect, it } from 'vitest'

import {
  camelToKebab,
  escapeHTML,
  indentAll,
  kebabToCamel,
  looseEscapeHTML,
  snakeToKebab,
  stringify,
  toPascalCase
} from '@/utils/string'

describe('utils/string', () => {
  it('converts naming styles', () => {
    expect(kebabToCamel('font-size-large')).toBe('fontSizeLarge')
    expect(camelToKebab('fontSizeLarge')).toBe('font-size-large')
    expect(snakeToKebab('HELLO_world_TEST')).toBe('hello-world-test')
    expect(toPascalCase('hello-world name_test')).toBe('HelloWorldNameTest')
  })

  it('escapes html variants', () => {
    expect(escapeHTML('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
    expect(looseEscapeHTML('say "hi"')).toBe('say &quot;hi&quot;')
  })

  it('stringifies values with stable indentation', () => {
    expect(stringify({ a: 1, nested: { b: true } })).toContain('nested')
    expect(stringify(['a', 'b'])).toContain("'a'")
  })

  it('indents all lines with optional first-line skip', () => {
    const multi = 'line1\nline2'
    expect(indentAll(multi, '  ')).toBe('  line1\n  line2')
    expect(indentAll(multi, '--', true)).toBe('line1\n--line2')
  })
})
