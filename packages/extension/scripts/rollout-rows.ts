export type RolloutRow = { value: unknown } | { error: string }

/** Keep malformed-line evidence alongside valid rows so each inspector can apply its policy. */
export function* parseRolloutRows(source: string): Generator<RolloutRow> {
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue
    try {
      yield { value: JSON.parse(line) as unknown }
    } catch {
      yield { error: `Invalid rollout JSON on line ${String(index + 1)}.` }
    }
  }
}
