import { normalizeFigmaVarName, replaceVarFunctions, stripFallback } from '@/utils/css'

export function rewriteTokenNamesInCode(code: string, rewriteMap: Map<string, string>): string {
  if (!rewriteMap.size) return stripFallback(code)

  let out = stripFallback(code)

  out = replaceVarFunctions(out, ({ name, full }) => {
    const trimmed = name.trim()
    if (!trimmed.startsWith('--')) return full
    const canonical = normalizeFigmaVarName(trimmed)
    const next = rewriteMap.get(canonical) ?? canonical
    return `var(${next})`
  })

  const entries = Array.from(rewriteMap.entries())
    .map(([key, next]) => [key.trim(), next] as const)
    .filter(([key]) => !!key)
    .sort((a, b) => b[0].length - a[0].length)

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = entries.length ? entries.map(([key]) => escapeRegex(key)).join('|') : ''
  if (!pattern) return out

  const bareTokenRe = new RegExp(`(^|[^A-Za-z0-9_-])(${pattern})(?=[^A-Za-z0-9_-]|$)`, 'g')

  out = out.replace(bareTokenRe, (match, prefix: string, token: string) => {
    const next = rewriteMap.get(token) ?? token
    return `${prefix}${next}`
  })

  return out
}

export function filterBridge(
  bridge: Map<string, string>,
  usedNames: Set<string>
): Map<string, string> {
  const out = new Map<string, string>()
  usedNames.forEach((name) => {
    const id = bridge.get(name)
    if (id) out.set(name, id)
  })
  return out
}
