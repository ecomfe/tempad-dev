import { describe, expect, it } from 'vitest'

import {
  camelToKebab,
  escapeJsSingleQuotedString,
  escapeJsTemplateLiteralText,
  escapeHTML,
  indentAll,
  kebabToCamel,
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

  it('round-trips own dictionary keys without changing object prototypes', () => {
    const input = JSON.parse(
      '{"__proto__":{"label":"Root"},"constructor":"constructor","prototype":"prototype","rows":[{"__proto__":"Nested","quoted-key":"Text"}],"text":"__proto__: value"}'
    )
    const output = new Function(`return (${stringify(input)})`)()

    expect(output).toEqual(input)
    expect(Object.keys(output)).toEqual(Object.keys(input))
    expect(Object.hasOwn(output, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
    expect(Object.hasOwn(output.rows[0], '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(output.rows[0])).toBe(Object.prototype)
  })

  it('preserves data keys, leaf values and indentation in nested containers', () => {
    const symbol = Symbol.for('token')
    const input = Object.assign(Object.create(null), {
      'quoted-key': "line\n'quoted'",
      default: true,
      名称: 'value',
      [symbol]: 12,
      empty: {},
      list: [],
      date: new Date('2026-01-01T00:00:00.000Z'),
      pattern: /title/gi,
      callback: (value: number) => value + 1
    })
    Object.defineProperty(input, 'hidden', { value: 'omit' })
    const output = new Function(`return (${stringify(input)})`)()

    expect(output['quoted-key']).toBe(input['quoted-key'])
    expect(output.default).toBe(true)
    expect(output.名称).toBe('value')
    expect(output[symbol]).toBe(12)
    expect(output.empty).toEqual({})
    expect(output.list).toEqual([])
    expect(output.date).toEqual(input.date)
    expect(output.pattern).toEqual(input.pattern)
    expect(output.callback(4)).toBe(5)
    expect(output).not.toHaveProperty('hidden')
    expect(stringify({ nested: { value: null, unset: undefined } })).toBe(
      '{\n  nested: {\n    value: null,\n    unset: undefined\n  }\n}'
    )
  })

  it('marks recursive containers while preserving repeated non-circular values', () => {
    const shared = { value: 1 }
    const input: Record<string, unknown> = { first: shared, second: shared }
    input.self = input
    const array: unknown[] = []
    array.push(array)
    input.array = array

    expect(new Function(`return (${stringify(input)})`)()).toEqual({
      first: { value: 1 },
      second: { value: 1 },
      self: '[Circular]',
      array: ['[Circular]']
    })
  })

  it('preserves multiline function values inside nested non-plain containers', () => {
    const callback = new Function('return `first\nsecond`')
    const input = { nested: { map: new Map([['callback', callback]]), set: new Set([callback]) } }
    const output = new Function(`return (${stringify(input)})`)()

    expect(output.nested.map.get('callback')()).toBe('first\nsecond')
    expect([...output.nested.set][0]()).toBe('first\nsecond')
  })

  it('indents all lines with optional first-line skip', () => {
    const multi = 'line1\nline2'
    expect(indentAll(multi, '  ')).toBe('  line1\n  line2')
    expect(indentAll(multi, '--', true)).toBe('line1\n--line2')
  })
})
