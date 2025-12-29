import type { GetTokenDefsResult, TokenEntry } from '@tempad-dev/mcp-shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { activePlugin } from '@/ui/state'
import { formatHexAlpha, normalizeCssValue } from '@/utils/css'
import { logger } from '@/utils/log'

import { currentCodegenConfig } from '../config'
import { canonicalizeName, canonicalizeNames, getTokenIndex, getVariableRawName } from './indexer'

type TokenModeValue = {
  modeId: string
  value?: string | Record<string, unknown>
  resolved: string | Record<string, unknown> | null
  aliasTo?: string
  aliasChain?: string[]
}

type VariableAlias = { id?: string } | { type?: string; id?: string }
type VariableWithCollection = Variable & { variableCollectionId?: string; resolvedType?: string }
type VariableCollectionInfo = {
  id?: string
  name?: string
  defaultModeId?: string
  activeModeId?: string
  modes?: Array<{ id: string; name?: string }>
}

const collectionIdByName = new Map<string, string>()
const warnedDuplicateCollections = new Set<string>()

export async function handleGetTokenDefs(
  names: string[],
  includeAllModes = false
): Promise<GetTokenDefsResult> {
  const config = currentCodegenConfig()
  const pluginCode = activePlugin.value?.code

  const requested = new Set(names.map((n) => (n.startsWith('--') ? n : `--${n}`)))
  const tokens = await resolveTokenDefsByNames(requested, config, pluginCode, { includeAllModes })

  const approxSize = JSON.stringify(tokens).length
  if (approxSize > MCP_MAX_PAYLOAD_BYTES) {
    throw new Error(
      'Token payload too large to return. Reduce selection or requested names and retry.'
    )
  }

  return tokens
}

export async function resolveTokenDefsByNames(
  names: Set<string>,
  config: CodegenConfig,
  pluginCode?: string,
  options: {
    includeAllModes?: boolean
    resolveValues?: boolean
    candidateIds?: Set<string> | (() => Set<string>)
    candidateNameById?: Map<string, string>
  } = {}
): Promise<GetTokenDefsResult> {
  return resolveTokens({
    names,
    includeAllModes: !!options.includeAllModes,
    resolveValues: !!options.resolveValues,
    config,
    pluginCode,
    candidateIds: options.candidateIds,
    candidateNameById: options.candidateNameById
  })
}

type ResolveTokensOptions = {
  names: Set<string>
  includeAllModes: boolean
  resolveValues: boolean
  config: CodegenConfig
  pluginCode?: string
  candidateIds?: Set<string> | (() => Set<string>)
  candidateNameById?: Map<string, string>
}

async function resolveTokens({
  names,
  includeAllModes,
  resolveValues,
  config,
  pluginCode,
  candidateIds,
  candidateNameById
}: ResolveTokensOptions): Promise<GetTokenDefsResult> {
  if (!names.size) return {}

  const seeds: Variable[] = []
  const remaining = new Set(names)
  let index: Awaited<ReturnType<typeof getTokenIndex>> | null = null

  const ensureIndex = async () => {
    if (!index) index = await getTokenIndex(config, pluginCode)
    return index
  }

  // Try to satisfy via candidate ids first (narrow scope).
  if (remaining.size && candidateIds) {
    const realized = typeof candidateIds === 'function' ? candidateIds() : candidateIds
    if (realized?.size) {
      const candidateVariables: Variable[] = []
      const useNameById = !!candidateNameById && candidateNameById.size > 0
      for (const id of realized) {
        const v = figma.variables.getVariableById(id)
        if (!v) continue
        if (useNameById) {
          const canonicalName = candidateNameById!.get(id)
          if (canonicalName && remaining.has(canonicalName)) {
            seeds.push(v)
            remaining.delete(canonicalName)
          }
          continue
        }
        candidateVariables.push(v)
      }

      if (!useNameById && candidateVariables.length) {
        const canonicals = await canonicalizeNames(
          candidateVariables.map((v) => getVariableRawName(v)),
          config,
          pluginCode
        )

        for (let i = 0; i < candidateVariables.length; i++) {
          const v = candidateVariables[i]
          const canonical = canonicals[i]
          if (canonical && remaining.has(canonical)) {
            seeds.push(v)
            remaining.delete(canonical)
          }
        }
      }
    }
  }

  // Use full index only for remaining names.
  if (remaining.size) {
    const fullIndex = await ensureIndex()
    for (const name of remaining) {
      const idsForName = fullIndex.byCanonicalName.get(name)
      if (!idsForName?.length) continue
      for (const id of idsForName) {
        const variable = figma.variables.getVariableById(id)
        if (variable) seeds.push(variable)
      }
    }
    remaining.clear()
  }

  const { tokens, aliasDeps } = await buildTokensFromVariables({
    seedVariables: seeds,
    includeAllModes,
    resolveValues,
    config,
    pluginCode,
    index: index ?? undefined
  })

  const needed = new Set<string>([...names, ...aliasDeps])
  return filterTokensByNames(tokens, needed)
}

