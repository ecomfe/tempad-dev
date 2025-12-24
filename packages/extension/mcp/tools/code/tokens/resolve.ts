import type { GetTokenDefsResult, TokenEntry } from '@tempad-dev/mcp-shared'

import {
  normalizeFigmaVarName,
  replaceVarFunctions,
  stripFallback,
  toFigmaVarExpr
} from '@/utils/css'

function primaryTokenValue(entry: TokenEntry): string | undefined {
  if (typeof entry.value === 'string') return entry.value
  if (typeof entry.resolvedValue === 'string') return entry.resolvedValue
  if (entry.activeMode && typeof entry.value[entry.activeMode] === 'string') {
    return entry.value[entry.activeMode]
  }
  const first = Object.values(entry.value)[0]
  return typeof first === 'string' ? first : undefined
}

function resolveConcreteValue(
  name: string,
  allTokens: GetTokenDefsResult,
  cache: Map<string, string | undefined>,
  depth = 0
): string | undefined {
  if (cache.has(name)) return cache.get(name)
  if (depth > 20) return undefined

  const entry = allTokens[name]
  if (!entry) {
    cache.set(name, undefined)
    return undefined
  }
  const val = primaryTokenValue(entry)
  if (typeof val !== 'string') {
    cache.set(name, undefined)
    return undefined
  }
  if (val.startsWith('--') && val !== name) {
    const resolved = resolveConcreteValue(val, allTokens, cache, depth + 1) ?? val
    cache.set(name, resolved)
    return resolved
  }
  cache.set(name, val)
  return val
}

export function buildResolvedTokenMap(
  usedFinalNames: Set<string>,
  tokensByCanonical: GetTokenDefsResult,
  canonicalByFinal: Map<string, string>
): Map<string, string | undefined> {
  const cache = new Map<string, string | undefined>()
  const resolved = new Map<string, string | undefined>()

  usedFinalNames.forEach((finalName) => {
    const canonical = canonicalByFinal.get(finalName)
    if (!canonical) return
    const val = resolveConcreteValue(canonical, tokensByCanonical, cache)
    if (typeof val === 'string' && !val.startsWith('--')) {
      resolved.set(finalName, val)
    }
  })

  return resolved
}

export function replaceTokensWithValues(
  code: string,
  resolvedMap: Map<string, string | undefined>
): string {
  let out = stripFallback(code)

  out = replaceVarFunctions(out, ({ name, full }) => {
    const trimmed = name.trim()
    if (!trimmed.startsWith('--')) return full
    const canonical = normalizeFigmaVarName(trimmed)
    const val = resolvedMap.get(canonical)
    return typeof val === 'string' ? val : toFigmaVarExpr(canonical)
  })

  if (!resolvedMap.size) return out

  const entries = Array.from(resolvedMap.entries())
    .filter(([, val]) => typeof val === 'string')
    .map(([key, val]) => [key, val as string] as const)
    .sort((a, b) => b[0].length - a[0].length)

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = entries.length ? entries.map(([key]) => escapeRegex(key)).join('|') : ''
  if (!pattern) return out

  const bareTokenRe = new RegExp(`(^|[^A-Za-z0-9_-])(${pattern})(?=[^A-Za-z0-9_-]|$)`, 'g')

  out = out.replace(bareTokenRe, (match, prefix: string, token: string) => {
    const val = resolvedMap.get(token)
    return `${prefix}${val ?? token}`
  })

  return out
}

export function mapResolvedTokens(map: Map<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  map.forEach((value, key) => {
    if (typeof value === 'string') out[key] = value
  })
  return out
}
