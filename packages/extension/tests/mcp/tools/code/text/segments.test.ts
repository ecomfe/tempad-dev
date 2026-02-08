import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StyledTextSegmentSubset } from '@/mcp/tools/code/text/types'

const mocks = vi.hoisted(() => ({
  resolveTokens: vi.fn(() => ({ typography: {}, fills: [] })),
  resolveRunAttrs: vi.fn((seg: StyledTextSegmentSubset) => ({
    ...((seg as SegmentInput).__attrs ?? {})
  })),
  inferFontWeight: vi.fn((styleName?: string | null, explicit?: number) => {
    if (typeof explicit === 'number') return explicit
    if (!styleName) return undefined
    if (/bold/i.test(styleName)) return 700
    return undefined
  }),
  isCodeFont: vi.fn((family: string) => family.toLowerCase().includes('mono'))
}))

vi.mock('@/mcp/tools/code/text/style', () => ({
  resolveTokens: mocks.resolveTokens,
  resolveRunAttrs: mocks.resolveRunAttrs,
  inferFontWeight: mocks.inferFontWeight,
  isCodeFont: mocks.isCodeFont
}))

import {
  buildTextBlocks,
  formatTextLiteral,
  getStyledSegments
} from '@/mcp/tools/code/text/segments'
import { REQUESTED_SEGMENT_FIELDS } from '@/mcp/tools/code/text/types'

type SegmentInput = StyledTextSegmentSubset & {
  __attrs?: Record<string, string>
}
type SegmentHyperlink = StyledTextSegmentSubset['hyperlink']

function createSegment(overrides: Partial<SegmentInput> = {}): SegmentInput {
  return {
    characters: 'T',
    start: 0,
    end: 1,
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    fontWeight: 400,
    fontStyle: undefined,
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    paragraphSpacing: 0,
    indentation: 1,
    listOptions: { type: 'NONE' },
    fills: [],
    textStyleId: null,
    fillStyleId: null,
    boundVariables: {},
    hyperlink: null,
    __attrs: {},
    ...overrides
  } as SegmentInput
}

