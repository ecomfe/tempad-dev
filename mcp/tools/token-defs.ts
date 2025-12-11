import type { GetTokenDefsResult, TokenEntry } from '@/mcp-server/src/tools'
import type { CodegenConfig } from '@/utils/codegen'

import { MCP_MAX_PAYLOAD_BYTES } from '@/mcp/shared/constants'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { activePlugin, options } from '@/ui/state'
import {
  canonicalizeVariable,
  formatHexAlpha,
  normalizeCssValue,
  normalizeCssVarName
} from '@/utils/css'

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

export async function handleGetTokenDefs(
  names: string[],
  includeAllModes = false
): Promise<GetTokenDefsResult> {
  const config = getCodegenConfig()
  const pluginCode = activePlugin.value?.code

  const requested = new Set(names.map((n) => (n.startsWith('--') ? n : `--${n}`)))
  const variables = await findVariablesByCanonicalName(requested, config, pluginCode)
  const payload = await buildTokenEntries(variables, config, pluginCode, includeAllModes)
  const approxSize = JSON.stringify(payload).length
  if (approxSize > MCP_MAX_PAYLOAD_BYTES) {
    throw new Error(
      'Token payload too large to return. Reduce selection or requested names and retry.'
    )
  }

  return payload
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

export function collectTokenReferences(roots: SceneNode[]): {
  variableIds: Set<string>
} {
  const variableIds = new Set<string>()

  const visit = (node: SceneNode) => {
    collectVariableIds(node, variableIds)

    if (hasChildren(node)) {
      node.children.forEach((child) => {
        if (child.visible) {
          visit(child)
        }
      })
    }
  }

  roots.forEach((root) => {
    if (root.visible) {
      visit(root)
    }
  })

  return { variableIds }
}

export async function resolveVariableTokens(
  ids: Set<string>,
  config: CodegenConfig,
  pluginCode?: string,
  options: { includeAllModes?: boolean } = {}
): Promise<GetTokenDefsResult> {
  const variables: Variable[] = []
  ids.forEach((id) => {
    const variable = figma.variables.getVariableById(id)
    if (variable) variables.push(variable)
  })
  return buildTokenEntries(variables, config, pluginCode, !!options.includeAllModes)
}

async function buildTokenEntries(
  variables: Variable[],
  config: CodegenConfig,
  pluginCode: string | undefined,
  includeAllModes: boolean
): Promise<GetTokenDefsResult> {
  if (!variables.length) return { tokens: {} }

  const references = variables.map((variable) => ({ rawName: variable.name }))
  const canonicalNames = await transformVariableNames(references, config, pluginCode)

  const tokens: Record<string, TokenEntry> = {}

  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index]
    const canonicalName = canonicalNames[index] ?? normalizeCssVarName(variable.name)
    const collection = resolveVariableCollection(variable)
    const preferredModeId = pickPreferredModeId(variable, collection)
    const modeIds = includeAllModes
      ? Object.keys(variable.valuesByMode ?? {})
      : preferredModeId
        ? [preferredModeId]
        : []

    const valueMap: Record<string, string> = {}
    for (const modeId of modeIds) {
      const mv = await resolveModeValue(variable, modeId, collection, config, pluginCode)
      const modeKey = modeName(collection, modeId)
      const resolvedLiteral = toLiteralString(mv.resolved)
      const aliasName = mv.aliasTo
        ? await resolveAliasName(mv.aliasTo, config, pluginCode)
        : undefined
      valueMap[modeKey] = aliasName ?? resolvedLiteral
    }

    const primaryModeId = collection?.activeModeId ?? preferredModeId ?? modeIds[0]
    const primaryModeName = primaryModeId ? modeName(collection, primaryModeId) : undefined
    const resolvedValue =
      (primaryModeName && valueMap[primaryModeName]) ||
      (modeIds.length ? valueMap[modeName(collection, modeIds[0])] : '')

    const value: string | Record<string, string> = modeIds.length <= 1 ? resolvedValue : valueMap

    tokens[canonicalName] = {
      kind: mapResolvedType(variable.resolvedType),
      value,
      resolvedValue,
      ...(modeIds.length > 1 && primaryModeName ? { activeMode: primaryModeName } : {})
    }
  }

  return { tokens }
}

async function findVariablesByCanonicalName(
  requested: Set<string>,
  config: CodegenConfig,
  pluginCode?: string
): Promise<Variable[]> {
  if (!requested.size) return []

  const allVariables = await getAllVariables()
  if (!allVariables.length) return []

  const references = allVariables.map((variable) => ({ rawName: variable.name }))
  const canonicalNames = await transformVariableNames(references, config, pluginCode)

  const result: Variable[] = []
  canonicalNames.forEach((name, index) => {
    if (requested.has(name)) {
      result.push(allVariables[index])
    }
  })
  return result
}

function collectVariableIds(node: SceneNode, bucket: Set<string>): void {
  if ('boundVariables' in node) {
    const { boundVariables } = node
    if (boundVariables) {
      Object.values(boundVariables).forEach((entry) => collectVariableIdFromValue(entry, bucket))
    }
  }

  if ('inferredVariables' in node) {
    const { inferredVariables } = node
    if (inferredVariables) {
      Object.values(inferredVariables).forEach((entry) => collectVariableIdFromValue(entry, bucket))
    }
  }

  if ('variableReferences' in node) {
    const { variableReferences } = node
    if (variableReferences) {
      Object.values(variableReferences).forEach((entry) =>
        collectVariableIdFromValue(entry, bucket)
      )
    }
  }

  if ('fills' in node) {
    const { fills } = node
    if (Array.isArray(fills)) {
      fills.forEach((fill) => collectVariableIdFromValue(fill, bucket))
    }
  }

  if ('strokes' in node) {
    const { strokes } = node
    if (Array.isArray(strokes)) {
      strokes.forEach((stroke) => collectVariableIdFromValue(stroke, bucket))
    }
  }

  if ('effects' in node) {
    const { effects } = node
    if (Array.isArray(effects)) {
      effects.forEach((effect) => collectVariableIdFromValue(effect, bucket))
    }
  }
}

