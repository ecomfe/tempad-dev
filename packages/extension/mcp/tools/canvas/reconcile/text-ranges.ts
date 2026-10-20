export type TextRange = { start: number; end: number }

export function* textRangesOutside(
  scope: TextRange,
  overrides: readonly TextRange[]
): Generator<TextRange> {
  let position = scope.start
  // Authored ranges are ordered. Paragraph expansion can make them overlap.
  for (const range of overrides) {
    const start = Math.max(scope.start, range.start)
    const end = Math.min(scope.end, range.end)
    if (end <= position || start >= scope.end) continue
    if (position < start) yield { start: position, end: start }
    position = end
  }
  if (position < scope.end) yield { start: position, end: scope.end }
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
