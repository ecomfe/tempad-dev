import type { CodegenConfig } from '@/utils/codegen'

import { formatHexAlpha, normalizeCssValue } from '@/utils/css'

type VariableAlias = { id: string; type?: string }

type VariableModeContext = {
  activeModeId?: string
  defaultModeId?: string
}

export function isVariableAlias(value: unknown): value is VariableAlias {
  return !!value && typeof value === 'object' && typeof (value as VariableAlias).id === 'string'
}

export function readActiveModeId(
  collectionId?: string,
  onError?: (error: unknown) => void
): string | undefined {
  if (!collectionId) return undefined
  const getter = (
    figma as unknown as { variables?: { getVariableModeId?: (id: string) => string } }
  ).variables?.getVariableModeId
  if (typeof getter !== 'function') return undefined
  try {
    return getter(collectionId)
  } catch (error) {
    onError?.(error)
    return undefined
  }
}

export function pickPreferredModeId(
  variable: Variable,
  collection?: VariableModeContext | null,
  desiredModeId?: string
): string | undefined {
  const valuesByMode = variable.valuesByMode ?? {}
  if (desiredModeId && desiredModeId in valuesByMode) return desiredModeId
  if (collection?.activeModeId && collection.activeModeId in valuesByMode) {
    return collection.activeModeId
  }
  if (collection?.defaultModeId && collection.defaultModeId in valuesByMode) {
    return collection.defaultModeId
  }
  return Object.keys(valuesByMode)[0]
}

export function resolveFallbackValue(
  valuesByMode: Variable['valuesByMode'],
  modeId: string,
  collection: VariableModeContext | null
): unknown {
  if (valuesByMode[modeId] !== undefined) return valuesByMode[modeId]
  if (collection?.defaultModeId && collection.defaultModeId !== modeId) {
    const fallback = valuesByMode[collection.defaultModeId]
    if (fallback !== undefined) return fallback
  }
  return valuesByMode[modeId]
}

export function serializeVariableValue(
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
      return isUnitlessFloatToken(canonicalName)
        ? String(value)
        : normalizeCssValue(`${value}px`, config)
    case 'BOOLEAN':
      return (value as boolean).toString()
    case 'STRING':
      return String(value)
    default:
      return typeof value === 'object' ? (value as Record<string, unknown>) : null
  }
}

function isUnitlessFloatToken(canonicalName?: string): boolean {
  const name = canonicalName?.trim().toLowerCase()
  if (!name?.startsWith('--')) return false
  return (
    name.startsWith('--font-weight') ||
    name.startsWith('--fontweight') ||
    name.startsWith('--opacity') ||
    name.startsWith('--z-index') ||
    name === '--z' ||
    name.startsWith('--z-')
  )
}
