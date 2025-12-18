import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import { normalizeCustomPropertyBody, replaceVarFunctions } from '@/utils/css'

import type { CandidateResult } from './candidates'

import { collectCandidateVariableIds } from './candidates'

export type VariableMappings = CandidateResult

export function buildVariableMappings(roots: SceneNode[]): VariableMappings {
  return collectCandidateVariableIds(roots)
}

export function normalizeStyleVars(
  styles: Map<string, Record<string, string>>,
  mappings: VariableMappings
): Set<string> {
  const used = new Set<string>()
  if (!mappings || !mappings.rewrites.size) return used

  for (const style of styles.values()) {
    for (const [prop, raw] of Object.entries(style)) {
      if (!raw) continue
      const value = raw.trim()
      if (!value) continue

      const rewrite = mappings.rewrites.get(value)
      if (!rewrite) continue

      style[prop] = `var(${rewrite.canonical})`
      used.add(rewrite.id)
    }
  }

  return used
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
