import { describe, expect, it } from 'vitest'

import {
  camelToKebab,
  escapeJsSingleQuotedString,
  escapeJsTemplateLiteralText,
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

  it('escapes JavaScript single-quoted string content', () => {
    expect(escapeJsSingleQuotedString(String.raw`C:\temp\fonts\'Open Sans'`)).toBe(
      String.raw`C:\\temp\\fonts\\\'Open Sans\'`
    )
    expect(escapeJsSingleQuotedString('line1\nline2\rline3')).toBe('line1\\nline2\\rline3')
  })

  it('escapes JavaScript template literal text content', () => {
    const input = ['\\', '${', 'literal}', ' ', '\\', '`', 'tail', '\\', '`'].join('')

    expect(escapeJsTemplateLiteralText(input)).toBe('\\\\\\${literal} \\\\\\`tail\\\\\\`')
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
