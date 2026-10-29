import type { CanvasFigmaTextRange } from '@tempad-dev/shared'

export type TextRange = { start: number; end: number }
export type TextMetricField = 'fontSize' | 'lineHeight' | 'letterSpacing'

export function textRangeWithTrailingNewline(characters: string, range: TextRange): TextRange {
  // Native character metrics also apply to an immediately following paragraph break.
  return characters[range.end] === '\n' ? { start: range.start, end: range.end + 1 } : range
}

export function textMetricRange(
  characters: string,
  range: TextRange,
  field: TextMetricField,
  next?: CanvasFigmaTextRange
): TextRange {
  // Native setter extent does not give an earlier declaration ownership over a
  // later range's newline. Compare only the field's final owner.
  if (
    next?.start === range.end &&
    (next.textStyle || next[field] !== undefined || next.variables?.[field] !== undefined)
  )
    return range
  return textRangeWithTrailingNewline(characters, range)
}

export function* textParagraphContents(
  characters: string,
  range: TextRange
): Generator<{ span: TextRange; content: TextRange }> {
  let start = range.start
  while (start < range.end) {
    const newline = characters.indexOf('\n', start)
    const end = Math.min(range.end, newline === -1 ? characters.length : newline + 1)
    yield {
      span: { start, end },
      content: { start, end: characters[end - 1] === '\n' ? end - 1 : end }
    }
    start = end
  }
}

export function textParagraphRange(characters: string, range: TextRange): TextRange {
  // Paragraph setters affect every paragraph touched, including its newline.
  const start = range.start === 0 ? 0 : characters.lastIndexOf('\n', range.start - 1) + 1
  const newline = characters.indexOf('\n', range.end - 1)
  return { start, end: newline === -1 ? characters.length : newline + 1 }
}

export function textParagraphRanges(characters: string, ranges: readonly TextRange[]): TextRange[] {
  if (!ranges.length) return []
  let start = 0
  let end = 0
  const advance = () => {
    start = end
    const newline = characters.indexOf('\n', start)
    end = newline === -1 ? characters.length : newline + 1
  }
  advance()
  // Authored ranges are ordered and do not overlap, so both paragraph boundaries
  // advance monotonically. Each newline is visited once, regardless of range count.
  return ranges.map((range) => {
    while (end <= range.start && end < characters.length) advance()
    const first = start
    while (end < range.end && end < characters.length) advance()
    return { start: first, end }
  })
}

export function* textRangesOutside(
  scope: TextRange,
  overrides: readonly TextRange[]
): Generator<TextRange> {
  let position = scope.start
  // Authored ranges are ordered. Paragraph expansion can make them overlap.
  for (const range of overrides) {
    const start = Math.max(scope.start, range.start)
    if (start >= scope.end) break
    const end = Math.min(scope.end, range.end)
    if (end <= position) continue
    if (position < start) yield { start: position, end: start }
    position = end
  }
  if (position < scope.end) yield { start: position, end: scope.end }
}

export function* textRangesIntersect(
  left: readonly TextRange[],
  right: readonly TextRange[]
): Generator<TextRange> {
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const a = left[leftIndex]!
    const b = right[rightIndex]!
    const start = Math.max(a.start, b.start)
    const end = Math.min(a.end, b.end)
    if (start < end) yield { start, end }
    if (a.end <= b.end) leftIndex++
    if (b.end <= a.end) rightIndex++
  }
}

export function textRangesMatchOutside(
  scope: TextRange,
  overrides: readonly TextRange[],
  matches: (start: number, end: number) => boolean
): boolean {
  for (const { start, end } of textRangesOutside(scope, overrides)) {
    if (!matches(start, end)) return false
  }
  return true
}
