import { normalizeFigmaVarName, replaceVarFunctions } from '@/utils/css'

export function extractTokenNames(code: string, plainNames?: Set<string>): Set<string> {
  const out = new Set<string>()
  if (!code) return out
  replaceVarFunctions(code, ({ name, full }) => {
    const trimmed = name.trim()
    if (trimmed.startsWith('--')) {
      out.add(normalizeFigmaVarName(trimmed))
    }
    return full
  })
  code.match(/--[A-Za-z0-9-_]+/g)?.forEach((raw) => {
    out.add(normalizeFigmaVarName(raw))
  })

  if (plainNames?.size) {
    const names = Array.from(plainNames).filter(Boolean)
    // 长度优先，避免 color-red 误吞 color-red-1
    names.sort((a, b) => b.length - a.length)
    names.forEach((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=[^A-Za-z0-9_-]|$)`, 'g')
      if (re.test(code)) {
        out.add(name)
      }
    })
  }

  return out
}
