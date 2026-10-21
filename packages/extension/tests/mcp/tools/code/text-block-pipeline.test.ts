import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'
import { REQUESTED_SEGMENT_FIELDS } from '@/mcp/tools/code/text/types'
import { options } from '@/ui/state'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

beforeEach(() => {
  Object.assign(options.value, { cssUnit: 'px', rootFontSize: 16, scale: 1 })
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: { getVariableById: () => null, getVariableCollectionById: () => null },
    getStyleById: () => null
  })
})

afterEach(() => vi.unstubAllGlobals())

function createText(
  listTypes: Array<'NONE' | 'ORDERED' | 'UNORDERED'>,
  indentations: number[] = [],
  paragraphs: Array<
    Partial<Pick<StyledTextSegment, 'characters' | 'paragraphIndent' | 'paragraphSpacing'>>
  > = []
): TextNode {
  const fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
  let offset = 0
  const segments = listTypes.map((type, index) => {
    const label =
      paragraphs[index]?.characters ??
      ['First', 'Second', 'Third', 'Fourth'][index] ??
      `Item ${index + 1}`
    const characters = `${label}${index < listTypes.length - 1 ? '\n' : ''}`
    const start = offset
    offset += characters.length
    return {
      characters,
      start,
      end: offset,
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      fontWeight: 400,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      textDecoration: 'NONE',
      listOptions: { type },
      indentation: indentations[index] ?? 1,
      paragraphIndent: paragraphs[index]?.paragraphIndent ?? 0,
      paragraphSpacing: paragraphs[index]?.paragraphSpacing ?? 0,
      fills
    }
  })
  return {
    id: 'text',
    type: 'TEXT',
    name: 'Text blocks',
    characters: segments.map(({ characters }) => characters).join(''),
    visible: true,
    x: 0,
    y: 0,
    width: 472,
    height: 80,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 472, height: 80 },
    absoluteRenderBounds: { x: 0, y: 0, width: 472, height: 80 },
    fills,
    strokes: [],
    effects: [],
    getRangeBoundVariable: () => null,
    getStyledTextSegments: (fields: Array<keyof StyledTextSegment>) =>
      segments.map(({ characters, start, end, ...values }) => ({
        characters,
        start,
        end,
        ...Object.fromEntries(fields.map((field) => [field, values[field as keyof typeof values]]))
      })),
    getCSSAsync: async () => ({ width: '472px', height: '80px' })
  } as unknown as TextNode
}

