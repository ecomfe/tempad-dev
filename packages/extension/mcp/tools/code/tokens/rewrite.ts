import type { CssValueSyntax } from '@/utils/css'

import { buildTokenRegex } from './extract'

export function createTokenNameRewriter(names: Map<string, string>) {
  const tailwindNames = new Map<string, string>()
  for (const [source, target] of names) {
    const encodedTarget = target.replaceAll('_', '\\_')
    tailwindNames.set(source, encodedTarget)
    tailwindNames.set(source.replaceAll('_', '\\_'), encodedTarget)
  }
  return (value: string, syntax?: CssValueSyntax): string =>
    rewriteTokenNamesInCode(value, syntax === 'tailwind' ? tailwindNames : names)
}

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