function filterTokensByNames(input: GetTokenDefsResult, names: Set<string>): GetTokenDefsResult {
  const tokens: GetTokenDefsResult = {}
  Object.entries(input).forEach(([name, entry]) => {
    if (names.has(name)) tokens[name] = entry
  })
  return tokens
}

type BuildTokensOptions = {
  seedVariables: Variable[]
  includeAllModes: boolean
  resolveValues: boolean
  config: CodegenConfig
  pluginCode?: string
  index?: Awaited<ReturnType<typeof getTokenIndex>>
}

async function buildTokensFromVariables({
  seedVariables,
  includeAllModes,
  resolveValues,
  config,
  pluginCode,
  index: providedIndex
}: BuildTokensOptions): Promise<{ tokens: GetTokenDefsResult; aliasDeps: Set<string> }> {
  if (!seedVariables.length) return { tokens: {}, aliasDeps: new Set() }

  const index = providedIndex ?? (await getTokenIndex(config, pluginCode))

  const tokens: GetTokenDefsResult = {}
  const aliasDeps = new Set<string>()
  const pending: Variable[] = [...seedVariables]
  const seenIds = new Set<string>()

  while (pending.length) {
    const variable = pending.shift()!
    if (seenIds.has(variable.id)) continue
    seenIds.add(variable.id)

    const canonicalName =
      index.canonicalNameById.get(variable.id) ??
      (await canonicalizeName(getVariableRawName(variable), config, pluginCode))
    const collection = resolveVariableCollection(variable)
    const preferredModeId = pickPreferredModeId(variable, collection)
    const modeIds = includeAllModes
      ? Object.keys(variable.valuesByMode ?? {})
      : preferredModeId
        ? [preferredModeId]
        : []

    const valueMap: Record<string, string> = {}
    for (const modeId of modeIds) {
      const mv = await resolveModeValue(
        variable,
        modeId,
        collection,
        config,
        pluginCode,
        new Set(),
        pending,
        { canonicalName, index }
      )
      const modeKey = modeKeyForCollection(collection, modeId)
      const resolvedLiteral = toLiteralString(mv.resolved)
      const aliasName = mv.aliasTo
        ? await resolveAliasName(mv.aliasTo, index, config, pluginCode)
        : undefined
      if (aliasName) {
        aliasDeps.add(aliasName)
      }
      if (mv.aliasChain?.length) {
        for (const aliasId of mv.aliasChain) {
          const chainName = await resolveAliasName(aliasId, index, config, pluginCode)
          if (chainName) aliasDeps.add(chainName)
        }
      }
      valueMap[modeKey] = resolveValues ? resolvedLiteral : (aliasName ?? resolvedLiteral)
    }

    const primaryModeId = collection?.activeModeId ?? preferredModeId ?? modeIds[0]
    const primaryModeKey = primaryModeId
      ? modeKeyForCollection(collection, primaryModeId)
      : undefined
    const resolvedValue =
      (primaryModeKey && valueMap[primaryModeKey]) ||
      (modeIds.length ? valueMap[modeKeyForCollection(collection, modeIds[0])] : '')

    const value: string | Record<string, string> = modeIds.length <= 1 ? resolvedValue : valueMap

    const entry: TokenEntry = {
      kind: mapResolvedType(variable.resolvedType),
      value
    }

    tokens[canonicalName] = entry
  }

  return { tokens, aliasDeps }
}

