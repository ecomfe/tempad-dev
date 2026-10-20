type TextRange = { start: number; end: number }

export function textRangesMatchOutside(
  scope: TextRange,
  overrides: readonly TextRange[],
  matches: (start: number, end: number) => boolean
): boolean {
  let position = scope.start
  // Authored ranges are ordered. Paragraph expansion can make them overlap.
  for (const range of overrides) {
    const start = Math.max(scope.start, range.start)
    const end = Math.min(scope.end, range.end)
    if (end <= position || start >= scope.end) continue
    if (position < start && !matches(position, start)) return false
    position = end
  }
  return position >= scope.end || matches(position, scope.end)
}
