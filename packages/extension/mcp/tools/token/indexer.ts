import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import { normalizeFigmaVarName } from '@/utils/css'

import { normalizeTransformedName } from './name'

export { getVariableRawName } from '@/utils/figma-variables'

export async function canonicalizeNames(
  rawNames: string[],
  config: CodegenConfig,
  pluginCode?: string,
  checkpoint?: () => void
): Promise<string[]> {
  checkpoint?.()
  if (!rawNames.length) return []

  const refs = rawNames.map((rawName) => {
    checkpoint?.()
    // Keep token canonicalization aligned with style/code output by normalizing
    // raw Figma names through the same Figma-to-CSS variable path first.
    const canonical = normalizeFigmaVarName(rawName)
    return { code: `var(${canonical})`, name: canonical.slice(2) }
  })

  const CHUNK_SIZE = 300
  const results: string[] = []
  for (let index = 0; index < refs.length; index += CHUNK_SIZE) {
    checkpoint?.()
    const transformed = await runTransformVariableBatch(
      refs.slice(index, index + CHUNK_SIZE),
      workerUnitOptions(config),
      pluginCode
    )
    checkpoint?.()
    results.push(...transformed)
  }

  return refs.map((fallback, idx) => {
    checkpoint?.()
    return normalizeTransformedName(results[idx], `--${fallback.name}`)
  })
}

export async function canonicalizeName(
  rawName: string,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string> {
  const [canonical] = await canonicalizeNames([rawName], config, pluginCode)
  return canonical ?? normalizeFigmaVarName(rawName)
}
