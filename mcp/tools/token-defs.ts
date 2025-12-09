import type { GetTokenDefsResult } from '@/mcp-server/src/tools'
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

const COLOR_SCOPE_HINTS = ['COLOR', 'FILL', 'STROKE', 'TEXT_FILL']
const TYPO_SCOPE_HINTS = [
  'FONT',
  'TEXT',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'FONT_SIZE',
  'FONT_WEIGHT',
  'PARAGRAPH_SPACING',
  'TEXT_CONTENT'
]
const EFFECT_SCOPE_HINTS = [
  'DROP_SHADOW',
  'INNER_SHADOW',
  'LAYER_BLUR',
  'BACKGROUND_BLUR',
  'EFFECT'
]
const SPACING_SCOPE_HINTS = [
  'WIDTH',
  'HEIGHT',
  'GAP',
  'SPACING',
  'PADDING',
  'MARGIN',
  'CORNER_RADIUS'
]

type TokenEntry = GetTokenDefsResult['tokens'][number]
type TokenModeValue = NonNullable<TokenEntry['current']>
type VariableAlias = { id?: string } | { type?: string; id?: string }
type VariableWithCollection = Variable & { variableCollectionId?: string }
type VariableCollectionInfo = {
  id?: string
  name?: string
  defaultModeId?: string
  activeModeId?: string
}

export async function handleGetTokenDefs(
  names: string[],
  includeAllModes = false
): Promise<GetTokenDefsResult> {
  const config = getCodegenConfig()
  const pluginCode = activePlugin.value?.code

  const requested = new Set(names.map((n) => (n.startsWith('--') ? n : `--${n}`)))
  const variables = await findVariablesByCanonicalName(requested, config, pluginCode)
  const tokens = await buildTokenEntries(variables, config, pluginCode, includeAllModes)

  tokens.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const payload: GetTokenDefsResult = { tokens }
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
): Promise<TokenEntry[]> {
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
): Promise<TokenEntry[]> {
  if (!variables.length) return []

  const references = variables.map((variable) => ({ rawName: variable.name }))
  const canonicalNames = await transformVariableNames(references, config, pluginCode)

  const deduped = new Map<string, TokenEntry>()

  variables.forEach((variable, index) => {
    const canonicalName = canonicalNames[index] ?? normalizeCssVarName(variable.name)
    const collection = resolveVariableCollection(variable)
    const preferredModeId = pickPreferredModeId(variable, collection)
    const current = preferredModeId
      ? resolveModeValue(variable, preferredModeId, collection, config)
      : {
          modeId: '',
          resolved: null
        }
    const modes = includeAllModes
      ? resolveAllModes(variable, collection, config, preferredModeId)
      : undefined

    const token: TokenEntry = {
      name: canonicalName,
      value: current.resolved,
      current,
      ...(modes ? { modes } : {}),
      ...(collection ? { collection } : {}),
      kind: inferVariableKind(variable)
    }
    if (!deduped.has(token.name)) {
      deduped.set(token.name, token)
    }
  })

  return Array.from(deduped.values())
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
      activeModeId: readActiveModeId(collection.id)
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

function resolveModeValue(
  variable: Variable,
  modeId: string,
  collection: VariableCollectionInfo | null,
  config: CodegenConfig,
  seen: Set<string> = new Set()
): TokenModeValue {
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
    const resolvedTarget = resolveModeValue(target, targetModeId, targetCollection, config, seen)
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

function resolveAllModes(
  variable: Variable,
  collection: VariableCollectionInfo | null,
  config: CodegenConfig,
  preferredModeId?: string
): Array<Omit<TokenModeValue, 'aliasChain'>> {
  const { valuesByMode = {} } = variable
  const modeIds = Object.keys(valuesByMode)
  if (!modeIds.length && preferredModeId) {
    const current = resolveModeValue(variable, preferredModeId, collection, config)
    const { aliasChain: _aliasChain, ...rest } = current
    return [rest]
  }

  return modeIds.map((modeId) => {
    const resolved = resolveModeValue(variable, modeId, collection, config)
    const { aliasChain: _aliasChain, ...rest } = resolved
    return rest
  })
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

function inferVariableKind(variable: Variable): TokenEntry['kind'] {
  const { resolvedType, scopes = [] } = variable
  const normalizedScopes = scopes.map((scope) => scope.toUpperCase())

  if (resolvedType === 'COLOR' || hasScope(normalizedScopes, COLOR_SCOPE_HINTS)) {
    return 'color'
  }

  if (hasScope(normalizedScopes, TYPO_SCOPE_HINTS)) {
    return 'typography'
  }

  if (hasScope(normalizedScopes, EFFECT_SCOPE_HINTS)) {
    return 'effect'
  }

  if (hasScope(normalizedScopes, SPACING_SCOPE_HINTS)) {
    return 'spacing'
  }

  return 'other'
}

function hasScope(scopes: string[], hints: string[]): boolean {
  return scopes.some((scope) => hints.includes(scope))
}

function getCodegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}
