import type { GetTokenDefsResult, TokenEntry } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { normalizeFigmaVarName } from '@/utils/css'

import { resolveTokenDefsByNames } from '../../token'
import { canonicalizeNames, getVariableRawName } from '../../token/indexer'
import { getVariableByIdCached } from './cache'

export async function buildUsedTokens(
  usedFinalNames: Set<string>,
  finalBridge: Map<string, string>,
  config: CodegenConfig,
  pluginCode?: string,
  cache?: Map<string, Variable | null>
): Promise<{
  usedTokens: Record<string, TokenEntry>
  tokensByCanonical: GetTokenDefsResult
  canonicalByFinal: Map<string, string>
}> {
  const usedTokens: Record<string, TokenEntry> = {}
  if (!usedFinalNames.size || !finalBridge.size) {
    return { usedTokens, tokensByCanonical: {}, canonicalByFinal: new Map() }
  }

  const ids = Array.from(finalBridge.values())
  const uniqueIds = Array.from(new Set(ids))
  const variables = uniqueIds
    .map((id) => getVariableByIdCached(id, cache))
    .filter(Boolean) as Variable[]

  const rawNames = variables.map((v) => getVariableRawName(v))
  const canonicalNames = await canonicalizeNames(rawNames, config, pluginCode)

  const canonicalById = new Map<string, string>()
  for (let i = 0; i < variables.length; i += 1) {
    const variable = variables[i]
    const fallback = normalizeFigmaVarName(rawNames[i])
    canonicalById.set(variable.id, canonicalNames[i] ?? fallback)
  }

  const canonicalByFinal = new Map<string, string>()
  usedFinalNames.forEach((finalName) => {
    const id = finalBridge.get(finalName)
    if (!id) return
    const canonical = canonicalById.get(id)
    if (canonical) canonicalByFinal.set(finalName, canonical)
  })

  const nameSet = new Set<string>(canonicalByFinal.values())
  const tokensByCanonical = await resolveTokenDefsByNames(nameSet, config, pluginCode, {
    candidateIds: new Set(uniqueIds)
  })

  const canonicalToFinal = new Map<string, string>()
  canonicalByFinal.forEach((canonical, finalName) => {
    if (!canonicalToFinal.has(canonical)) canonicalToFinal.set(canonical, finalName)
  })

  usedFinalNames.forEach((finalName) => {
    const canonical = canonicalByFinal.get(finalName)
    if (!canonical) return
    const entry = tokensByCanonical[canonical]
    if (!entry) return
    usedTokens[finalName] = remapTokenAliases(entry, canonicalToFinal)
  })

  return { usedTokens, tokensByCanonical, canonicalByFinal }
}

function remapTokenAliases(entry: TokenEntry, canonicalToFinal: Map<string, string>): TokenEntry {
  const remap = (val: string): string => {
    if (!val.startsWith('--')) return val
    return canonicalToFinal.get(val) ?? val
  }

  if (typeof entry.value === 'string') {
    const nextValue = remap(entry.value)
    const nextResolved = entry.resolvedValue ? remap(entry.resolvedValue) : undefined
    return { ...entry, value: nextValue, ...(nextResolved ? { resolvedValue: nextResolved } : {}) }
  }

  const mapped: Record<string, string> = {}
  Object.entries(entry.value).forEach(([mode, val]) => {
    mapped[mode] = remap(val)
  })

  const nextResolved = entry.resolvedValue ? remap(entry.resolvedValue) : undefined

  return {
    ...entry,
    value: mapped,
    ...(nextResolved ? { resolvedValue: nextResolved } : {})
  }
}
