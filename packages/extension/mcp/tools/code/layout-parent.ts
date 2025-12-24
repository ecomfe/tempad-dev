import type { NodeSnapshot, VisibleTree } from './model'

const SKIP_LAYOUT_TYPES = new Set<SceneNode['type']>(['GROUP', 'BOOLEAN_OPERATION'])

export function getLayoutParent(
  tree: VisibleTree,
  snapshot: NodeSnapshot
): NodeSnapshot | undefined {
  let parentId = snapshot.parentId
  while (parentId) {
    const parent = tree.nodes.get(parentId)
    if (!parent) return undefined
    if (!SKIP_LAYOUT_TYPES.has(parent.node.type)) return parent
    parentId = parent.parentId
  }
  return undefined
}
