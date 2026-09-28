import { canonicalizeVarName, normalizeFigmaVarName } from '@/utils/css'
import { logger } from '@/utils/log'

function looksLikeName(value: string): boolean {
  const trimmed = value.trim()
  return /^[A-Za-z0-9 _-]+$/.test(trimmed) || /^[$@][A-Za-z0-9 _-]+$/.test(trimmed)
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
