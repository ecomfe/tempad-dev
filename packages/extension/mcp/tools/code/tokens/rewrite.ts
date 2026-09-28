import { buildTokenRegex } from './extract'

export function rewriteTokenNamesInCode(code: string, rewriteMap: Map<string, string>): string {
  if (!rewriteMap.size) return code

  const tokenRe = buildTokenRegex(new Set(rewriteMap.keys()), true)
  if (!tokenRe) return code

  return code.replace(tokenRe, (match, prefix: string, token: string) => {
    const next = rewriteMap.get(token)
    if (next == null) return match
    return `${prefix}${next}`
  })
}
