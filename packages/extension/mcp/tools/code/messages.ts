import type { GetCodeWarning } from '@tempad-dev/mcp-shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i

export function truncateCode(
  rawMarkup: string,
  maxCodeChars: number
): {
  code: string
  truncated: boolean
} {
  if (rawMarkup.length > maxCodeChars) {
    return { code: rawMarkup.slice(0, maxCodeChars), truncated: true }
  }
  return { code: rawMarkup, truncated: false }
}

export function buildGetCodeWarnings(
  code: string,
  maxCodeChars: number,
  truncated: boolean,
  options?: {
    depthLimit?: number
    cappedNodeIds?: string[]
  }
): GetCodeWarning[] | undefined {
  const warnings: GetCodeWarning[] = []

  if (truncated) {
    warnings.push({
      type: 'truncated',
      message: `Output truncated to fit payload limit; showing first ${maxCodeChars} characters.`,
      data: { maxCodeChars }
    })
  }

  if (AUTO_LAYOUT_REGEX.test(code)) {
    warnings.push({
      type: 'auto-layout',
      message:
        'Detected data-hint-auto-layout=inferred; call get_structure and/or get_screenshot and use data-hint-id to locate nodes.'
    })
  }

  const cappedNodeIds = options?.cappedNodeIds ?? []
  if (cappedNodeIds.length) {
    const MAX_IDS = 50
    const deduped = Array.from(new Set(cappedNodeIds))
    const list = deduped.slice(0, MAX_IDS)
    warnings.push({
      type: 'depth-cap',
      message:
        'Tree depth capped; some subtree roots were omitted. Call get_code with nodeId for the listed ids to fetch their code.',
      data: {
        depthLimit: options?.depthLimit,
        cappedNodeIds: list,
        cappedNodeCount: deduped.length,
        cappedNodeOverflow: deduped.length > list.length
      }
    })
  }

  return warnings.length ? warnings : undefined
}
