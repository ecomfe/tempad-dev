import type { GetCodeWarning } from '@tempad-dev/shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i
const DEFAULT_PAYLOAD_SHARE = 0.6
const DEFAULT_CODE_TOKEN_BUDGET = 8000
const DEFAULT_APPROX_BYTES_PER_TOKEN = 4
const DEFAULT_TOKEN_HEADROOM = 0.75

const SHELL_WARNING_MESSAGE =
  'Shell response: omitted direct children ids are listed in the inline comment. Call get_code for each id in that order, then fill the results back into this shell without re-guessing parent layout.'

export type CodeBudget = {
  maxCodeBytes: number
  estimatedTokenBudget: number
}

export class CodeBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodeBudgetExceededError'
  }
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
    estimatedTokenBudget
  }
}

export function assertCodeWithinBudget(rawMarkup: string, budget: CodeBudget): void {
  const size = utf8ByteLength(rawMarkup)
  if (size <= budget.maxCodeBytes) return

  const estimatedCurrentTokens = estimateTokensFromBytes(size)
  const overBytes = size - budget.maxCodeBytes
  const overTokens = Math.max(1, estimatedCurrentTokens - budget.estimatedTokenBudget)

  throw new CodeBudgetExceededError(
    `Output exceeds token/context budget (current ~${estimatedCurrentTokens} tokens / ${size} UTF-8 bytes; limit ~${budget.estimatedTokenBudget} tokens / ${budget.maxCodeBytes} UTF-8 bytes; over by ~${overTokens} tokens / ${overBytes} bytes). Reduce selection size and retry, or call get_code on a smaller nodeId subtree.`
  )
}

export function buildGetCodeWarnings(
  code: string,
  options?: {
    depthLimit?: number
    cappedNodeIds?: string[]
    shell?: boolean
  }
): GetCodeWarning[] | undefined {
  const warnings: GetCodeWarning[] = []

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

  if (options?.shell) {
    warnings.push({
      type: 'shell',
      message: SHELL_WARNING_MESSAGE
    })
  }

  return warnings.length ? warnings : undefined
}

export function isCodeBudgetExceededError(error: unknown): error is CodeBudgetExceededError {
  return error instanceof CodeBudgetExceededError
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

function estimateTokensFromBytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / DEFAULT_APPROX_BYTES_PER_TOKEN))
}
