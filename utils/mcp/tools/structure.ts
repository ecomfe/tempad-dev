import type { GetStructureResult } from '@/mcp/src/tools'
import { buildSemanticTree, semanticTreeToOutline } from '@/utils/mcp/semantic-tree'

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  const tree = buildSemanticTree(roots, { depthLimit })
  return {
    roots: semanticTreeToOutline(tree.roots)
  }
}
