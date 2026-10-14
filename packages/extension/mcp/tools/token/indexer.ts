import type { CodegenConfig } from '@/utils/codegen'

import { getLocalVariables } from '@/mcp/local-resources'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import { normalizeFigmaVarName } from '@/utils/css'
import { getVariableRawName } from '@/utils/figma-variables'

import { normalizeTransformedName } from './name'

export { getVariableRawName } from '@/utils/figma-variables'

export type TokenIndex = {
  // canonical name ("--color-primary") -> variable ids (handle collisions)
  byCanonicalName: Map<string, string[]>
  // variable id -> canonical name
  canonicalNameById: Map<string, string>
  // for diagnostics
  totalVariables: number
}

export async function canonicalizeNames(
  rawNames: string[],
  config: CodegenConfig,
  pluginCode?: string,
  checkpoint?: () => void
): Promise<string[]> {
  checkpoint?.()
  if (!rawNames.length) return []

  const refs = rawNames.map((rawName) => {
    checkpoint?.()
    // Keep token canonicalization aligned with style/code output by normalizing
    // raw Figma names through the same Figma-to-CSS variable path first.
    const canonical = normalizeFigmaVarName(rawName)
    return { code: `var(${canonical})`, name: canonical.slice(2) }
  })

  const CHUNK_SIZE = 300
  const results: string[] = []
  for (let index = 0; index < refs.length; index += CHUNK_SIZE) {
    checkpoint?.()
    const transformed = await runTransformVariableBatch(
      refs.slice(index, index + CHUNK_SIZE),
      workerUnitOptions(config),
      pluginCode
    )
    checkpoint?.()
    results.push(...transformed)
  }

  return refs.map((fallback, idx) => {
    checkpoint?.()
    return normalizeTransformedName(results[idx], `--${fallback.name}`)
  })
}

export async function canonicalizeName(
  rawName: string,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string> {
  const [canonical] = await canonicalizeNames([rawName], config, pluginCode)
  return canonical ?? normalizeFigmaVarName(rawName)
}

export async function getTokenIndex(
  config: CodegenConfig,
  pluginCode?: string
): Promise<TokenIndex> {
  const variables = await getLocalVariables()

  const byCanonicalName = new Map<string, string[]>()
  const canonicalNameById = new Map<string, string>()

  const canonicals = await canonicalizeNames(
    variables.map((v) => getVariableRawName(v)),
    config,
    pluginCode
  )

  for (const [i, variable] of variables.entries()) {
    const fallbackRaw = getVariableRawName(variable)
    const canonical = canonicals[i] ?? normalizeFigmaVarName(fallbackRaw)

    canonicalNameById.set(variable.id, canonical)

    const bucket = byCanonicalName.get(canonical)
    if (bucket) bucket.push(variable.id)
    else byCanonicalName.set(canonical, [variable.id])
  }

  return {
    byCanonicalName,
    canonicalNameById,
    totalVariables: variables.length
  }
}
