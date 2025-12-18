import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import {
  canonicalizeVarName,
  extractVarNames,
  normalizeCustomPropertyBody,
  preprocessCssValue,
  replaceVarFunctions,
  stripFallback,
  toVarExpr
} from '@/utils/css'

type VariableReferenceInternal = {
  nodeId: string
  property: string
  code: string
  name: string
  value?: string
}

type PropertyBucket = {
  nodeId: string
  property: string
  value: string
  matchIndices: number[]
}

type TransformOptions = {
  pluginCode?: string
  config: CodegenConfig
}

export function transform(
  styles: Map<string, Record<string, string>>,
  { pluginCode, config }: TransformOptions
): Promise<Set<string>> {
  const { references, buckets } = collectRefs(styles)
  if (!references.length) return Promise.resolve(new Set())

  return runTransformVariableBatch(
    references.map(({ code, name, value }) => ({ code, name, value })),
    workerUnitOptions(config),
    pluginCode
  ).then((transformResults) => {
    const replacements = transformResults.map((result) => {
      const noFallback = stripFallback(result)
      const canonicalName = canonicalizeVarName(noFallback)
      return canonicalName ? toVarExpr(canonicalName) : noFallback
    })
    const usedNames = new Set<string>()
    // Keep original reference names to handle transforms that inline literal values.
    references.forEach(({ name }) => usedNames.add(`--${name}`))
    replacements.forEach((repl) => extractVarNames(repl).forEach((n) => usedNames.add(n)))

    for (const bucket of buckets.values()) {
      const style = styles.get(bucket.nodeId)
      if (!style) continue

      let occurrence = 0
      style[bucket.property] = replaceVarFunctions(bucket.value, ({ full }) => {
        const refIndex = bucket.matchIndices[occurrence++]
        return refIndex != null ? (replacements[refIndex] ?? full) : full
      })
    }

    return usedNames
  })
}

export function collectRefs(styles: Map<string, Record<string, string>>) {
  const references: VariableReferenceInternal[] = []
  const buckets = new Map<string, PropertyBucket>()

  for (const [nodeId, style] of styles.entries()) {
    for (const [property, value] of Object.entries(style)) {
      let hasMatch = false
      const indices: number[] = []

      const normalized = preprocessCssValue(value)
      if (normalized !== value) {
        style[property] = normalized
      }

      replaceVarFunctions(normalized, ({ full, name, fallback }) => {
        const trimmed = name.trim()
        if (!trimmed.startsWith('--')) return full

        hasMatch = true
        const refIndex =
          references.push({
            nodeId,
            property,
            code: full,
            name: normalizeCustomPropertyBody(trimmed),
            value: fallback?.trim()
          }) - 1
        indices.push(refIndex)
        return full
      })

      if (hasMatch) {
        const key = `${nodeId}:${property}`
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.matchIndices.push(...indices)
        } else {
          buckets.set(key, { nodeId, property, value: normalized, matchIndices: indices })
        }
      }
    }
  }
  return { references, buckets }
}
