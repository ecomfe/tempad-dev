import {
  type ApplyCanvasResult,
  type CanvasPageSnapshot,
  measureCallToolResultBytes,
  buildApplyCanvasToolResult,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  MCP_APPLY_CANVAS_RUNTIME_BUDGET_BYTES
} from '@tempad-dev/shared'

import type { VerificationWarning, ApplyState } from './state'

import { specError } from '../errors'

export function buildVerification(
  nodesChecked = 0,
  referencesChecked = 0,
  nativeFieldsChecked = 0,
  warnings: VerificationWarning[] = []
) {
  return {
    status: warnings.length ? ('warning' as const) : ('passed' as const),
    nodesChecked,
    referencesChecked,
    nativeFieldsChecked,
    warnings
  }
}

export function removedRootResult(
  rootNodeId: string,
  removedNodeIds: string[] = [],
  state?: ApplyState
): ApplyCanvasResult {
  return {
    rootNodeId,
    rootRemoved: true,
    nodeIdsByKey: state?.nodeIdsByKey ?? {},
    createdNodeIds: [],
    updatedNodeIds: [],
    removedNodeIds,
    mutationCount: state?.mutations.count ?? 0,
    verification: buildVerification()
  }
}

export function pageApplyResult(page: CanvasPageSnapshot, state: ApplyState): ApplyCanvasResult {
  return boundedApplyResult({
    nodeIdsByKey: state.nodeIdsByKey,
    createdNodeIds: [...state.createdNodeIds],
    updatedNodeIds: [...state.updatedNodeIds],
    removedNodeIds: [],
    page,
    mutationCount: state.mutations.count,
    verification: buildVerification()
  })
}

export function boundedApplyResult(result: ApplyCanvasResult): ApplyCanvasResult {
  const bytes = measureCallToolResultBytes(buildApplyCanvasToolResult(result))
  if (bytes > MCP_TOOL_INLINE_BUDGET_BYTES - MCP_APPLY_CANVAS_RUNTIME_BUDGET_BYTES) {
    specError(
      'apply_canvas result exceeds the 64 KiB inline budget. Reduce the desired subtree or split the operation.'
    )
  }
  return result
}
