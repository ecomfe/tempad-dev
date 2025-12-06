import type { GetStructureResult } from '@/mcp-server/src/tools'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'
import { MCP_MAX_PAYLOAD_BYTES } from '@/mcp/shared/constants'

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  // Prefer semantic-tree suggested cap when no explicit depth provided.
  const resolvedDepthLimit = depthLimit || undefined
  const tree = buildSemanticTree(roots, { depthLimit: resolvedDepthLimit })
  const payload = { roots: semanticTreeToOutline(tree.roots) }

  const approxSize = JSON.stringify(payload).length
  if (approxSize > MCP_MAX_PAYLOAD_BYTES) {
    throw new Error('Structure payload too large to return. Reduce selection or depth and retry.')
  }

  return payload
}
