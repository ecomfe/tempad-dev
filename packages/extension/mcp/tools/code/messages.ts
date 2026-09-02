import type { GetCodeLiteralCluster, GetCodeWarning, ToolResponseLike } from '@tempad-dev/shared'

import { measureCallToolResultBytes } from '@tempad-dev/shared'

const AUTO_LAYOUT_REGEX = /data-hint-auto-layout\s*=\s*["']?inferred["']?/i

export class CodeBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodeBudgetExceededError'
  }
}

export function assertToolResponseWithinBudget(
  result: ToolResponseLike,
  maxResultBytes: number
): void {
  const size = measureCallToolResultBytes(result)
  if (size <= maxResultBytes) return
  throw new CodeBudgetExceededError(
    `Tool result exceeds inline budget (${size} UTF-8 bytes > ${maxResultBytes} UTF-8 bytes). Reduce selection size and retry, or call get_code on a smaller nodeId subtree.`
  )
}

export function buildGetCodeWarnings(
  code: string,
  options?: {
    cappedNodeIds?: string[]
    literalClusters?: GetCodeLiteralCluster[]
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

  if (options?.cappedNodeIds?.length) {
    warnings.push({
      type: 'depth-cap',
      message:
        'Tree depth capped; some subtree roots were omitted. Use returned data-hint-id values to continue with narrower get_code calls.'
    })
  }

  if (options?.literalClusters?.length) {
    warnings.push({
      type: 'literal-cluster',
      message:
        'Repeated unbound color literals are listed in structuredContent.literalClusters with concrete consumer nodes. Classify each cluster before propagating a system: bind consumers that should change together, or keep them literal only when independently owned.'
    })
  }

  if (options?.shell) {
    warnings.push({
      type: 'shell',
      message:
        'Shell response: omitted direct child ids are listed in the inline comment. Call get_code for them in that order, then fill the results back into this shell instead of re-creating the parent layout.'
    })
  }

  return warnings.length ? warnings : undefined
}
