import type { GetCodeParametersInput, GetCodeWarning, ToolResponseLike } from '@tempad-dev/shared'

import { MCP_TOOL_INLINE_BUDGET_BYTES, measureCallToolResultBytes } from '@tempad-dev/shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i
const MAX_WARNING_NODE_IDS = 50

const SHELL_WARNING_MESSAGE =
  'Shell response: omitted direct child ids are listed in the inline comment. Call get_code for them in that order, then fill the results back into this shell instead of re-creating the parent layout.'

export type CodeBudget = {
  maxResultBytes: number
}

type CodeWarningRequestArgs = Pick<
  GetCodeParametersInput,
  'preferredLang' | 'resolveTokens' | 'vectorMode'
>

type RecommendedNextArgs = {
  nodeId: string
  preferredLang?: 'jsx' | 'vue'
  resolveTokens?: boolean
  vectorMode?: 'smart' | 'snapshot'
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
    requestArgs?: CodeWarningRequestArgs
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

  const depthCapWarning = buildDepthCapWarning(
    options?.cappedNodeIds ?? [],
    options?.depthLimit,
    options?.requestArgs
  )
  if (depthCapWarning) {
    warnings.push(depthCapWarning)
  }

  if (options?.shell) {
    warnings.push(buildShellWarning(options?.omittedNodeIds ?? [], options?.requestArgs))
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

function buildDepthCapWarning(
  nodeIds: string[],
  depthLimit: number | undefined,
  requestArgs?: CodeWarningRequestArgs
): GetCodeWarning | undefined {
  if (!nodeIds.length) {
    return undefined
  }

  const summary = summarizeNodeIds(nodeIds)
  const data: Record<string, unknown> = {
    depthLimit,
    cappedNodeIds: summary.list,
    cappedNodeCount: summary.count,
    cappedNodeOverflow: summary.overflow,
    continuationTool: 'get_code'
  }

  appendRecommendedNextArgs(data, summary.list[0], requestArgs)

  return {
    type: 'depth-cap',
    message:
      'Tree depth capped; some subtree roots were omitted. Call get_code with nodeId for the listed ids to fetch their code.',
    data
  }
}

function buildShellWarning(
  nodeIds: string[],
  requestArgs?: CodeWarningRequestArgs
): GetCodeWarning {
  const summary = summarizeNodeIds(nodeIds)
  const data: Record<string, unknown> = {
    strategy: 'shell',
    omittedNodeIds: summary.list,
    omittedNodeCount: summary.count,
    omittedNodeOverflow: summary.overflow,
    continuationTool: 'get_code'
  }

  appendRecommendedNextArgs(data, summary.list[0], requestArgs)

  return {
    type: 'shell',
    message: SHELL_WARNING_MESSAGE,
    data
  }
}

function appendRecommendedNextArgs(
  data: Record<string, unknown>,
  nodeId: string | undefined,
  requestArgs?: CodeWarningRequestArgs
): void {
  if (!nodeId) {
    return
  }

  data.recommendedNextArgs = buildRecommendedNextArgs(nodeId, requestArgs)
}

function buildRecommendedNextArgs(
  nodeId: string,
  requestArgs?: CodeWarningRequestArgs
): RecommendedNextArgs {
  const nextArgs: RecommendedNextArgs = { nodeId }

  if (requestArgs?.preferredLang) {
    nextArgs.preferredLang = requestArgs.preferredLang
  }

  if (requestArgs?.resolveTokens !== undefined) {
    nextArgs.resolveTokens = requestArgs.resolveTokens
  }

  if (requestArgs?.vectorMode) {
    nextArgs.vectorMode = requestArgs.vectorMode
  }

  return nextArgs
}
