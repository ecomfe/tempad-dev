import type { GetCodeWarning, ToolResponseLike } from '@tempad-dev/shared'

import { MCP_TOOL_INLINE_BUDGET_BYTES, measureCallToolResultBytes } from '@tempad-dev/shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i

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

  const depthCapWarning = buildDepthCapWarning(options?.cappedNodeIds ?? [])
  if (depthCapWarning) {
    warnings.push(depthCapWarning)
  }

  if (options?.shell) {
    warnings.push(buildShellWarning())
  }

  return warnings.length ? warnings : undefined
}

export function isCodeBudgetExceededError(error: unknown): error is CodeBudgetExceededError {
  return error instanceof CodeBudgetExceededError
}

function buildDepthCapWarning(nodeIds: string[]): GetCodeWarning | undefined {
  if (!nodeIds.length) {
    return undefined
  }

  return {
    type: 'depth-cap',
    message:
      'Tree depth capped; some subtree roots were omitted. Use returned data-hint-id values to continue with narrower get_code calls.'
  }
}

function buildShellWarning(): GetCodeWarning {
  return {
    type: 'shell',
    message: SHELL_WARNING_MESSAGE
  }
}