describe.each(['jsx', 'vue'] as const)('%s native text blocks', (lang) => {
  it.each([
    { paragraphIndent: 12, paragraphSpacing: 0 },
    { paragraphIndent: 0, paragraphSpacing: 12 },
    { paragraphIndent: 12, paragraphSpacing: 12 }
  ])('preserves paragraph metrics $paragraphIndent/$paragraphSpacing', async (metrics) => {
    const node = createText(
      ['NONE', 'NONE'],
      [],
      [
        { characters: 'Hello', ...metrics },
        { characters: 'world', ...metrics }
      ]
    )
    const result = await handleGetCode([node], lang)
    const paragraphs = [...result.code.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
    expect(paragraphs).toHaveLength(2)
    expect(result.code).toMatch(/^<div\b/)
    expect(paragraphs[0]![2]).toContain('Hello')
    expect(paragraphs[1]![2]).toContain('world')
    for (const paragraph of paragraphs) {
      if (metrics.paragraphIndent) expect(paragraph[1]).toContain('indent-[12px]')
      expect(paragraph[2]).not.toMatch(/<(?:p|br)\b/)
    }
    if (metrics.paragraphSpacing) expect(paragraphs[0]![1]).toContain('mb-[12px]')
    expect(paragraphs[1]![1]).not.toContain('mb-')
  })

  it('preserves mixed paragraph metrics without applying a trailing gap', async () => {
    const node = createText(
      ['NONE', 'NONE', 'NONE'],
      [],
      [
        { paragraphIndent: 12, paragraphSpacing: 8 },
        { paragraphIndent: 0, paragraphSpacing: 20 },
        { paragraphIndent: 24, paragraphSpacing: 30 }
      ]
    )
    const result = await handleGetCode([node], lang)
    const paragraphs = [...result.code.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]![1]).toContain('indent-[12px]')
    expect(paragraphs[0]![1]).toContain('mb-[8px]')
    expect(paragraphs[1]![1]).toContain('indent-[0]')
    expect(paragraphs[1]![1]).toContain('mb-[20px]')
    expect(paragraphs[2]![1]).toContain('indent-[24px]')
    expect(paragraphs[2]![1]).not.toContain('mb-')
  })

  it.each(['ORDERED', 'UNORDERED'] as const)(
    'applies spacing after a %s list only when another block follows',
    async (listType) => {
      const trailing = await handleGetCode(
        [
          createText(
            ['NONE', listType, listType],
            [],
            [{}, { paragraphSpacing: 12 }, { paragraphSpacing: 12 }]
          )
        ],
        lang
      )
      expect(trailing.code.match(/<[ou]l\b[^>]*>/)?.[0]).not.toContain('mb-')

      const followed = await handleGetCode(
        [createText([listType, 'NONE'], [], [{ paragraphSpacing: 12 }])],
        lang
      )
      expect(followed.code.match(/<[ou]l\b[^>]*>/)?.[0]).toContain('mb-[12px]')
    }
  )

  it.each([' ', '\t  '])('retains a whitespace-only paragraph containing %j', async (blank) => {
    const compact = await handleGetCode(
      [createText(['NONE'], [], [{ characters: `Hello\n${blank}` }])],
      lang
    )
    expect(compact.code.match(/<br\s*\/?>/g)).toHaveLength(2)

    const spaced = await handleGetCode(
      [createText(['NONE'], [], [{ characters: `Hello\n${blank}\nworld`, paragraphSpacing: 12 }])],
      lang
    )
    const paragraphs = [...spaced.code.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[1]![2]).toContain('<br')
    expect(paragraphs[1]![1]).toContain('mb-[12px]')

    const list = await handleGetCode(
      [createText(['ORDERED'], [], [{ characters: `Hello\n${blank}` }])],
      lang
    )
    expect(list.code.match(/<li\b[^>]*>/g)).toHaveLength(2)
    expect(list.code.match(/<br\s*\/?>/g)).toHaveLength(1)
  })

  it.each(['\u00a0', '\u200b'])(
    'keeps the existing line box of %j without another break',
    async (blank) => {
      for (const listType of ['NONE', 'ORDERED'] as const) {
        const result = await handleGetCode(
          [createText([listType], [], [{ characters: `Hello\n${blank}` }])],
          lang
        )
        expect(result.code).toContain(blank)
        expect(result.code.match(/<br\s*\/?>/g) ?? []).toHaveLength(listType === 'NONE' ? 1 : 0)
      }
    }
  )

  it.each(['NONE', 'UNORDERED'] as const)(
    'retains a trailing empty soft line in an unindented %s block',
    async (listType) => {
      const node = createText([listType], [], [{ characters: 'Hello\u2028 \t ' }])
      const result = await handleGetCode([node], lang)
      expect(result.code).toContain('Hello')
      expect(result.code.match(/<br\s*\/?>/g)).toHaveLength(2)
      expect(result.code).not.toContain('indent-')
    }
  )

  it('does not add an extra line when a compact hard break follows a soft break', async () => {
    const node = createText(['NONE', 'NONE'], [], [{ characters: 'Hello\u2028' }])
    const result = await handleGetCode([node], lang)
    expect(result.code.match(/<br\s*\/?>/g)).toHaveLength(2)
  })

  it('hoists common paragraph styles while keeping local color and indent overrides', async () => {
    const node = createText(
      ['NONE', 'NONE'],
      [],
      [{ paragraphIndent: 12, paragraphSpacing: 12 }, { paragraphIndent: 0 }]
    )
    const segments = node.getStyledTextSegments(REQUESTED_SEGMENT_FIELDS)
    segments[1]!.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
    Object.assign(node, {
      getStyledTextSegments: () => segments,
      getCSSAsync: async () => ({ width: '472px', height: '80px', 'text-indent': '12px' })
    })
    const result = await handleGetCode([node], lang)
    for (const commonClass of ['font-[Inter]', 'text-[16px]', 'leading-[24px]']) {
      expect(result.code.split(commonClass)).toHaveLength(2)
    }
    expect(result.code).toContain('text-[#F00]')
    expect(result.code.match(/<p\b[^>]*>/g)?.[1]).toContain('indent-[0]')
  })

  it('keeps a soft break inside an indented paragraph', async () => {
    const node = createText(
      ['NONE', 'NONE'],
      [],
      [
        { characters: 'Hello\u2028world', paragraphIndent: 12, paragraphSpacing: 8 },
        { characters: 'Next', paragraphIndent: 12, paragraphSpacing: 8 }
      ]
    )
    const result = await handleGetCode([node], lang)
    const paragraphs = [...result.code.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]![2]).toMatch(/<span\b[^>]*\bblock\b[^>]*>Hello<\/span>/)
    expect(paragraphs[0]![2]).toMatch(/<span\b[^>]*\bblock\b[^>]*>world<\/span>/)
    expect(paragraphs[0]![2]).not.toContain('<br')
    expect(paragraphs[0]![1]).toContain('mb-[8px]')
    expect(paragraphs[1]![1]).not.toContain('mb-')
    expect(result.code).not.toContain('\u2028')
  })

  it.each([
    { characters: '\u2028Hello', lineCount: 2, blankCount: 1 },
    { characters: 'Hello\u2028', lineCount: 2, blankCount: 1 },
    { characters: 'Hello\u2028\u2028world', lineCount: 3, blankCount: 1 },
    { characters: 'Hello\u2028 \t \u2028world', lineCount: 3, blankCount: 1 }
  ])(
    'retains empty indented soft lines in $characters',
    async ({ characters, lineCount, blankCount }) => {
      const node = createText(
        ['NONE'],
        [],
        [{ characters, paragraphIndent: 12, paragraphSpacing: 8 }]
      )
      const result = await handleGetCode([node], lang)
      expect(result.code.match(/<p\b/g)).toHaveLength(1)
      expect(result.code.match(/<span\b[^>]*\bblock\b/g)).toHaveLength(lineCount)
      expect(result.code.match(/<br\s*\/?>/g)).toHaveLength(blankCount)
      expect(result.code).not.toContain('mb-')
    }
  )

  it('keeps styled links across forced lines and segment boundaries', async () => {
    const node = createText(['NONE'], [], [{ characters: 'He\u2028world', paragraphIndent: 12 }])
    const segment = node.getStyledTextSegments(REQUESTED_SEGMENT_FIELDS)[0]!
    const hyperlink = { type: 'URL', value: 'https://example.com' } as const
    Object.assign(node, {
      getStyledTextSegments: () => [
        { ...segment, characters: 'He\u2028', start: 0, end: 3, fontWeight: 700, hyperlink },
        { ...segment, characters: 'wo', start: 3, end: 5, fontWeight: 700, hyperlink },
        { ...segment, characters: 'rld', start: 5, end: 8, hyperlink }
      ]
    })
    const result = await handleGetCode([node], lang)
    expect(result.code.match(/<span\b[^>]*\bblock\b/g)).toHaveLength(2)
    expect(result.code.match(/href="https:\/\/example.com"/g)).toHaveLength(2)
    expect(result.code).toMatch(/<strong\b[^>]*>He<\/strong>/)
    expect(result.code).toMatch(/<strong\b[^>]*>wo<\/strong>/)
    expect(result.code).toContain('rld')
    expect(result.code).not.toContain('<br')
  })

  it('inherits scaled rem indentation on forced lines without scaling twice', async () => {
    Object.assign(options.value, { cssUnit: 'rem', scale: 2 })
    const node = createText(['NONE'], [], [{ characters: 'Hello\u2028world', paragraphIndent: 12 }])
    const result = await handleGetCode([node], lang)
    expect(result.code.match(/indent-\[1\.5rem\]/g)).toHaveLength(1)
    expect(result.code.match(/<span\b[^>]*\bblock\b/g)).toHaveLength(2)
    expect(result.code).not.toContain('indent-[3rem]')
  })

  it('keeps paragraph geometry around a list in legal sibling blocks', async () => {
    const node = createText(
      ['NONE', 'UNORDERED', 'NONE'],
      [],
      [
        { paragraphIndent: 12, paragraphSpacing: 8 },
        { characters: 'Item\u2028continuation' },
        { paragraphIndent: 24 }
      ]
    )
    const result = await handleGetCode([node], lang)
    expect(result.code).toMatch(/^<div\b/)
    expect(result.code).toMatch(/<p\b[^>]*mb-\[8px\][\s\S]*First[\s\S]*<\/p>\s*<ul\b/)
    expect(result.code.match(/<li\b/g)).toHaveLength(1)
    expect(result.code).toMatch(/Item[\s\S]*<br\s*\/?>(?:[\s\S]*)continuation/)
    expect(result.code).toMatch(/<\/ul>\s*<p\b[^>]*indent-\[24px\]/)
  })

  it('retains an empty paragraph between paragraphs with spacing', async () => {
    const node = createText(
      ['NONE', 'NONE', 'NONE'],
      [],
      [
        { characters: 'Hello', paragraphSpacing: 12 },
        { characters: '', paragraphSpacing: 12 },
        { characters: 'world', paragraphSpacing: 12 }
      ]
    )
    const result = await handleGetCode([node], lang)
    const paragraphs = [...result.code.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[1]![2]).toMatch(/^\s*<br\s*\/?>\s*$/)
    expect(paragraphs[1]![1]).toContain('mb-[12px]')
    expect(paragraphs[2]![1]).not.toContain('mb-')
  })

  it.each(['Hello\n', 'Hello\n\n', '\n', 'Hello\r\n', 'Hello\u2029'])(
    'retains terminal hard paragraphs in %j',
    async (characters) => {
      const paragraphCount = characters.split(/\r\n|[\n\r\u2029]/).length
      const node = createText(
        ['NONE'],
        [],
        [{ characters, paragraphIndent: 12, paragraphSpacing: 12 }]
      )
      const result = await handleGetCode([node], lang)
      const paragraphs = [...result.code.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
      expect(paragraphs).toHaveLength(paragraphCount)
      expect(paragraphs.at(-1)![2]).toMatch(/^\s*<br\s*\/?>\s*$/)
      expect(paragraphs.at(-1)![1]).not.toContain('mb-')
      for (const paragraph of paragraphs.slice(0, -1)) {
        expect(paragraph[1]).toContain('mb-[12px]')
      }
      for (const paragraph of paragraphs) expect(paragraph[1]).toContain('indent-[12px]')
    }
  )

  it.each(['Hello\n', 'Hello\n\n', '\n'])(
    'retains the final compact line box in %j',
    async (characters) => {
      const result = await handleGetCode([createText(['NONE'], [], [{ characters }])], lang)
      expect(result.code).toMatch(/^<p\b/)
      expect(result.code.match(/<br\s*\/?>/g)).toHaveLength(characters.split('\n').length)
      expect(result.code).toMatch(/<br\s*\/?>\s*<\/p>$/)
    }
  )

  it.each(['ORDERED', 'UNORDERED'] as const)(
    'retains empty terminal %s items without adding an external gap',
    async (listType) => {
      for (const characters of ['Hello\n', 'Hello\n\n']) {
        const node = createText([listType], [], [{ characters, paragraphSpacing: 12 }])
        const result = await handleGetCode([node], lang)
        const items = [...result.code.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
        expect(items).toHaveLength(characters.split('\n').length)
        expect(items[0]![1]).toContain('Hello')
        for (const item of items.slice(1)) expect(item[1]).toMatch(/^\s*<br\s*\/?>\s*$/)
        expect(result.code).not.toContain('mb-')
      }
    }
  )

  it('keeps a list and ordinary text inside a legal layout container without a plugin', async () => {
    const result = await handleGetCode([createText(['UNORDERED', 'NONE'])], lang)
    expect(result.codegen.plugin).toBe('none')
    expect(result.code).toMatch(/^<div\b[^>]*w-\[472px\][^>]*h-\[80px\]/)
    expect(result.code).toMatch(/<ul\b[\s\S]*<li\b[^>]*>First<\/li>[\s\S]*<\/ul>/)
    expect(result.code.trim()).toMatch(/<\/ul>[\s\S]*<span\b[^>]*>Second<\/span>\s*<\/div>$/)
    expect(result.code).not.toContain('<p')
  })

  it('keeps adjacent ordered and unordered lists as siblings', async () => {
    const result = await handleGetCode([createText(['ORDERED', 'UNORDERED'])], lang)
    expect(result.code).toMatch(/^<div\b/)
    expect(result.code).toMatch(/<ol\b[\s\S]*First<\/li>[\s\S]*<\/ol>[\s\S]*<ul\b/)
    expect(result.code.trim()).toMatch(/Second<\/li>[\s\S]*<\/ul>\s*<\/div>$/)
    expect(result.code).not.toContain('<p')
  })

  it.each([
    {
      types: ['UNORDERED', 'ORDERED', 'UNORDERED'] as const,
      indents: [1, 2, 1],
      markup: '<ul><li>First<ol><li>Second</li></ol></li><li>Third</li></ul>'
    },
    {
      types: ['UNORDERED', 'ORDERED', 'UNORDERED', 'UNORDERED'] as const,
      indents: [1, 2, 2, 1],
      markup:
        '<ul><li>First<ol><li>Second</li></ol><ul><li>Third</li></ul></li><li>Fourth</li></ul>'
    },
    {
      types: ['UNORDERED', 'ORDERED', 'UNORDERED', 'UNORDERED'] as const,
      indents: [0, 1, 1, 0],
      markup:
        '<ul><li>First<ol><li>Second</li></ol><ul><li>Third</li></ul></li><li>Fourth</li></ul>'
    },
    {
      types: ['ORDERED', 'UNORDERED', 'ORDERED', 'UNORDERED'] as const,
      indents: [1, 2, 3, 2],
      markup:
        '<ol><li>First<ul><li>Second<ol><li>Third</li></ol></li><li>Fourth</li></ul></li></ol>'
    },
    {
      types: ['UNORDERED', 'UNORDERED', 'ORDERED'] as const,
      indents: [1, 0, 1],
      markup: '<ul><li><ul><li>First</li></ul></li><li>Second<ol><li>Third</li></ol></li></ul>'
    },
    {
      types: ['UNORDERED', 'ORDERED', 'UNORDERED', 'ORDERED'] as const,
      indents: [1, 2, 0, 1],
      markup:
        '<ul><li><ul><li>First<ol><li>Second</li></ol></li></ul></li><li>Third<ol><li>Fourth</li></ol></li></ul>'
    },
    {
      types: ['ORDERED', 'ORDERED', 'ORDERED'] as const,
      indents: [2, 1, 2],
      markup: '<ol><li><ol><li>First</li></ol></li><li>Second<ol><li>Third</li></ol></li></ol>'
    },
    {
      types: ['ORDERED', 'ORDERED', 'ORDERED', 'ORDERED'] as const,
      indents: [3, 2, 1, 2],
      markup:
        '<ol><li><ol><li><ol><li>First</li></ol></li><li>Second</li></ol></li><li>Third<ol><li>Fourth</li></ol></li></ol>'
    },
    {
      types: ['ORDERED', 'ORDERED'] as const,
      indents: [2, 2],
      markup: '<ol><li><ol><li>First</li><li>Second</li></ol></li></ol>'
    },
    {
      types: ['ORDERED', 'ORDERED', 'ORDERED'] as const,
      indents: [1, 3, 1],
      markup: '<ol><li>First<ol><li><ol><li>Second</li></ol></li></ol></li><li>Third</li></ol>'
    },
    {
      types: ['ORDERED', 'UNORDERED'] as const,
      indents: [2, 1],
      markup: '<div><ol><li><ol><li>First</li></ol></li></ol><ul><li>Second</li></ul></div>'
    }
  ])('preserves nested list types and indentation $indents', async ({ types, indents, markup }) => {
    const result = await handleGetCode([createText([...types], indents)], lang)
    const structure = result.code
      .replace(/<\/?span\b[^>]*>/g, '')
      .replace(/<div\b[^>]*>/g, '<div>')
      .replace(/<(ul|ol|li)\b[^>]*>/g, '<$1>')
      .replace(/\s*(<\/?(?:div|ul|ol|li)>)\s*/g, '$1')
      .trim()
    expect(structure).toBe(markup)
    if (indents[0]! > Math.min(1, ...indents)) {
      expect(result.code.match(/<li\b[^>]*>/)?.[0]).toContain('list-none')
      if (types[0] === 'ORDERED') {
        expect(result.code.match(/<li\b[^>]*>/)?.[0]).toContain('value="0"')
      }
    }
  })

  it.each([
    {
      indents: [3, 2, 1, 2],
      markers: ['list-decimal', 'list-[lower-alpha]', 'list-[lower-roman]', 'list-[lower-alpha]']
    },
    { indents: [2, 2], markers: ['list-decimal', 'list-[lower-alpha]'] }
  ])('keeps marker styles at their native levels $indents', async ({ indents, markers }) => {
    const node = createText(
      indents.map(() => 'ORDERED'),
      indents
    )
    const result = await handleGetCode([node], lang)
    const classes = [...result.code.matchAll(/<ol\s[^>]*class(?:Name)?="([^"]*)"/g)]
    expect(classes.map((match) => match[1]!.split(' ')[0])).toEqual(markers)
  })

  it.each([
    { listTypes: ['UNORDERED'] as const, tag: 'ul' },
    { listTypes: ['NONE'] as const, tag: 'span' },
    { listTypes: ['NONE', 'NONE'] as const, tag: 'p' }
  ])('preserves a single $tag block and its layout props', async ({ listTypes, tag }) => {
    const result = await handleGetCode([createText([...listTypes])], lang)
    expect(result.code).toMatch(new RegExp(`^<${tag}\\b[^>]*w-\\[472px\\][^>]*h-\\[80px\\]`))
    expect(result.code.trim()).toMatch(new RegExp(`</${tag}>$`))
    expect(result.code).not.toContain('<div')
    expect(result.code).toContain('First')
    expect(result.code).not.toContain('indent-[')
    expect(result.code).not.toContain('mb-[')
  })
})