describe('mcp/code text segments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads styled text segments safely', () => {
    expect(getStyledSegments({} as TextNode)).toBeNull()

    const ok = {
      getStyledTextSegments: vi.fn(() => [createSegment()])
    } as unknown as TextNode
    expect(getStyledSegments(ok)).toEqual([expect.objectContaining({ characters: 'T' })])
    expect(ok.getStyledTextSegments).toHaveBeenCalledWith(REQUESTED_SEGMENT_FIELDS)

    const notArray = {
      getStyledTextSegments: vi.fn(() => ({ not: 'array' }))
    } as unknown as TextNode
    expect(getStyledSegments(notArray)).toBeNull()

    const thrown = {
      getStyledTextSegments: vi.fn(() => {
        throw new Error('boom')
      })
    } as unknown as TextNode
    expect(getStyledSegments(thrown)).toBeNull()
  })

  it('formats literal text by trimming emptiness only', () => {
    expect(formatTextLiteral('')).toBeNull()
    expect(formatTextLiteral('  \n\t  ')).toBeNull()
    expect(formatTextLiteral('  keep me  ')).toBe('  keep me  ')
  })

  it('returns empty blocks for empty segments and handles newline-only segments', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    expect(buildTextBlocks(node, [])).toEqual([])

    const blocks = buildTextBlocks(node, [
      createSegment({
        characters: '\n',
        listOptions: { type: 'NONE' },
        paragraphSpacing: 12
      })
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'paragraph' })
    expect(blocks[0].lines).toHaveLength(1)
    expect(blocks[0].lines[0].runs).toEqual([])
    expect(blocks[0].lines[0].attrs).toMatchObject({
      listType: 'NONE',
      listSpacing: 0,
      paragraphSpacing: 12
    })
  })

  it('merges compatible runs with sticky whitespace and preserves link/url', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode
    const link = { type: 'URL', value: 'https://example.com' } as SegmentHyperlink

    const blocks = buildTextBlocks(node, [
      createSegment({
        characters: 'A',
        fontWeight: 700,
        fontStyle: 'ITALIC',
        textDecoration: 'UNDERLINE',
        hyperlink: link,
        __attrs: {
          color: '#f00',
          'font-size': '16px',
          'text-decoration-color': '#f00',
          'text-decoration-line': 'underline',
          'background-color': '#fff'
        }
      }),
      createSegment({
        characters: ' ',
        fontWeight: 400,
        textDecoration: 'NONE',
        hyperlink: link,
        __attrs: {
          color: '#0f0',
          'text-decoration-color': '#0f0',
          'text-decoration-line': 'underline',
          'background-color': '#000'
        }
      }),
      createSegment({
        characters: 'B',
        fontWeight: 700,
        fontStyle: 'ITALIC',
        textDecoration: 'UNDERLINE',
        hyperlink: link,
        __attrs: {
          color: '#f00',
          'font-size': '16px',
          'text-decoration-color': '#f00',
          'text-decoration-line': 'underline',
          'background-color': '#fff'
        }
      })
    ])

    expect(blocks).toHaveLength(1)
    const [run] = blocks[0].lines[0].runs
    expect(blocks[0].type).toBe('paragraph')
    expect(run.text).toBe('A B')
    expect(run.link).toBe('https://example.com')
    expect([...run.marks].sort()).toEqual(['bold', 'italic', 'link', 'underline'])
  })

  it('keeps incompatible runs separate across mark/attr/link differences', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    const blocks = buildTextBlocks(node, [
      createSegment({ characters: 'B', fontWeight: 700, __attrs: { a: '1' } }),
      createSegment({ characters: ' ', fontStyle: 'ITALIC', __attrs: { x: 'w' } }),
      createSegment({ characters: 'I', fontStyle: 'ITALIC', __attrs: { a: '1' } }),
      createSegment({ characters: 'I2', fontStyle: 'ITALIC', __attrs: { a: '1', b: '2' } }),
      createSegment({ characters: 'I3', fontStyle: 'ITALIC', __attrs: { a: '2', b: '2' } }),
      createSegment({ characters: 'I4', fontStyle: 'ITALIC', __attrs: { a: '2', b: '2' } }),
      createSegment({
        characters: 'L1',
        hyperlink: { type: 'URL', value: 'https://a.test' } as SegmentHyperlink,
        __attrs: { c: '1' }
      }),
      createSegment({
        characters: 'L2',
        hyperlink: { type: 'URL', value: 'https://b.test' } as SegmentHyperlink,
        __attrs: { c: '1' }
      }),
      createSegment({ characters: 'B2', fontWeight: 700, __attrs: { z: '1' } }),
      createSegment({ characters: 'I5', fontStyle: 'ITALIC', __attrs: { z: '1' } })
    ])

    const runs = blocks[0].lines[0].runs
    expect(runs.map((run) => run.text)).toEqual([
      'B',
      ' ',
      'I',
      'I2',
      'I3I4',
      'L1',
      'L2',
      'B2',
      'I5'
    ])
  })

  it('keeps whitespace run separate when mark count differs from previous run', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    const blocks = buildTextBlocks(node, [
      createSegment({ characters: 'A', fontWeight: 700, __attrs: { k: '1' } }),
      createSegment({ characters: ' ', __attrs: { k: '1' } }),
      createSegment({ characters: 'B', fontStyle: 'ITALIC', __attrs: { k: '1' } })
    ])

    expect(blocks[0].lines[0].runs.map((run) => run.text)).toEqual(['A', ' ', 'B'])
  })

  it('handles code-font, strikethrough and non-url hyperlinks', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    const blocks = buildTextBlocks(node, [
      createSegment({
        characters: 'Code',
        fontName: { family: 'JetBrains Mono', style: 'Regular' },
        textDecoration: 'STRIKETHROUGH',
        __attrs: { 'font-family': 'JetBrains Mono', color: '#999' }
      }),
      createSegment({
        characters: 'NodeLink',
        hyperlink: { type: 'NODE', value: '1:2' } as SegmentHyperlink,
        __attrs: { color: '#222' }
      })
    ])

    const runs = blocks[0].lines[0].runs
    expect(runs).toHaveLength(2)
    expect(runs[0].attrs['font-family']).toBeUndefined()
    expect([...runs[0].marks].sort()).toEqual(['code', 'strike'])
    expect(runs[1].link).toBeUndefined()
    expect(runs[1].marks.has('link')).toBe(true)
  })

  it('falls back to default weight and line attrs when list options are absent', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    mocks.resolveTokens.mockImplementationOnce(() => ({
      typography: {
        fontFamily: { id: 'font-family-token', name: 'Fira Mono' }
      },
      fills: []
    }))

    const blocks = buildTextBlocks(node, [
      createSegment({
        characters: 'Fallback',
        fontName: { family: '', style: '' },
        fontWeight: undefined,
        listOptions: undefined,
        indentation: 0,
        paragraphSpacing: undefined,
        __attrs: { 'font-family': 'Inter', color: '#111' }
      })
    ])

    const line = blocks[0].lines[0]
    expect(line.attrs).toMatchObject({
      listType: 'NONE',
      indentation: 0,
      listSpacing: 0,
      paragraphSpacing: 0
    })

    const [run] = line.runs
    expect(run.marks.has('code')).toBe(true)
    expect(run.marks.has('bold')).toBe(false)
    expect(run.attrs['font-family']).toBeUndefined()
  })

  it('keeps plain marks when no token font family and no segment family are provided', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    const blocks = buildTextBlocks(node, [
      createSegment({
        characters: 'Plain',
        fontName: { family: '', style: '' },
        fontWeight: undefined,
        __attrs: { 'font-family': 'Inter', color: '#111' }
      })
    ])

    const [run] = blocks[0].lines[0].runs
    expect(run.marks.has('code')).toBe(false)
    expect(run.marks.has('bold')).toBe(false)
    expect(run.attrs['font-family']).toBe('Inter')
  })

  it('groups ordered/unordered list lines into separate blocks', () => {
    const node = { getRangeBoundVariable: vi.fn() } as unknown as TextNode

    const blocks = buildTextBlocks(node, [
      createSegment({
        characters: 'One\nTwo\n',
        listOptions: { type: 'ORDERED' },
        paragraphSpacing: 8,
        indentation: 1,
        __attrs: { color: '#111' }
      }),
      createSegment({
        characters: 'Three\nFour',
        listOptions: { type: 'UNORDERED' },
        paragraphSpacing: 6,
        indentation: 2,
        __attrs: { color: '#222' }
      })
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('ordered-list')
    expect(blocks[0].lines).toHaveLength(2)
    expect(blocks[0].lines[0].attrs).toMatchObject({ listType: 'ORDERED', listSpacing: 8 })

    expect(blocks[1].type).toBe('unordered-list')
    expect(blocks[1].lines).toHaveLength(2)
    expect(blocks[1].lines[0].attrs).toMatchObject({ listType: 'UNORDERED', listSpacing: 6 })
  })
})
