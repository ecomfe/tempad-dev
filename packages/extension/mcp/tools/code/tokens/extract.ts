import { normalizeFigmaVarName } from '@/utils/css'

const TOKEN_BOUNDARY_PREFIX = '(^|[^A-Za-z0-9_-])'
const TOKEN_BOUNDARY_SUFFIX = '(?=[^A-Za-z0-9_-]|$)'

export function buildTokenRegex(plainNames?: Set<string>, global = false): RegExp | null {
  if (!plainNames || plainNames.size === 0) return null

  const names = Array.from(plainNames).filter(Boolean)
  if (!names.length) return null

  // 长度优先，避免 color-red 误吞 color-red-1
  names.sort((a, b) => b.length - a.length)

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = names.map((name) => escapeRegex(name)).join('|')
  if (!pattern) return null

  const flags = global ? 'g' : undefined
  return new RegExp(`${TOKEN_BOUNDARY_PREFIX}(${pattern})${TOKEN_BOUNDARY_SUFFIX}`, flags)
}

export function extractTokenNames(code: string, plainNames?: Set<string>): Set<string> {
  const out = new Set<string>()
  if (!code) return out
  if (!plainNames?.size) {
    code.match(/--[A-Za-z0-9-_]+/g)?.forEach((raw) => {
      out.add(normalizeFigmaVarName(raw))
    })
    return out
  }

  const tokenRe = buildTokenRegex(plainNames, true)
  if (tokenRe) {
    let match: RegExpExecArray | null
    while ((match = tokenRe.exec(code)) !== null) {
      if (match[2]) out.add(match[2])
    }
  }

  return out
}

export function createTokenMatcher(plainNames?: Set<string>): (input: string) => boolean {
  const re = buildTokenRegex(plainNames, false)
  if (!re) return () => false

  return (input: string) => {
    if (!input) return false
    return re.test(input)
  }
}
