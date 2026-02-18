import type { GetCodeWarning } from '@tempad-dev/shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i
const DEFAULT_PAYLOAD_SHARE = 0.6
const DEFAULT_CODE_TOKEN_BUDGET = 8000
const DEFAULT_APPROX_BYTES_PER_TOKEN = 4
const DEFAULT_TOKEN_HEADROOM = 0.75

export type CodeBudget = {
  maxCodeBytes: number
  maxCodeChars: number
  estimatedTokenBudget: number
}

export function resolveCodeBudget(maxPayloadBytes: number): CodeBudget {
  const payloadByteBudget = Math.floor(maxPayloadBytes * DEFAULT_PAYLOAD_SHARE)
  const estimatedTokenBudget = Math.max(
    1,
    Math.floor(DEFAULT_CODE_TOKEN_BUDGET * DEFAULT_TOKEN_HEADROOM)
  )
  const tokenByteBudget = estimatedTokenBudget * DEFAULT_APPROX_BYTES_PER_TOKEN
  const maxCodeBytes = Math.max(1, Math.min(payloadByteBudget, tokenByteBudget))
  return {
    maxCodeBytes,
    maxCodeChars: maxCodeBytes,
    estimatedTokenBudget
  }
}

export function truncateCode(
  rawMarkup: string,
  maxCodeBytes: number
): {
  code: string
  truncated: boolean
} {
  if (utf8ByteLength(rawMarkup) > maxCodeBytes) {
    return { code: sliceByUtf8Bytes(rawMarkup, maxCodeBytes), truncated: true }
  }
  return { code: rawMarkup, truncated: false }
}

export function buildGetCodeWarnings(
  code: string,
  budget: CodeBudget,
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
      message: `Output truncated to fit token/context budget (~${budget.estimatedTokenBudget} tokens; max ${budget.maxCodeBytes} UTF-8 bytes).`,
      data: {
        maxCodeChars: budget.maxCodeChars,
        maxCodeBytes: budget.maxCodeBytes,
        estimatedTokenBudget: budget.estimatedTokenBudget
      }
    })
  }

  if (AUTO_LAYOUT_REGEX.test(code)) {
    warnings.push({
      type: 'auto-layout',
      message:
        'Detected data-hint-auto-layout=inferred; call get_structure and use data-hint-id to locate nodes.'
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

function utf8ByteLength(input: string): number {
  let bytes = 0
  for (const ch of input) {
    const codePoint = ch.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) {
      bytes += 1
    } else if (codePoint <= 0x7ff) {
      bytes += 2
    } else if (codePoint <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

function sliceByUtf8Bytes(input: string, maxBytes: number): string {
  if (maxBytes <= 0 || !input.length) return ''

  let bytes = 0
  let endIndex = 0

  for (const ch of input) {
    const codePoint = ch.codePointAt(0) ?? 0
    const nextBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    if (bytes + nextBytes > maxBytes) break
    bytes += nextBytes
    endIndex += ch.length
  }

  return input.slice(0, endIndex)
}
