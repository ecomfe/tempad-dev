import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import {
  normalizeCustomPropertyBody,
  normalizeFigmaVarName,
  replaceVarFunctions
} from '@/utils/css'

import type { CandidateResult } from './candidates'

import { getVariableByIdCached } from './cache'
import { collectCandidateVariableIds } from './candidates'

export type VariableMappings = CandidateResult

export function buildVariableMappings(
  roots: SceneNode[],
  cache?: Map<string, Variable | null>
): VariableMappings {
  return collectCandidateVariableIds(roots, cache)
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
        used.add(matched)
        style[prop] = `var(${normalizeFigmaVarName(value)})`
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
): Map<string, string> {
  const map = new Map<string, string>()
  for (const id of variableIds) {
    const v = getVariableByIdCached(id, cache)
    if (!v) continue
    const cs = v.codeSyntax?.WEB?.trim()
    if (!cs) continue
    if (cs.toLowerCase().startsWith('var(')) continue
    if (!map.has(cs)) map.set(cs, id)
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
      const normalized = normalizeFigmaVarName(cs)
      if (normalized && normalized !== '--unnamed') {
        entries.push({ name: cs, normalized, id })
      }
    }
  }

  entries.sort((a, b) => b.name.length - a.name.length)
  return entries
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

export async function applyPluginTransforms(
  markup: string,
  pluginCode: string | undefined,
  config: CodegenConfig
): Promise<string> {
  if (!pluginCode) return markup
  if (!/var\(/i.test(markup)) return markup

  let out = markup

  const references: { code: string; name: string; value?: string }[] = []

  replaceVarFunctions(out, ({ full, name, fallback }) => {
    const trimmed = name.trim()
    if (!trimmed.startsWith('--')) return full
    references.push({
      code: full,
      name: normalizeCustomPropertyBody(trimmed),
      value: fallback?.trim()
    })
    return full
  })

  if (!references.length) return out

  const results = await runTransformVariableBatch(references, workerUnitOptions(config), pluginCode)

  let replaceIndex = 0
  out = replaceVarFunctions(out, ({ full, name }) => {
    const trimmed = name.trim()
    if (!trimmed.startsWith('--')) return full
    const next = results[replaceIndex++]
    return typeof next === 'string' && next.trim() ? next : full
  })

  return out
}
