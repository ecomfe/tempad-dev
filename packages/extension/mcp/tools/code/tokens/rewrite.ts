import { buildTokenRegex } from './extract'

export function rewriteTokenNamesInCode(code: string, rewriteMap: Map<string, string>): string {
  if (!rewriteMap.size) return code

  const tokenRe = buildTokenRegex(new Set(rewriteMap.keys()), true)
  if (!tokenRe) return code

  return code.replace(tokenRe, (match, prefix: string, token: string) => {
    const next = rewriteMap.get(token) ?? token
    return `${prefix}${next}`
  })
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