function collectVariableIdFromValue(value: unknown, bucket: Set<string>): void {
  if (!value) return

  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableIdFromValue(item, bucket))
    return
  }

  if (typeof value === 'object') {
    if (
      'visible' in (value as { visible?: boolean }) &&
      (value as { visible?: boolean }).visible === false
    ) {
      return
    }

    const alias = value as VariableAlias
    if (alias && typeof alias.id === 'string') {
      bucket.add(alias.id)
      return
    }

    Object.values(value).forEach((nested) => collectVariableIdFromValue(nested, bucket))
  }
}

function resolveVariableCollection(variable: Variable): VariableCollectionInfo | null {
  const collectionId = (variable as VariableWithCollection).variableCollectionId
  if (!collectionId) return null

  try {
    const collection = figma.variables.getVariableCollectionById(collectionId)
    if (!collection) return null
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
    console.warn('[tempad-dev] Failed to resolve variable collection:', error)
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
  } catch (error) {
    console.warn('[tempad-dev] Failed to read active mode id:', error)
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
  seen: Set<string> = new Set()
): Promise<TokenModeValue> {
  const { valuesByMode = {} } = variable
  if (seen.has(variable.id)) {
    return { modeId, resolved: null, aliasChain: [] }
  }
  seen.add(variable.id)

  const rawValue = valuesByMode[modeId] ?? resolveFallbackValue(valuesByMode, modeId, collection)

  if (isVariableAlias(rawValue)) {
    const target = figma.variables.getVariableById(rawValue.id)
    if (!target) {
      return { modeId, aliasTo: rawValue.id, resolved: null, aliasChain: [rawValue.id] }
    }
    const targetCollection = resolveVariableCollection(target)
    const targetModeId = pickPreferredModeId(target, targetCollection, modeId) ?? modeId
    const resolvedTarget = await resolveModeValue(
      target,
      targetModeId,
      targetCollection,
      config,
      pluginCode,
      seen
    )
    const chain = [rawValue.id, ...(resolvedTarget.aliasChain ?? [])]
    return {
      modeId,
      aliasTo: rawValue.id,
      resolved: resolvedTarget.resolved,
      aliasChain: chain.length ? chain : undefined
    }
  }

  const serialized = serializeVariableValue(rawValue, variable.resolvedType, config)
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
  config: CodegenConfig
): string | Record<string, unknown> | null {
  if (value == null) return null

  switch (resolvedType) {
    case 'COLOR':
      return formatHexAlpha(value as RGBA, (value as RGBA).a)
    case 'FLOAT':
      // Treat numbers as pixels and normalize (e.g. 16 -> 1rem)
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

async function transformVariableNames(
  references: Array<{ rawName: string }>,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string[]> {
  if (!references.length) return []

  const transformRefs = references.map(({ rawName }) => {
    const name = normalizeCssVarName(rawName)
    return { code: `var(--${name})`, name }
  })

  const replacements = await runTransformVariableBatch(
    transformRefs,
    {
      useRem: config.cssUnit === 'rem',
      rootFontSize: config.rootFontSize ?? 16,
      scale: config.scale ?? 1
    },
    pluginCode
  )

  return replacements.map((expr, idx) => {
    const fallback = transformRefs[idx]
    const canonical = canonicalizeVariable(expr)
    const nameMatch = canonical?.match(/^var\((--[^)]+)\)$/)

    return nameMatch ? nameMatch[1] : (canonical ?? fallback.name)
  })
}

async function getAllVariables(): Promise<Variable[]> {
  const variablesApi = (figma as unknown as { variables?: Record<string, unknown> }).variables
  if (!variablesApi) return []

  const asyncGetter = (variablesApi as { getLocalVariablesAsync?: () => Promise<Variable[]> })
    .getLocalVariablesAsync
  if (typeof asyncGetter === 'function') {
    try {
      return await asyncGetter()
    } catch (error) {
      console.warn('[tempad-dev] Failed to read variables async:', error)
    }
  }

  const syncGetter = (variablesApi as { getLocalVariables?: () => Variable[] }).getLocalVariables
  if (typeof syncGetter === 'function') {
    try {
      return syncGetter()
    } catch (error) {
      console.warn('[tempad-dev] Failed to read variables:', error)
    }
  }

  return []
}

async function resolveAliasName(
  id: string,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string | undefined> {
  try {
    const v = figma.variables.getVariableById(id)
    if (!v) return undefined
    return await canonicalizeName(v.name, config, pluginCode)
  } catch {
    return undefined
  }
}

function modeName(collection: VariableCollectionInfo | null, modeId: string): string {
  const found = collection?.modes?.find((m) => m.id === modeId)
  return found?.name || modeId
}

async function canonicalizeName(
  rawName: string,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string> {
  const [result] = await transformVariableNames([{ rawName }], config, pluginCode)
  return result ?? normalizeCssVarName(rawName)
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

function getCodegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}
