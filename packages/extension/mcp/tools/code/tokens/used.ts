import type { GetTokenDefsResult } from '@tempad-dev/shared'

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

  const variables = Array.from(usedIds)
    .map((id) => getVariableByIdCached(id, cache))
    .filter(Boolean) as Variable[]

  const variablesWithRawNames = variables.map((variable) => ({
    variable,
    rawName: getVariableRawName(variable)
  }))
  const canonicalNames = await canonicalizeNames(
    variablesWithRawNames.map(({ rawName }) => rawName),
    config,
    pluginCode
  )

  const nameSet = new Set<string>()
  const candidateNameById = new Map<string, string>()
  for (const [i, { variable, rawName }] of variablesWithRawNames.entries()) {
    const canonical = canonicalNames[i] ?? normalizeFigmaVarName(rawName)
    nameSet.add(canonical)
    candidateNameById.set(variable.id, canonical)
  }

  const tokensByCanonical = await resolveTokenDefsByNames(nameSet, config, pluginCode, {
    includeAllModes: !!options.includeAllModes,
    resolveValues: !!options.resolveValues,
    candidateIds: usedIds,
    candidateNameById
  })

  return { tokensByCanonical }
}
