import { canonicalizeVarName, normalizeFigmaVarName } from '@/utils/css'
import { logger } from '@/utils/log'

function looksLikeName(value: string): boolean {
  return (
    /^[$@]?[A-Za-z0-9 _-]+$/.test(value) ||
    /^[$@]?[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(value)
  )
}

export function normalizeTransformedName(output: string | undefined, fallback: string): string {
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
