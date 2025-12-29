import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import {
  canonicalizeVarName,
  normalizeCustomPropertyBody,
  normalizeFigmaVarName
} from '@/utils/css'
import { logger } from '@/utils/log'

function looksLikeName(value: string): boolean {
  const trimmed = value.trim()
  return /^[A-Za-z0-9 _-]+$/.test(trimmed) || /^[$@][A-Za-z0-9 _-]+$/.test(trimmed)
}

function normalizeTransformedName(output: string | undefined, fallback: string): string {
  if (output && output.trim()) {
    const trimmed = output.trim()
    const canonical = canonicalizeVarName(trimmed)
    if (canonical) return canonical

    if (looksLikeName(trimmed)) {
      const stripped = trimmed.replace(/^[$@]/, '').trim()
      return normalizeFigmaVarName(stripped)
    }

    logger.warn('transformVariable returned non-variable output; using fallback name.')
  }
  return fallback
}

export async function applyPluginTransformToNames(
  usedNames: Set<string>,
  sourceIndex: Map<string, string>,
  pluginCode: string | undefined,
  config: CodegenConfig
): Promise<{
  rewriteMap: Map<string, string>
  finalBridge: Map<string, string>
}> {
  const rewriteMap = new Map<string, string>()
  const finalBridge = new Map<string, string>()

  const ordered = Array.from(usedNames)
  if (!ordered.length) return { rewriteMap, finalBridge }

  if (!pluginCode) {
    ordered.forEach((name) => {
      const variableId = sourceIndex.get(name)
      if (!variableId) return
      if (finalBridge.has(name) && finalBridge.get(name) !== variableId) {
        logger.warn('Duplicate token name resolved to multiple ids:', name)
        return
      }
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

    if (finalBridge.has(next) && finalBridge.get(next) !== variableId) {
      logger.warn('Duplicate token name resolved to multiple ids:', next)
      return
    }
    finalBridge.set(next, variableId)
  })

  return { rewriteMap, finalBridge }
}
