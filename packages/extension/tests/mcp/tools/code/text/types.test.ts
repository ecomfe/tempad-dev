import { describe, expect, it } from 'vitest'

import {
  CODE_FONT_KEYWORDS,
  HOIST_ALLOWLIST,
  MARK_PRIORITY,
  MARK_WEIGHTS,
  PARAGRAPH_BREAK_RE,
  REQUESTED_SEGMENT_FIELDS,
  TYPO_FIELDS
} from '@/mcp/tools/code/text/types'

describe('text/types constants', () => {
  it('keeps mark ordering and weight mapping in sync', () => {
    expect(MARK_PRIORITY).toEqual(['link', 'code', 'bold', 'italic', 'strike', 'underline'])

    for (const [index, mark] of MARK_PRIORITY.entries()) {
      expect(MARK_WEIGHTS[mark]).toBe(index)
    }
  })

  it('defines expected hoistable style keys and code font hints', () => {
    expect(Array.from(HOIST_ALLOWLIST).sort()).toEqual(
      [
        'color',
        'font-family',
        'font-size',
        'letter-spacing',
        'line-height',
        'text-align',
        'text-transform'
      ].sort()
    )

    expect(CODE_FONT_KEYWORDS).toEqual([
      'mono',
      'code',
      'consolas',
      'menlo',
      'courier',
      'source code'
    ])
  })

  it('keeps typography and requested-segment field contracts stable', () => {
    expect(TYPO_FIELDS).toEqual([
      'fontFamily',
      'fontStyle',
      'fontWeight',
      'fontSize',
      'lineHeight',
      'letterSpacing',
      'paragraphSpacing',
      'paragraphIndent'
    ])

    expect(REQUESTED_SEGMENT_FIELDS).toEqual([
      'fontName',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'lineHeight',
      'letterSpacing',
      'textCase',
      'textDecoration',
      'textDecorationStyle',
      'textDecorationOffset',
      'textDecorationThickness',
      'textDecorationColor',
      'textDecorationSkipInk',
      'paragraphSpacing',
      'paragraphIndent',
      'indentation',
      'listOptions',
      'fills',
      'textStyleId',
      'fillStyleId',
      'boundVariables',
      'hyperlink'
    ])
  })

  it('matches hard paragraph separators and preserves soft line breaks', () => {
    const text = 'a\r\nb\nc\rd\u2028e\u2029f'
    expect(text.split(PARAGRAPH_BREAK_RE)).toEqual(['a', 'b', 'c', 'd\u2028e', 'f'])
  })
})
