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

  let transformed: Array<string | undefined> = []
  const transformIndexMap = new Map<number, number>()
  const refs = ordered
    .map((name, idx) => {
      if (!name.startsWith('--')) return null
      transformIndexMap.set(idx, transformIndexMap.size)
      return {
        code: `var(${name})`,
        name: normalizeCustomPropertyBody(name)
      }
    })
    .filter(Boolean) as Array<{ code: string; name: string }>

  if (pluginCode && refs.length) {
    transformed = await runTransformVariableBatch(refs, workerUnitOptions(config), pluginCode)
  }

  ordered.forEach((name, idx) => {
    const transformIndex = transformIndexMap.get(idx)
    const transformedValue =
      transformIndex != null && transformIndex >= 0 ? transformed[transformIndex] : undefined
    const next =
      pluginCode && transformIndex != null ? normalizeTransformedName(transformedValue, name) : name
    rewriteMap.set(name, next)

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
