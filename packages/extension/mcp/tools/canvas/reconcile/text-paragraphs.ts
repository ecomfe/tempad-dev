import type { CanvasFigmaTextRange } from '@tempad-dev/shared'

import { textParagraphRanges, type TextRange } from './text-ranges'

const PARAGRAPH_FIELDS = [
  'paragraphIndent',
  'paragraphSpacing',
  'listSpacing',
  'textWrapStyle'
] as const
type ParagraphField = (typeof PARAGRAPH_FIELDS)[number]
export type TextParagraph = {
  range: CanvasFigmaTextRange
  span: TextRange
  effective: Record<ParagraphField, TextRange>
}

export function textParagraphs(
  characters: string,
  ranges: readonly CanvasFigmaTextRange[]
): TextParagraph[] {
  const spans = textParagraphRanges(characters, ranges)
  const nextOwner = {
    paragraphIndent: characters.length,
    paragraphSpacing: characters.length,
    listSpacing: characters.length,
    textWrapStyle: characters.length
  }
  const result: TextParagraph[] = Array(ranges.length)
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index]!
    const span = spans[index]!
    const effective = {} as Record<ParagraphField, TextRange>
    for (const field of PARAGRAPH_FIELDS) {
      // The schema requires ordered, non-overlapping character ranges. A later
      // range can therefore overlap only this range's final paragraph; its first
      // owning paragraph is enough to truncate the effective comparison span.
      effective[field] = { start: span.start, end: Math.min(span.end, nextOwner[field]) }
      if (
        range.textStyle ||
        (field !== 'textWrapStyle' && range[field] !== undefined) ||
        ((field === 'paragraphIndent' || field === 'paragraphSpacing') && range.variables?.[field])
      ) {
        nextOwner[field] = span.start
      }
    }
    result[index] = { range, span, effective }
  }
  return result
}
