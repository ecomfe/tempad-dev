import type { GetCodeParametersInput, GetCodeWarning, ToolResponseLike } from '@tempad-dev/shared'

import { MCP_TOOL_INLINE_BUDGET_BYTES, measureCallToolResultBytes } from '@tempad-dev/shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i
const MAX_WARNING_NODE_IDS = 50

const SHELL_WARNING_MESSAGE =
  'Shell response: omitted direct child ids are listed in the inline comment. Call get_code for them in that order, then fill the results back into this shell instead of re-creating the parent layout.'

export type CodeBudget = {
  maxResultBytes: number
}

const UNBOUNDED_CODE_BUDGET: CodeBudget = {
  maxResultBytes: Number.MAX_SAFE_INTEGER
}

export class CodeBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodeBudgetExceededError'
  }
}

export function resolveCodeBudget(): CodeBudget {
  return {
    maxResultBytes: MCP_TOOL_INLINE_BUDGET_BYTES
  }
}

export function resolveUnlimitedCodeBudget(): CodeBudget {
  return UNBOUNDED_CODE_BUDGET
}

export function assertToolResponseWithinBudget(result: ToolResponseLike, budget: CodeBudget): void {
  const size = measureCallToolResultBytes(result)
  if (size <= budget.maxResultBytes) return
  throw new CodeBudgetExceededError(
    `Tool result exceeds inline budget (${size} UTF-8 bytes > ${budget.maxResultBytes} UTF-8 bytes). Reduce selection size and retry, or call get_code on a smaller nodeId subtree.`
  )
}

export function buildGetCodeWarnings(
  code: string,
  options?: {
    depthLimit?: number
    cappedNodeIds?: string[]
    shell?: boolean
    omittedNodeIds?: string[]
    requestArgs?: Pick<GetCodeParametersInput, 'preferredLang' | 'resolveTokens' | 'vectorMode'>
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
    const { list, count, overflow } = summarizeNodeIds(cappedNodeIds)
    warnings.push({
      type: 'depth-cap',
      message:
        'Tree depth capped; some subtree roots were omitted. Call get_code with nodeId for the listed ids to fetch their code.',
      data: {
        depthLimit: options?.depthLimit,
        cappedNodeIds: list,
        cappedNodeCount: count,
        cappedNodeOverflow: overflow,
        continuationTool: 'get_code',
        ...(list[0]
          ? {
              recommendedNextArgs: buildRecommendedNextArgs(list[0], options?.requestArgs)
            }
          : {})
      }
    })
  }

  if (options?.shell) {
    const { list, count, overflow } = summarizeNodeIds(options?.omittedNodeIds ?? [])
    warnings.push({
      type: 'shell',
      message: SHELL_WARNING_MESSAGE,
      data: {
        strategy: 'shell',
        omittedNodeIds: list,
        omittedNodeCount: count,
        omittedNodeOverflow: overflow,
        continuationTool: 'get_code',
        ...(list[0]
          ? {
              recommendedNextArgs: buildRecommendedNextArgs(list[0], options?.requestArgs)
            }
          : {})
      }
    })
  }

  return warnings.length ? warnings : undefined
}

export function isCodeBudgetExceededError(error: unknown): error is CodeBudgetExceededError {
  return error instanceof CodeBudgetExceededError
}

function summarizeNodeIds(nodeIds: string[]): {
  list: string[]
  count: number
  overflow: boolean
} {
  const deduped = Array.from(new Set(nodeIds))
  const list = deduped.slice(0, MAX_WARNING_NODE_IDS)
  return {
    list,
    count: deduped.length,
    overflow: deduped.length > list.length
  }
}

function buildRecommendedNextArgs(
  nodeId: string,
  requestArgs?: Pick<GetCodeParametersInput, 'preferredLang' | 'resolveTokens' | 'vectorMode'>
): {
  nodeId: string
  preferredLang?: 'jsx' | 'vue'
  resolveTokens?: boolean
  vectorMode?: 'smart' | 'snapshot'
} {
  return {
    nodeId,
    ...(requestArgs?.preferredLang ? { preferredLang: requestArgs.preferredLang } : {}),
    ...(requestArgs?.resolveTokens !== undefined
      ? { resolveTokens: requestArgs.resolveTokens }
      : {}),
    ...(requestArgs?.vectorMode ? { vectorMode: requestArgs.vectorMode } : {})
  }
}
