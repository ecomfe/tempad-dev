import type { GetTokenDefsResult } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { normalizeFigmaVarName } from '@/utils/css'

import { resolveTokenDefsByNames } from '../../token'
import { canonicalizeNames, getVariableRawName } from '../../token/indexer'
import { getVariableByIdCached } from './cache'

export async function buildUsedTokens(
  finalBridge: Map<string, string>,
  config: CodegenConfig,
  pluginCode?: string,
  cache?: Map<string, Variable | null>,
  options: {
    includeAllModes?: boolean
    resolveValues?: boolean
  } = {}
): Promise<{
  tokensByCanonical: GetTokenDefsResult
}> {
  if (!finalBridge.size) {
    return { tokensByCanonical: {} }
  }

  const usedIds = new Set<string>(finalBridge.values())

  if (!usedIds.size) {
    return { tokensByCanonical: {} }
  }

  const variables = Array.from(usedIds)
    .map((id) => getVariableByIdCached(id, cache))
    .filter(Boolean) as Variable[]

  const rawNames = variables.map((v) => getVariableRawName(v))
  const canonicalNames = await canonicalizeNames(rawNames, config, pluginCode)

  const nameSet = new Set<string>()
  const candidateNameById = new Map<string, string>()
  for (let i = 0; i < variables.length; i += 1) {
    const canonical = canonicalNames[i] ?? normalizeFigmaVarName(rawNames[i])
    nameSet.add(canonical)
    candidateNameById.set(variables[i].id, canonical)
  }

  const tokensByCanonical = await resolveTokenDefsByNames(nameSet, config, pluginCode, {
    includeAllModes: !!options.includeAllModes,
    resolveValues: !!options.resolveValues,
    candidateIds: usedIds,
    candidateNameById
  })

  return { tokensByCanonical }
}
