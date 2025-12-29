import type { CodegenConfig } from '@/utils/codegen'

import {
  formatHexAlpha,
  normalizeCssValue,
  normalizeFigmaVarName,
  replaceVarFunctions
} from '@/utils/css'

import { getVariableRawName } from '../../token/indexer'
import { getVariableByIdCached } from './cache'

type VariableAlias = { id?: string } | { type?: string; id?: string }
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

  const { valuesByMode = {} } = variable
  const rawValue = valuesByMode[modeId] ?? resolveFallbackValue(valuesByMode, modeId, collection)

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
  if (cache.has(collectionId)) return cache.get(collectionId) ?? null

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

function readActiveModeId(collectionId?: string): string | undefined {
  if (!collectionId) return undefined
  const variablesApi = (
    figma as unknown as { variables?: { getVariableModeId?: (id: string) => string } }
  ).variables
  const getter = variablesApi?.getVariableModeId
  if (typeof getter !== 'function') return undefined
  try {
    return getter(collectionId)
  } catch {
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

  if (lower.startsWith('--font-weight')) return true
  if (lower.startsWith('--fontweight')) return true
  if (lower.startsWith('--opacity')) return true
  if (lower.startsWith('--z-index')) return true
  if (lower === '--z') return true
  if (lower.startsWith('--z-')) return true

  return false
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
