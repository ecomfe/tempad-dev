type SearchableAgent = { id: string; name: string }

const compact = (value: string): string => value.toLowerCase().replace(/[\s_-]+/g, '')

function scoreField(field: string, query: string): number {
  const folded = field.toLowerCase()
  const normalized = compact(field)
  if (normalized === query) return 10_000

  // Every query character must match in order. Keep the best alignment ending
  // at each character, rewarding word starts and uninterrupted runs.
  let previous = Array<number>(field.length).fill(-Infinity)
  for (let row = 0; row < query.length; row++) {
    const current = Array<number>(field.length).fill(-Infinity)
    let bestGap = -Infinity
    for (let column = 0; column < field.length; column++) {
      // Extend a gap or skip one character after a previous match.
      if (column > 1) bestGap = Math.max(bestGap, previous[column - 2]!) - 1
      if (folded[column] !== query[row]) continue

      const wordStart =
        column === 0 ||
        /[\s_-]/.test(field[column - 1]!) ||
        /[a-z][A-Z]/.test(field.slice(column - 1, column + 1))
      const bonus = 16 + (wordStart ? 24 : 0)
      current[column] =
        bonus + (row === 0 ? -column : Math.max((previous[column - 1] ?? -Infinity) + 32, bestGap))
    }
    previous = current
  }

  const score = Math.max(...previous)
  return score + (normalized.startsWith(query) ? 1_000 : 0) - field.length / 100
}

/** Stable ties retain the curated browsing order; fields never match across one another. */
export function searchAgents<T extends SearchableAgent>(agents: readonly T[], value: string): T[] {
  const query = compact(value)
  if (!query) return [...agents]

  return agents
    .map((agent) => ({
      agent,
      score: Math.max(
        scoreField(agent.name, query),
        scoreField(agent.id, query),
        agent.id === 'other' ? scoreField('Other agents', query) : -Infinity
      )
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => b.score - a.score)
    .map(({ agent }) => agent)
}
