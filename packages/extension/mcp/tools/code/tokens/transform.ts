import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import { normalizeCustomPropertyBody } from '@/utils/css'
import { logger } from '@/utils/log'

import type { ReportTokenDiagnostic } from './diagnostics'

import { normalizeTransformedName } from '../../token/name'

export async function applyPluginTransformToNames(
  usedNames: Set<string>,
  sourceIndex: Map<string, string>,
  pluginCode: string | undefined,
  config: CodegenConfig,
  report?: ReportTokenDiagnostic
): Promise<{
  rewriteMap: Map<string, string>
  finalBridge: Map<string, string>
}> {
  const rewriteMap = new Map<string, string>()
  const finalBridge = new Map<string, string>()
  const ambiguous = new Set<string>()

  const ordered = Array.from(usedNames)
  if (!ordered.length) return { rewriteMap, finalBridge }

  if (!pluginCode) {
    ordered.forEach((name) => {
      const variableId = sourceIndex.get(name)
      if (!variableId) return
      finalBridge.set(name, variableId)
    })
    return { rewriteMap, finalBridge }
  }

  let transformed: Array<string | undefined> = []
  const refs: Array<{ code: string; name: string }> = []
  ordered.forEach((name) => {
    if (!name.startsWith('--')) return
    refs.push({
      code: `var(${name})`,
      name: normalizeCustomPropertyBody(name)
    })
  })

  const hasTransform = refs.length > 0
  if (hasTransform) {
    transformed = await runTransformVariableBatch(refs, workerUnitOptions(config), pluginCode)
  }

  let refIndex = 0
  ordered.forEach((name) => {
    let next = name
    if (hasTransform && name.startsWith('--')) {
      const transformedValue = transformed[refIndex]
      refIndex += 1
      next = normalizeTransformedName(transformedValue, name)
    }
    if (name !== next) rewriteMap.set(name, next)

    const variableId = sourceIndex.get(name) ?? sourceIndex.get(next)
    if (!variableId) return

    if (ambiguous.has(next)) return
    if (finalBridge.has(next) && finalBridge.get(next) !== variableId) {
      finalBridge.delete(next)
      ambiguous.add(next)
      report?.('token-definition', `Transformed token name "${next}" matches multiple variables.`)
      logger.warn('Duplicate token name resolved to multiple ids:', next)
      return
    }
    finalBridge.set(next, variableId)
  })

  return { rewriteMap, finalBridge }
}
