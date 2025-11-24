import type { GetStructureResult } from '@/mcp-server/src/tools'
import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  const resolvedDepthLimit = depthLimit || Number.POSITIVE_INFINITY
  const tree = buildSemanticTree(roots, { depthLimit: resolvedDepthLimit })
  return {
    roots: semanticTreeToOutline(tree.roots)
  }
}
