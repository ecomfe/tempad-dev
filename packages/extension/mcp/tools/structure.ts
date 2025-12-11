import type { GetStructureResult } from '@tempad-dev/mcp-shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/mcp-shared'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'

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
