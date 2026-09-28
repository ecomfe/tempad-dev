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

export function createStyleVarResolver(
  sourceIndex: Map<string, string>,
  cache: Map<string, Variable | null>,
  config: CodegenConfig,
  resolveNodeIds?: Set<string>,
  tokenMatcher?: (value: string) => boolean,
  context = createTokenReadContext(config, undefined, cache),
  report?: ReportTokenDiagnostic
): StyleVarResolver {
  // Serialization is local to this renderer; only native values are shared between roots.
  const literals = new Map<string, Map<string, string | undefined>>()
  const resolve = (id: string, node?: SceneNode): string | undefined => {
    if (!node) return undefined
    let values = literals.get(node.id)
    if (!values) literals.set(node.id, (values = new Map()))
    if (!values.has(id)) {
      const variable = context.getVariable(id)
      const resolved = variable ? resolveForConsumer(variable, node, context) : null
      let literal: string | undefined
      if (resolved && variable) {
        try {
          literal =
            serializeVariableValue(
              resolved.value,
              resolved.resolvedType,
              config,
              normalizeFigmaVarName(getVariableRawName(variable))
            ) ?? undefined
        } catch {
          // Unusable native values remain references and receive the same bounded diagnostic.
        }
      }
      values.set(id, literal)
    }
    return values.get(id)
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
        const literal = resolve(id, node)
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
