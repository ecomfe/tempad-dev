import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'
import { canonicalizeVarName as canonicalizeCssVarName, normalizeCssVarName } from '@/utils/css'

export type TokenIndex = {
  // canonical name ("--color-primary") -> variable ids (handle collisions)
  byCanonicalName: Map<string, string[]>
  // variable id -> canonical name
  canonicalNameById: Map<string, string>
  // for diagnostics
  totalVariables: number
}

type TokenIndexCacheKey = string

let cachedIndex:
  | {
      key: TokenIndexCacheKey
      promise: Promise<TokenIndex>
    }
  | undefined

function buildCacheKey(config: CodegenConfig, pluginCode?: string): TokenIndexCacheKey {
  const pluginHash = pluginCode ? fnv1a32(pluginCode) : 'none'
  return JSON.stringify({
    cssUnit: config.cssUnit,
    rootFontSize: config.rootFontSize,
    scale: config.scale,
    pluginHash
  })
}

function fnv1a32(input: string): string {
  // Fast, stable, non-cryptographic hash; sufficient for cache keying.
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

function parseCanonicalFromExpr(expr: string, fallbackName: string): string {
  const canonical = canonicalizeCssVarName(expr)
  if (canonical) return canonical
  return `--${normalizeCssVarName(fallbackName)}`
}

export async function canonicalizeVarNames(
  rawNames: string[],
  config: CodegenConfig,
  pluginCode?: string
): Promise<string[]> {
  if (!rawNames.length) return []

  const refs = rawNames.map((rawName) => {
    const name = normalizeCssVarName(rawName)
    return { code: `var(--${name})`, name }
  })

  const CHUNK_SIZE = 300
  const chunks = chunk(refs, CHUNK_SIZE)

  const results: string[] = []
  for (const batch of chunks) {
    const transformed = await runTransformVariableBatch(
      batch,
      workerUnitOptions(config),
      pluginCode
    )
    results.push(...transformed)
  }

  return results.map((expr, idx) => {
    const fallback = refs[idx]
    return parseCanonicalFromExpr(expr ?? fallback.code, fallback.name)
  })
}

export async function canonicalizeVarName(
  rawName: string,
  config: CodegenConfig,
  pluginCode?: string
): Promise<string> {
  const [canonical] = await canonicalizeVarNames([rawName], config, pluginCode)
  return canonical ?? `--${normalizeCssVarName(rawName)}`
}

export async function getTokenIndex(
  config: CodegenConfig,
  pluginCode?: string
): Promise<TokenIndex> {
  const key = buildCacheKey(config, pluginCode)
  if (cachedIndex?.key === key) {
    return cachedIndex.promise
  }

  const promise = (async (): Promise<TokenIndex> => {
    const variables = await figma.variables.getLocalVariablesAsync()

    const byCanonicalName = new Map<string, string[]>()
    const canonicalNameById = new Map<string, string>()

    const canonicals = await canonicalizeVarNames(
      variables.map((v) => v.name),
      config,
      pluginCode
    )

    for (let i = 0; i < variables.length; i++) {
      const variable = variables[i]
      const canonical = canonicals[i] ?? `--${normalizeCssVarName(variable.name)}`

      canonicalNameById.set(variable.id, canonical)

      const bucket = byCanonicalName.get(canonical)
      if (bucket) bucket.push(variable.id)
      else byCanonicalName.set(canonical, [variable.id])
    }

    return {
      byCanonicalName,
      canonicalNameById,
      totalVariables: variables.length
    }
  })()

  cachedIndex = { key, promise }
  return promise
}
