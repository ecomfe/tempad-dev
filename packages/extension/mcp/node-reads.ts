import type { NodeReadBatchResult, NodeReadResult, ToolResponseLike } from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  MCP_NODE_READ_BATCH_WORK_BUDGET_MS,
  TEMPAD_MCP_ERROR_CODES,
  measureCallToolResultBytes
} from '@tempad-dev/shared'

import { coerceToolErrorPayload, createCodedError } from './errors'
import { CodeBudgetExceededError } from './tools/code/messages'

type ReadTarget = { nodeId: string } & (
  | { node: SceneNode; error?: never }
  | { error: Error; node?: never }
)

// Bound expensive exports/codegen independently of the response byte budget. Continuation
// uses exact IDs, so a selection change between calls cannot redirect deferred work.
const MAX_NODES_PER_BATCH = 8
class BatchFullError extends Error {}

export function resolveReadTargets(args?: { nodeId?: string; nodeIds?: string[] }): {
  targets: ReadTarget[]
  batch: boolean
} {
  if (args?.nodeId !== undefined && args.nodeIds !== undefined) {
    throw new Error('Use only one of nodeId or nodeIds.')
  }
  const explicitIds = args?.nodeIds ?? (args?.nodeId === undefined ? undefined : [args.nodeId])
  const selectedById = new Map(
    explicitIds ? [] : figma.currentPage.selection.map((node) => [node.id, node])
  )
  const ids = explicitIds ? [...new Set(explicitIds)] : [...selectedById.keys()]
  if (!ids.length) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION,
      'Select one or more visible nodes, or provide nodeIds.'
    )
  }
  const targets: ReadTarget[] = ids.map((nodeId) => {
    try {
      const node = explicitIds ? figma.getNodeById(nodeId) : selectedById.get(nodeId)
      const reason = !node
        ? 'does not exist in the current document'
        : !('visible' in node)
          ? 'is not a supported scene node'
          : !node.visible
            ? 'is hidden'
            : undefined
      if (reason) {
        throw createCodedError(
          !explicitIds && ids.length === 1
            ? TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION
            : TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
          `Node "${nodeId}" ${reason}.`
        )
      }
      return { nodeId, node: node as SceneNode }
    } catch (error) {
      return {
        nodeId,
        error:
          error instanceof Error ? error : Object.assign(new Error(), coerceToolErrorPayload(error))
      }
    }
  })
  return { targets, batch: args?.nodeIds !== undefined || targets.length > 1 }
}

export function singleReadTarget(targets: ReadTarget[]): SceneNode {
  const target = targets[0]!
  if (target.error) throw target.error
  return target.node
}

export async function readNodeBatch<T>(
  targets: ReadTarget[],
  read: (node: SceneNode, formatResult: (result: T) => ToolResponseLike) => Promise<T>,
  format: (result: NodeReadBatchResult<T>) => ToolResponseLike
): Promise<NodeReadBatchResult<T>> {
  const results: NodeReadResult<T>[] = []
  const startedAt = Date.now()
  const envelope = (entries: NodeReadResult<T>[]): NodeReadBatchResult<T> => ({
    results: entries,
    ...(entries.length < targets.length
      ? { remainingNodeIds: targets.slice(entries.length).map(({ nodeId }) => nodeId) }
      : {})
  })
  const fits = (payload: NodeReadBatchResult<T>) =>
    measureCallToolResultBytes(format(payload)) <= MCP_TOOL_INLINE_BUDGET_BYTES
  // Reserve enough room for a bounded error so an otherwise valid call can always progress.
  if (measureCallToolResultBytes(format(envelope([]))) > MCP_TOOL_INLINE_BUDGET_BYTES - 4096) {
    throw new Error('Node selection exceeds the inline budget. Request fewer nodeIds.')
  }
  for (const target of targets) {
    const index = results.length
    if (
      index >= MAX_NODES_PER_BATCH ||
      (index > 0 && Date.now() - startedAt >= MCP_NODE_READ_BATCH_WORK_BUDGET_MS)
    )
      break
    const { nodeId } = target
    let entry: NodeReadResult<T>
    try {
      if (target.error) throw target.error
      const result = await read(target.node, (result) => {
        const response = format(envelope([...results, { nodeId, result }]))
        // Defer later roots intact instead of degrading them to shells just because
        // earlier roots used the shared budget. A root alone still has shell fallback.
        if (index > 0 && measureCallToolResultBytes(response) > MCP_TOOL_INLINE_BUDGET_BYTES)
          throw new BatchFullError()
        return response
      })
      entry = { nodeId, result }
    } catch (error) {
      // A root that cannot fit after earlier results gets its full budget on continuation.
      if (
        (error instanceof CodeBudgetExceededError || error instanceof BatchFullError) &&
        index > 0
      )
        break
      const normalized = coerceToolErrorPayload(error)
      entry = { nodeId, error: { ...normalized, message: normalized.message.slice(0, 1024) } }
    }
    if (!fits(envelope([...results, entry]))) {
      if (index > 0) break
      entry = {
        nodeId,
        error: {
          message: 'This node result exceeds the inline budget. Request a smaller nodeId subtree.'
        }
      }
      if (!fits(envelope([entry])))
        throw new Error('Node selection exceeds the inline budget. Request fewer nodeIds.')
    }
    results.push(entry)
  }
  return envelope(results)
}