function resolveVariableCollection(variable: Variable): VariableCollectionInfo | null {
  const collectionId = (variable as VariableWithCollection).variableCollectionId
  if (!collectionId) return null

  try {
    const collection = figma.variables.getVariableCollectionById(collectionId)
    if (!collection) return null
    trackCollectionName(collection)
    return {
      id: collection.id,
      name: collection.name,
      defaultModeId: collection.defaultModeId,
      activeModeId: readActiveModeId(collection.id),
      modes: Array.isArray(collection.modes)
        ? collection.modes.map((m) => ({ id: m.modeId, name: m.name }))
        : undefined
    }
  } catch (error) {
    logger.warn('Failed to resolve variable collection:', error)
    return null
  }
}

function trackCollectionName(collection: VariableCollection): void {
  if (!collection?.name) return
  const existing = collectionIdByName.get(collection.name)
  if (!existing) {
    collectionIdByName.set(collection.name, collection.id)
    return
  }
  if (existing !== collection.id && !warnedDuplicateCollections.has(collection.name)) {
    warnedDuplicateCollections.add(collection.name)
    logger.warn(`Duplicate variable collection name "${collection.name}" detected.`)
  }
}

function readActiveModeId(collectionId?: string): string | undefined {
  if (!collectionId) return undefined
  const variablesApi = (
    figma as unknown as { variables?: { getVariableModeId?: (id: string) => string } }
  ).variables
  const getter = variablesApi?.getVariableModeId
  if (typeof getter !== 'function') return undefined
  try {
    return getter(collectionId)
  } catch (error) {
    logger.warn('Failed to read active mode id:', error)
    return undefined
  }
}

function pickPreferredModeId(
  variable: Variable,
  collection?: VariableCollectionInfo | null,
  desiredModeId?: string
): string | undefined {
  const { valuesByMode = {} } = variable
  if (desiredModeId && desiredModeId in valuesByMode) return desiredModeId
  if (collection?.activeModeId && collection.activeModeId in valuesByMode) {
    return collection.activeModeId
  }
  if (collection?.defaultModeId && collection.defaultModeId in valuesByMode) {
    return collection.defaultModeId
  }
  return Object.keys(valuesByMode)[0]
}

async function resolveModeValue(
  variable: Variable,
  modeId: string,
  collection: VariableCollectionInfo | null,
  config: CodegenConfig,
  pluginCode?: string,
  aliasSeen: Set<string> = new Set(),
  pending?: Variable[],
  ctx?: {
    canonicalName?: string
    index?: Awaited<ReturnType<typeof getTokenIndex>>
  }
): Promise<TokenModeValue> {
  const { valuesByMode = {} } = variable
  if (aliasSeen.has(variable.id)) {
    return { modeId, resolved: null, aliasChain: [] }
  }
  aliasSeen.add(variable.id)

  const rawValue = valuesByMode[modeId] ?? resolveFallbackValue(valuesByMode, modeId, collection)

  if (isVariableAlias(rawValue)) {
    const target = figma.variables.getVariableById(rawValue.id)
    if (!target) {
      logger.error('Missing alias target variable', {
        source: variable.id,
        target: rawValue.id
      })
      return { modeId, aliasTo: rawValue.id, resolved: null, aliasChain: [rawValue.id] }
    }
    pending?.push(target)
    const targetCollection = resolveVariableCollection(target)
    const targetModeId = pickPreferredModeId(target, targetCollection, modeId) ?? modeId

    let targetCanonicalName: string | undefined
    if (ctx?.index) {
      targetCanonicalName =
        ctx.index.canonicalNameById.get(target.id) ??
        (await canonicalizeName(getVariableRawName(target), config, pluginCode))
    }

    const resolvedTarget = await resolveModeValue(
      target,
      targetModeId,
      targetCollection,
      config,
      pluginCode,
      aliasSeen,
      pending,
      { canonicalName: targetCanonicalName, index: ctx?.index }
    )
    const chain = [rawValue.id, ...(resolvedTarget.aliasChain ?? [])]
    return {
      modeId,
      aliasTo: rawValue.id,
      resolved: resolvedTarget.resolved,
      aliasChain: chain.length ? chain : undefined
    }
  }

  const serialized = serializeVariableValue(
    rawValue,
    variable.resolvedType,
    config,
    ctx?.canonicalName
  )
  return {
    modeId,
    value: serialized ?? undefined,
    resolved: serialized,
    aliasChain: undefined
  }
}

