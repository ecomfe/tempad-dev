import { canonicalizeVarName, normalizeFigmaVarName } from '@/utils/css'

import { getVariableByIdCached } from './cache'

export function buildSourceNameIndex(
  candidateIds: Set<string>,
  cache: Map<string, Variable | null>
): Map<string, string> {
  const index = new Map<string, string>()

  const setIfEmpty = (name: string | undefined, id: string) => {
    if (!name) return
    if (index.has(name)) return
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
      if (canonical) setIfEmpty(canonical, id)
      // Match the normalized name that may appear in var(--...) outputs.
      setIfEmpty(normalizeFigmaVarName(cs), id)
      // 非 var 的 codeSyntax 也需要被匹配到（如 rounded-2xl）
      setIfEmpty(cs, id)
    }

    const figmaName = normalizeFigmaVarName(v.name ?? '')
    setIfEmpty(figmaName, id)
  }

  return index
}
