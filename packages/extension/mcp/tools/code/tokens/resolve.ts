import type { CodegenConfig } from '@/utils/codegen'

import { normalizeFigmaVarName, replaceVarFunctions } from '@/utils/css'

import { getVariableRawName } from '../../token/indexer'
import {
  isVariableAlias,
  pickPreferredModeId,
  readActiveModeId,
  resolveFallbackValue,
  serializeVariableValue
} from '../../token/value'
import { getVariableByIdCached } from './cache'

type VariableWithCollection = Variable & { variableCollectionId?: string; resolvedType?: string }
type VariableCollectionInfo = {
  id?: string
  defaultModeId?: string
  activeModeId?: string
}

export type StyleVarResolver = (
  style: Record<string, string>,
  node?: SceneNode
) => Record<string, string>

export function createStyleVarResolver(
  sourceIndex: Map<string, string>,
  cache: Map<string, Variable | null>,
  config: CodegenConfig,
  resolveNodeIds?: Set<string>,
  tokenMatcher?: (value: string) => boolean
): StyleVarResolver {
  const valueCache = new Map<string, string | undefined>()
  const collectionCache = new Map<string, VariableCollectionInfo | null>()
  const canonicalNameCache = new Map<string, string>()

  const resolveValueById = (
    id: string,
    modeOverrides?: Record<string, string>
  ): string | undefined => {
    const variable = getVariableByIdCached(id, cache)
    if (!variable) return undefined
    const collection = resolveVariableCollection(variable, collectionCache)
    const desiredMode = collection?.id ? modeOverrides?.[collection.id] : undefined
    const modeId = pickPreferredModeId(variable, collection, desiredMode)
    if (!modeId) return undefined
    return resolveVariableValue(variable, modeId, collection, modeOverrides, {
      valueCache,
      canonicalNameCache,
      config,
      cache,
      collectionCache
    })
  }

  return (style: Record<string, string>, node?: SceneNode): Record<string, string> => {
    if (!style || !Object.keys(style).length) return style
    if (resolveNodeIds && node?.id && !resolveNodeIds.has(node.id)) return style
    const modeOverrides = readNodeResolvedModes(node)
    let next: Record<string, string> | undefined

    for (const [key, raw] of Object.entries(style)) {
      if (!raw) {
        if (next) next[key] = raw
        continue
      }
      if (tokenMatcher && !tokenMatcher(raw)) {
        if (next) next[key] = raw
        continue
      }
      const updated = replaceVarFunctions(raw, ({ name, full }) => {
        const trimmed = name.trim()
        if (!trimmed.startsWith('--')) return full
        const canonical = normalizeFigmaVarName(trimmed)
        const varId = sourceIndex.get(canonical) ?? sourceIndex.get(trimmed)
        if (!varId) return full
        const resolved = resolveValueById(varId, modeOverrides)
        return resolved ?? full
      })

      if (updated !== raw) {
        if (!next) next = { ...style }
        next[key] = updated
      } else if (next) {
        next[key] = raw
      }
    }

    return next ?? style
  }
}

export function resolveStyleMap(
  styles: Map<string, Record<string, string>>,
  nodes: Map<string, SceneNode>,
  resolver: StyleVarResolver
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  for (const [id, style] of styles.entries()) {
    const node = nodes.get(id)
    out.set(id, resolver(style, node))
  }
  return out
}

type ResolveValueContext = {
  valueCache: Map<string, string | undefined>
  canonicalNameCache: Map<string, string>
  config: CodegenConfig
  cache: Map<string, Variable | null>
  collectionCache: Map<string, VariableCollectionInfo | null>
}

function resolveVariableValue(
  variable: Variable,
  modeId: string,
  collection: VariableCollectionInfo | null,
  modeOverrides: Record<string, string> | undefined,
  ctx: ResolveValueContext,
  seen: Set<string> = new Set()
): string | undefined {
  const cacheKey = `${variable.id}:${modeId}`
  if (ctx.valueCache.has(cacheKey)) return ctx.valueCache.get(cacheKey)
  if (seen.has(variable.id)) return undefined
  seen.add(variable.id)

  const valuesByMode = variable.valuesByMode
  const rawValue = resolveFallbackValue(valuesByMode, modeId, collection)

  if (isVariableAlias(rawValue)) {
    const target = getVariableByIdCached(rawValue.id, ctx.cache)
    if (!target) {
      ctx.valueCache.set(cacheKey, undefined)
      return undefined
    }
    const targetCollection = resolveVariableCollection(target, ctx.collectionCache)
    const desiredMode = targetCollection?.id ? modeOverrides?.[targetCollection.id] : undefined
    const targetModeId = pickPreferredModeId(target, targetCollection, desiredMode ?? modeId)
    if (!targetModeId) {
      ctx.valueCache.set(cacheKey, undefined)
      return undefined
    }
    const resolved = resolveVariableValue(
      target,
      targetModeId,
      targetCollection,
      modeOverrides,
      ctx,
      seen
    )
    ctx.valueCache.set(cacheKey, resolved)
    return resolved
  }

  const canonicalName =
    ctx.canonicalNameCache.get(variable.id) ?? normalizeFigmaVarName(getVariableRawName(variable))
  ctx.canonicalNameCache.set(variable.id, canonicalName)

  const serialized = serializeVariableValue(
    rawValue,
    (variable as VariableWithCollection).resolvedType,
    ctx.config,
    canonicalName
  )
  const literal = serialized != null ? toLiteralString(serialized) : undefined
  ctx.valueCache.set(cacheKey, literal)
  return literal
}

function readNodeResolvedModes(node?: SceneNode): Record<string, string> | undefined {
  if (!node || !('resolvedVariableModes' in node)) return undefined
  const resolved = (node as { resolvedVariableModes?: Record<string, string> })
    .resolvedVariableModes
  if (!resolved || typeof resolved !== 'object') return undefined
  return resolved
}

function resolveVariableCollection(
  variable: Variable,
  cache: Map<string, VariableCollectionInfo | null>
): VariableCollectionInfo | null {
  const collectionId = (variable as VariableWithCollection).variableCollectionId
  if (!collectionId) return null
  if (cache.has(collectionId)) return cache.get(collectionId) as VariableCollectionInfo | null

  try {
    const collection = figma.variables.getVariableCollectionById(collectionId)
    if (!collection) {
      cache.set(collectionId, null)
      return null
    }
    const info: VariableCollectionInfo = {
      id: collection.id,
      defaultModeId: collection.defaultModeId,
      activeModeId: readActiveModeId(collection.id)
    }
    cache.set(collectionId, info)
    return info
  } catch {
    cache.set(collectionId, null)
    return null
  }
}

function toLiteralString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'symbol') return undefined
  try {
    const serialized = JSON.stringify(value)
    if (serialized !== undefined) return serialized
  } catch {
    // fallback below
  }
  const fallback = String(value)
  return fallback === 'undefined' ? undefined : fallback
}