function resolveFallbackValue(
  valuesByMode: Variable['valuesByMode'],
  modeId: string,
  collection: VariableCollectionInfo | null
): unknown {
  if (valuesByMode[modeId] !== undefined) return valuesByMode[modeId]
  if (collection?.defaultModeId && collection.defaultModeId !== modeId) {
    const fallback = valuesByMode[collection.defaultModeId]
    if (fallback !== undefined) return fallback
  }
  return valuesByMode[modeId]
}

function isVariableAlias(value: unknown): value is VariableAlias {
  if (!value || typeof value !== 'object') return false
  const alias = value as VariableAlias
  return typeof alias.id === 'string'
}

function serializeVariableValue(
  value: unknown,
  resolvedType: Variable['resolvedType'],
  config: CodegenConfig,
  canonicalName?: string
): string | Record<string, unknown> | null {
  if (value == null) return null

  switch (resolvedType) {
    case 'COLOR':
      return formatHexAlpha(value as RGBA, (value as RGBA).a)
    case 'FLOAT':
      if (isUnitlessFloatToken(canonicalName)) {
        return String(value)
      }
      // Default: treat numbers as pixels and normalize (e.g. 16 -> 1rem)
      return normalizeCssValue(`${value}px`, config)
    case 'BOOLEAN':
      return (value as boolean).toString()
    case 'STRING':
      return String(value)
    default:
      if (typeof value === 'object') {
        return value as Record<string, unknown>
      }
      return null
  }
}

function isUnitlessFloatToken(canonicalName?: string): boolean {
  if (!canonicalName) return false
  const lower = canonicalName.trim().toLowerCase()
  if (!lower.startsWith('--')) return false

  // Typography weights are unitless.
  if (lower.startsWith('--font-weight')) return true
  if (lower.startsWith('--fontweight')) return true

  // Opacity values are unitless.
  if (lower.startsWith('--opacity')) return true

  // z-index values are unitless.
  if (lower.startsWith('--z-index')) return true
  if (lower === '--z') return true
  if (lower.startsWith('--z-')) return true

  return false
}

async function resolveAliasName(
  id: string,
  index: Awaited<ReturnType<typeof getTokenIndex>>,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string | undefined> {
  const fromIndex = index.canonicalNameById.get(id)
  if (fromIndex) return fromIndex

  // Fallback for non-local variables.
  try {
    const v = figma.variables.getVariableById(id)
    if (!v) return undefined
    // Ensure it still matches the plugin canonicalization semantics.
    return await canonicalizeName(v.name, config, pluginCode)
  } catch {
    return undefined
  }
}

function modeKeyForCollection(collection: VariableCollectionInfo | null, modeId: string): string {
  const found = collection?.modes?.find((m) => m.id === modeId)
  const modeName = found?.name || modeId
  const collectionName = collection?.name
  return collectionName ? `${collectionName}:${modeName}` : modeName
}

function mapResolvedType(resolvedType?: string): TokenEntry['kind'] {
  switch (resolvedType) {
    case 'COLOR':
      return 'color'
    case 'FLOAT':
      return 'number'
    case 'STRING':
      return 'string'
    case 'BOOLEAN':
      return 'boolean'
    default:
      return 'string'
  }
}

function toLiteralString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value ?? '')
}
