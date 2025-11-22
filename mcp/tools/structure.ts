import type { GetStructureResult } from '@/mcp-server/src/tools'
import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  const tree = buildSemanticTree(roots, { depthLimit })
  return {
    roots: semanticTreeToOutline(tree.roots)
  }
}
