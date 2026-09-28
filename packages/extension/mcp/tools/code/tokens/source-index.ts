import { canonicalizeVarName, normalizeFigmaVarName } from '@/utils/css'

import { getVariableByIdCached } from '../../token/cache'

export function buildSourceNameIndex(
  candidateIds: Set<string>,
  cache: Map<string, Variable | null>,
  onAmbiguous?: (name: string) => void
): Map<string, string> {
  const index = new Map<string, string>()
  const ambiguous = new Set<string>()

  const addName = (name: string, id: string) => {
    if (ambiguous.has(name)) return
    const previous = index.get(name)
    if (previous && previous !== id) {
      index.delete(name)
      ambiguous.add(name)
      onAmbiguous?.(name)
      return
    }
    index.set(name, id)
  }

  for (const id of candidateIds) {
    const v = getVariableByIdCached(id, cache)
    if (!v) continue

    const cs = v.codeSyntax?.WEB?.trim()
    if (cs) {
      let canonical = canonicalizeVarName(cs)
      if (!canonical) {
        const trimmed = cs.replace(/^[$@]/, '').trim()
        if (/^[A-Za-z0-9 _-]+$/.test(trimmed)) {
          const raw = trimmed.startsWith('--') ? trimmed.slice(2) : trimmed
          canonical = normalizeFigmaVarName(raw)
        }
      }
      if (canonical) addName(canonical, id)
      // Match the normalized name that may appear in var(--...) outputs.
      addName(normalizeFigmaVarName(cs), id)
      // Non-var codeSyntax should also be matched (for example, rounded-2xl).
      addName(cs, id)
    }

    const figmaName = normalizeFigmaVarName(v.name ?? '')
    addName(figmaName, id)
  }

  return index
}
