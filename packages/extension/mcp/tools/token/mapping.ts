import type { FigmaLookupReaders } from '@/utils/figma-style/types'

import { normalizeFigmaVarName, replaceVarFunctions } from '@/utils/css'

import type { CandidateResult } from './candidates'

import { getVariableByIdCached } from './cache'
import { collectCandidateVariableIds } from './candidates'

export type VariableMappings = CandidateResult

export function buildVariableMappings(
  roots: SceneNode[],
  cache?: Map<string, Variable | null>,
  readers?: FigmaLookupReaders
): VariableMappings {
  return collectCandidateVariableIds(roots, cache, readers)
}

export function normalizeStyleVars(
  styles: Map<string, Record<string, string>>,
  mappings: VariableMappings,
  cache?: Map<string, Variable | null>
): Set<string> {
  const used = new Set<string>()
  if (!mappings) return used

  const syntaxMap = buildCodeSyntaxIndex(mappings.variableIds, cache)
  const replaceMap = buildReplaceMap(mappings.variableIds, cache)

  for (const style of styles.values()) {
    for (const [prop, raw] of Object.entries(style)) {
      if (!raw) continue
      const value = raw.trim()
      if (!value) continue

      const rewrite = mappings.rewrites.get(value)
      if (rewrite) {
        style[prop] = `var(${rewrite.canonical})`
        used.add(rewrite.id)
        continue
      }

      const matched = syntaxMap.get(value)
      if (matched) {
        used.add(matched.id)
        style[prop] = `var(${matched.canonical})`
        continue
      }

      const replaced = replaceKnownNames(raw, replaceMap, used)
      if (replaced !== raw) style[prop] = replaced
    }
  }

  return used
}

function buildCodeSyntaxIndex(
  variableIds: Set<string>,
  cache?: Map<string, Variable | null>
): Map<string, { canonical: string; id: string }> {
  const map = new Map<string, { canonical: string; id: string }>()
  for (const id of variableIds) {
    const v = getVariableByIdCached(id, cache)
    if (!v) continue
    const cs = v.codeSyntax?.WEB?.trim()
    if (!cs) continue
    if (cs.toLowerCase().startsWith('var(')) continue
    if (!map.has(cs)) {
      const canonical = getVariableCanonicalName(v)
      if (canonical) map.set(cs, { canonical, id })
    }
  }
  return map
}

type ReplaceEntry = { name: string; normalized: string; id: string }

function buildReplaceMap(
  variableIds: Set<string>,
  cache?: Map<string, Variable | null>
): ReplaceEntry[] {
  const entries: ReplaceEntry[] = []
  for (const id of variableIds) {
    const v = getVariableByIdCached(id, cache)
    if (!v) continue

    const normalizedName = normalizeFigmaVarName(v.name ?? '')
    if (normalizedName && normalizedName !== '--unnamed') {
      entries.push({ name: normalizedName, normalized: normalizedName, id })
    }

    const cs = v.codeSyntax?.WEB?.trim()
    if (cs) {
      const normalized = getVariableCanonicalName(v)
      if (normalized) {
        entries.push({ name: cs, normalized, id })
      }
    }
  }

  entries.sort((a, b) => b.name.length - a.name.length)
  return entries
}

function getVariableCanonicalName(variable: Variable): string | null {
  const name = normalizeFigmaVarName(variable.name ?? '')
  return name === '--unnamed' ? null : name
}

function replaceKnownNames(value: string, entries: ReplaceEntry[], used: Set<string>): string {
  if (!value || !entries.length) return value

  const placeholders: string[] = []
  let out = replaceVarFunctions(value, ({ full }) => {
    const token = `__VAR_${placeholders.length}__`
    placeholders.push(full)
    return token
  })

  let changed = false

  for (const entry of entries) {
    const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=[^A-Za-z0-9_-]|$)`, 'g')
    out = out.replace(re, (_match, prefix: string, _name: string, offset: number, str: string) => {
      const start = offset + prefix.length
      const left = str.slice(0, start).replace(/\s+$/, '')
      if (left.toLowerCase().endsWith('var(')) {
        return _match
      }
      used.add(entry.id)
      changed = true
      return `${prefix}var(${entry.normalized})`
    })
  }

  if (placeholders.length) {
    out = out.replace(/__VAR_(\d+)__/g, (_match, index: string) => {
      const i = Number(index)
      return Number.isFinite(i) ? placeholders[i] : _match
    })
  }

  return changed ? out : value
}
