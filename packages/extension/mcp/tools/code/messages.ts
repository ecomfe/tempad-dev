import type { SemanticTreeStats } from '@/mcp/semantic-tree'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?(none|inferred)["']?/i

export function buildGetCodeMessage(
  rawMarkup: string,
  maxCodeChars: number,
  stats: SemanticTreeStats
): { markup: string; message?: string } {
  let markup = rawMarkup
  const messages: string[] = []

  if (stats.capped) {
    messages.push(`Selection truncated at depth ${stats.depthLimit ?? stats.maxDepth}.`)
  }

  if (rawMarkup.length > maxCodeChars) {
    markup = rawMarkup.slice(0, maxCodeChars)
    messages.push(
      `Output truncated to fit payload limit; showing first ${maxCodeChars} characters.`
    )
  }

  if (AUTO_LAYOUT_REGEX.test(rawMarkup)) {
    messages.push(
      'Detected data-hint-auto-layout=none/inferred; call get_structure and/or get_screenshot to verify hierarchy, overlap, and masks.'
    )
  }

  return {
    markup,
    message: messages.length ? messages.join(' ') : undefined
  }
}
