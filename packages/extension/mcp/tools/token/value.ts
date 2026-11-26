import type { CodegenConfig } from '@/utils/codegen'

import { formatHexAlpha, normalizeCssValue } from '@/utils/css'

type VariableAlias = { id: string; type?: string }

export function isVariableAlias(value: unknown): value is VariableAlias {
  return !!value && typeof value === 'object' && typeof (value as VariableAlias).id === 'string'
}

export function serializeVariableValue(
  value: unknown,
  resolvedType: Variable['resolvedType'],
  config: CodegenConfig,
  canonicalName?: string,
  unitless?: boolean,
  preserveZeroUnit = false
): string | null {
  if (value == null) return null

  switch (resolvedType) {
    case 'COLOR':
      return formatHexAlpha(value as RGBA, (value as RGBA).a)
    case 'FLOAT':
      if (unitless ?? isUnitlessFloatToken(canonicalName)) return String(value)
      // Token units must remain stable across modes, including zero, so typed
      // arithmetic can consume a length token without changing its dimension.
      if (preserveZeroUnit && value === 0) return config.cssUnit === 'rem' ? '0rem' : '0px'
      return normalizeCssValue(`${value}px`, config)
    case 'BOOLEAN':
      return (value as boolean).toString()
    case 'STRING':
      return String(value)
    default:
      return null
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
