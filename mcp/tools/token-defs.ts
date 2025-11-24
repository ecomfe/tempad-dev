import type { GetTokenDefsResult } from '@/mcp-server/src/tools'
import { rgbaToCss } from '@/utils/color'
import { canonicalizeVariable } from '@/utils/css'
import { runTransformVariableBatch } from '@/mcp/transform-variable'
import { activePlugin, options } from '@/ui/state'

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
type VariableAlias = { id?: string } | { type?: string; id?: string }
type VariableWithCollection = Variable & { variableCollectionId?: string }
type VariableCollectionInfo = { defaultModeId?: string }

export async function handleGetTokenDefs(nodes: SceneNode[]): Promise<GetTokenDefsResult> {
  const { variableIds } = collectTokenReferences(nodes)
  const tokens = await resolveVariableTokens(variableIds)
  tokens.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return { tokens }
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

function collectTokenReferences(roots: SceneNode[]): {
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

async function resolveVariableTokens(ids: Set<string>): Promise<TokenEntry[]> {
  const references: Array<{ rawName: string }> = []
  const pending: Array<{ rawName: string; value: TokenEntry['value']; kind: TokenEntry['kind'] }> =
    []

  ids.forEach((id) => {
    const variable = figma.variables.getVariableById(id)
    if (!variable) {
      return
    }

    const collection = resolveVariableCollection(variable)
    const defaultModeId = pickDefaultModeId(variable, collection)
    const value = formatVariableValue(variable, defaultModeId, collection)
    if (value == null) {
      return
    }

    references.push({ rawName: variable.name })
    pending.push({ rawName: variable.name, value, kind: inferVariableKind(variable) })
  })

  if (!pending.length) return []

  const transformedNames = await transformVariableNames(references)

  const deduped = new Map<string, TokenEntry>()
  pending.forEach((item, index) => {
    const name = transformedNames[index] ?? item.rawName
    if (!deduped.has(name)) {
      deduped.set(name, {
        name,
        value: item.value,
        kind: item.kind
      })
    }
  })

  return Array.from(deduped.values())
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
      Object.values(variableReferences).forEach((entry) => collectVariableIdFromValue(entry, bucket))
    }
  }

  if ('exportSettings' in node) {
    const { exportSettings } = node
    if (Array.isArray(exportSettings)) {
      exportSettings.forEach((setting) => collectVariableIdFromValue(setting, bucket))
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
  if (!value) {
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableIdFromValue(item, bucket))
    return
  }

  if (typeof value === 'object') {
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
  if (!collectionId) {
    return null
  }

  try {
    const collection = figma.variables.getVariableCollectionById(collectionId)
    if (!collection) return null
    return { defaultModeId: collection.defaultModeId }
  } catch {
    return null
  }
}

function pickDefaultModeId(
  variable: Variable,
  collection?: VariableCollectionInfo | null
): string | undefined {
  const { valuesByMode = {} } = variable
  if (collection?.defaultModeId && collection.defaultModeId in valuesByMode) {
    return collection.defaultModeId
  }
  const modeId = Object.keys(valuesByMode)[0]
  return modeId
}

function resolveVariableValueForMode(
  variable: Variable,
  modeId: string,
  collection?: VariableCollectionInfo | null,
  seen: Set<string> = new Set()
): unknown {
  const { valuesByMode = {} } = variable
  if (seen.has(variable.id)) {
    return null
  }
  seen.add(variable.id)

  const rawValue = valuesByMode[modeId]
  if (isVariableAlias(rawValue)) {
    const target = figma.variables.getVariableById(rawValue.id)
    if (!target) {
      return rawValue
    }
    const targetCollection = resolveVariableCollection(target)
    const targetModeId = pickDefaultModeId(target, targetCollection) ?? modeId
    return resolveVariableValueForMode(target, targetModeId, targetCollection, seen)
  }

  if (rawValue === undefined && collection?.defaultModeId && collection.defaultModeId !== modeId) {
    const fallback = valuesByMode[collection.defaultModeId]
    if (fallback !== undefined) {
      return fallback
    }
  }

  return rawValue
}

function isVariableAlias(value: unknown): value is VariableAlias {
  if (!value || typeof value !== 'object') {
    return false
  }
  const alias = value as VariableAlias
  return typeof alias.id === 'string'
}

function formatVariableValue(
  variable: Variable,
  modeId: string | undefined,
  collection?: VariableCollectionInfo | null
): string | Record<string, unknown> | null {
  const { resolvedType } = variable
  const effectiveMode = modeId ?? pickDefaultModeId(variable, collection)
  if (!effectiveMode) {
    return null
  }

  const resolved = resolveVariableValueForMode(variable, effectiveMode, collection)
  if (resolved == null) {
    return null
  }

  return serializeVariableValue(resolved, resolvedType)
}

function serializeVariableValue(
  value: unknown,
  resolvedType: Variable['resolvedType']
): string | Record<string, unknown> | null {
  if (value == null) {
    return null
  }

  switch (resolvedType) {
    case 'COLOR':
      return rgbaToCss(value as RGBA)
    case 'FLOAT':
      return formatNumericValue(value as number)
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

function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return toFixed(value)
}

async function transformVariableNames(references: Array<{ rawName: string }>): Promise<string[]> {
  if (!references.length) return []

  const transformRefs = references.map(({ rawName }) => ({
    code: `var(--${rawName})`,
    name: rawName
  }))

  const replacements = await runTransformVariableBatch(
    transformRefs,
    {
      useRem: options.value.cssUnit === 'rem',
      rootFontSize: options.value.rootFontSize,
      scale: options.value.scale
    },
    activePlugin.value?.code
  )

  return replacements.map((expr, idx) => {
    const fallback = transformRefs[idx]
    const canonical =
      canonicalizeVariable(expr)?.match(/^var\((--[^)]+)\)$/)?.[1] ??
      canonicalizeVariable(fallback.code)?.match(/^var\((--[^)]+)\)$/)?.[1]
    return canonical ?? fallback.name
  })
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

function toFixed(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
