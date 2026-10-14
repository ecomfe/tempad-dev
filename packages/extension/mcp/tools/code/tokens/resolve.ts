import type { GetTokenDefsResult } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { normalizeFigmaVarName, replaceVarFunctions } from '@/utils/css'

import type { TokenReadContext } from '../../token/context'
import type { ReportTokenDiagnostic } from './diagnostics'

import { createTokenReadContext } from '../../token/context'
import { getVariableRawName } from '../../token/indexer'
import { serializeVariableValue } from '../../token/value'

export type StyleVarResolver = (
  style: Record<string, string>,
  node?: SceneNode
) => Record<string, string>

// Fields whose numeric native bindings represent lengths. Mixed-dimension
// shorthand/function values are left to their existing property-specific paths.
const LENGTH_PROPERTIES = new Set([
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'gap',
  'row-gap',
  'column-gap',
  'flex-basis',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-x',
  'inset-y',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'stroke-width',
  'font-size',
  'letter-spacing',
  'text-indent'
])

export function createStyleVarResolver(
  sourceIndex: Map<string, string>,
  cache: Map<string, Variable | null>,
  config: CodegenConfig,
  resolveNodeIds?: Set<string>,
  tokenMatcher?: (value: string) => boolean,
  context = createTokenReadContext(config, undefined, cache),
  report?: ReportTokenDiagnostic
): StyleVarResolver {
  // Consumer styles share the native-pixel stage; class rendering owns unit conversion.
  const styleConfig = { ...config, cssUnit: 'px' as const, scale: 1 }
  // Serialization is local to this renderer; only native values are shared between roots.
  const literals = new Map<string, Map<string, string | undefined>>()
  const resolve = (id: string, property: string, node?: SceneNode): string | undefined => {
    if (!node) return undefined
    let values = literals.get(node.id)
    if (!values) literals.set(node.id, (values = new Map()))
    const key = `${id}:${property}`
    if (!values.has(key)) {
      const variable = context.getVariable(id)
      const resolved = variable ? resolveForConsumer(variable, node, context) : null
      let literal: string | undefined
      if (resolved && variable) {
        try {
          let value = resolved.value
          if (
            property === 'opacity' &&
            resolved.resolvedType === 'FLOAT' &&
            typeof value === 'number'
          ) {
            value /= 100
          }
          literal =
            serializeVariableValue(
              value,
              resolved.resolvedType,
              styleConfig,
              normalizeFigmaVarName(getVariableRawName(variable)),
              /^(font-weight|opacity|fill-opacity|stroke-opacity|z-index|flex-grow|flex-shrink|order)$/.test(
                property
              )
                ? true
                : LENGTH_PROPERTIES.has(property)
                  ? false
                  : undefined
            ) ?? undefined
        } catch {
          // Unusable native values remain references and receive the same bounded diagnostic.
        }
      }
      values.set(key, literal)
    }
    return values.get(key)
  }

  return (style, node) => {
    if (resolveNodeIds && node && !resolveNodeIds.has(node.id)) return style
    let next: Record<string, string> | undefined
    for (const [key, raw] of Object.entries(style)) {
      if (!raw || (tokenMatcher && !tokenMatcher(raw))) continue
      const updated = replaceVarFunctions(raw, ({ name, full }) => {
        const trimmed = name.trim()
        const id = sourceIndex.get(normalizeFigmaVarName(trimmed)) ?? sourceIndex.get(trimmed)
        if (!id) return full
        const literal = resolve(id, key, node)
        if (literal === undefined) {
          report?.('token-resolution', `Variable ${id}, node ${node?.id ?? 'unavailable'}.`)
        }
        return literal ?? full
      })
      if (updated !== raw) {
        next ??= { ...style }
        next[key] = updated
      }
    }
    return next ?? style
  }
}

export function createTokenConsumerResolver(
  tokens: GetTokenDefsResult,
  sourceIndex: ReadonlyMap<string, string>,
  rewriteMap: ReadonlyMap<string, string> | undefined,
  report?: ReportTokenDiagnostic
): StyleVarResolver {
  type Dimension = 'number' | 'length'
  const dimensions = new Map<string, Dimension | undefined>()
  const dimensionOf = (name: string, active = new Set<string>()): Dimension | undefined => {
    if (dimensions.has(name)) return dimensions.get(name)
    if (active.has(name) || active.size >= 64 || !Object.hasOwn(tokens, name)) return undefined
    const token = tokens[name]!
    if (token.kind !== 'number') return undefined
    active.add(name)
    const dimensionsInModes = new Set<Dimension>()
    for (const value of typeof token.value === 'string'
      ? [token.value]
      : Object.values(token.value)) {
      let dimension: Dimension | undefined
      if (value.startsWith('--')) {
        dimension = dimensionOf(value, active)
      } else {
        const literal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(px|rem)?$/i.exec(value)
        if (literal) dimension = literal[1] ? 'length' : 'number'
      }
      if (!dimension) {
        active.delete(name)
        dimensions.set(name, undefined)
        return undefined
      }
      dimensionsInModes.add(dimension)
    }
    active.delete(name)
    const dimension =
      dimensionsInModes.size === 1 ? dimensionsInModes.values().next().value : undefined
    dimensions.set(name, dimension)
    return dimension
  }

  return (style) => {
    let next: Record<string, string> | undefined
    for (const [property, raw] of Object.entries(style)) {
      const length = LENGTH_PROPERTIES.has(property)
      if (!length && property !== 'opacity' && property !== 'font-weight') continue
      if (!raw) continue
      const normalized = replaceVarFunctions(raw, ({ name, full }) => {
        // Native fields use one variable. Leave already normalized expressions intact.
        if (full !== raw.trim()) return full
        const source = normalizeFigmaVarName(name.trim())
        if (!sourceIndex.has(source)) return full
        const canonical = rewriteMap?.get(source) ?? source
        const dimension = dimensionOf(canonical)
        if (!dimension) {
          report?.(
            'token-resolution',
            `${property} unit normalization for ${canonical} could not preserve mixed, missing, or cyclic mode/alias units. Use resolveTokens:true or a separate ${property} token.`
          )
          return full
        }
        // Styles still use native pixels here; the renderer applies scale and rem once.
        if (length) {
          return dimension === 'number' ? `calc(${full} * 100px / 100)` : full
        }
        const divisor = property === 'opacity' ? 100 : 1
        if (dimension === 'number' && divisor === 1) return full
        // A 1px divisor rounds to 0.063rem at the default root size; using 100px
        // keeps the ratio accurate when the renderer rounds converted lengths.
        const denominator = dimension === 'number' ? String(divisor) : '100px'
        const restoreWeight = dimension === 'length' && divisor === 1 ? ' * 100' : ''
        return `calc(${full} / ${denominator}${restoreWeight})`
      })
      if (normalized !== raw) {
        next ??= { ...style }
        next[property] = normalized
      }
    }
    return next ?? style
  }
}

function resolveForConsumer(variable: Variable, node: SceneNode, context: TokenReadContext) {
  let values = context.consumerValues.get(node.id)
  if (!values) context.consumerValues.set(node.id, (values = new Map()))
  if (!values.has(variable.id)) {
    try {
      values.set(variable.id, variable.resolveForConsumer(node))
    } catch {
      values.set(variable.id, null)
    }
  }
  return values.get(variable.id) ?? null
}

export function resolveStyleMap(
  styles: Map<string, Record<string, string>>,
  nodes: Map<string, SceneNode>,
  resolver: StyleVarResolver
): Map<string, Record<string, string>> {
  return new Map(Array.from(styles, ([id, style]) => [id, resolver(style, nodes.get(id))]))
}
