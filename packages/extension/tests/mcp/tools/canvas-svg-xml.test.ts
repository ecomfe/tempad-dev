import { describe, expect, it } from 'vitest'

import { parseSvgXml, stringifySvgXml } from '@/mcp/tools/canvas/svg-xml'

describe('canvas SVG XML semantics', () => {
  it('decodes XML entities and numeric references exactly once in attributes and text', () => {
    const root = parseSvgXml(
      '<svg><use href="&#35;shape"/><text aria-label="&quot;&apos;&lt;&gt;&amp;">A&amp;B &lt;safe&gt; &#65;&#x1F642; &amp;lt;</text></svg>'
    )
    expect(root.children[0]?.attributes.href).toBe('#shape')
    expect(root.children[1]?.attributes['aria-label']).toBe(`"'<>&`)
    expect(root.children[1]?.children[0]?.value).toBe('A&B <safe> A🙂 &lt;')
    expect(parseSvgXml(stringifySvgXml(root))).toEqual(root)
  })

  it('keeps CDATA literal while ignoring CDATA markers and entities inside comments', () => {
    const root = parseSvgXml(
      '<svg><!-- <![CDATA[&unknown;]]> --><text><![CDATA[&amp;<literal>&unknown;]]></text></svg>'
    )
    expect(root.children).toHaveLength(1)
    expect(root.children[0]?.children[0]?.value).toBe('&amp;<literal>&unknown;')
    expect(parseSvgXml(stringifySvgXml(root))).toEqual(root)
  })

  it.each([' ', '<![CDATA[ ]]>', '\u00a0'])('preserves whitespace-only XML text: %j', (text) => {
    const root = parseSvgXml(`<svg><text xml:space="preserve">${text}</text></svg>`)
    expect(root.children[0]?.children[0]?.value).toBe(text === '\u00a0' ? '\u00a0' : ' ')
    expect(parseSvgXml(stringifySvgXml(root))).toEqual(root)
  })

  it('serializes every CDATA closing sequence as ordinary escaped text', () => {
    const root = parseSvgXml('<svg><text>one]]&gt;two]]&gt;three</text></svg>')
    expect(root.children[0]?.children[0]?.value).toBe('one]]>two]]>three')
    expect(stringifySvgXml(root)).toBe('<svg><text>one]]&gt;two]]&gt;three</text></svg>')
    expect(parseSvgXml(stringifySvgXml(root))).toEqual(root)
  })

  it('normalizes literal XML whitespace while preserving character-reference whitespace', () => {
    const root = parseSvgXml(
      '<svg aria-label="one\r\n\ttwo&#10;&#13;&#9;three"><text>A\rB\r\nC&#13;</text></svg>'
    )
    expect(root.attributes['aria-label']).toBe('one  two\n\r\tthree')
    expect(root.children[0]?.children[0]?.value).toBe('A\nB\nC\r')
    expect(stringifySvgXml(root)).toContain('aria-label="one  two&#10;&#13;&#9;three"')
    expect(parseSvgXml(stringifySvgXml(root))).toEqual(root)
  })

  it.each([
    '&unknown;',
    'R&D',
    '&amp',
    '&#x;',
    '&#12oops;',
    '&#X41;',
    '&#0;',
    '&#xD800;',
    '&#x110000;',
    '&#xFFFE;',
    '\u0000',
    '\u000B',
    '\uD800'
  ])('rejects malformed references or invalid XML characters: %j', (value) => {
    expect(() => parseSvgXml(`<svg><text>${value}</text></svg>`)).toThrow()
    expect(() => parseSvgXml(`<svg aria-label="${value}"/>`)).toThrow()
  })

  it.each([
    '<svg><!-- unfinished > <text>Hidden</text></svg>',
    '<svg><![CDATA[unfinished</svg>',
    '<'.repeat(1_000)
  ])('rejects incomplete lexical sections', (source) => {
    expect(() => parseSvgXml(source)).toThrow()
  })
})
