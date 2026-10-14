import type { NodeSnapshot, VisibleTree } from './model'

import { computeChildOverflow } from './styles/overflow'

const SKIP_LAYOUT_TYPES = new Set<SceneNode['type']>(['GROUP', 'BOOLEAN_OPERATION'])

// A clipped, freeform composition cannot be represented by Figma's inferred
// flex padding: negative offsets and the clipping viewport would be lost.
export function hasClippedOverflow(
  node: SceneNode,
  overflow?: { x: boolean; y: boolean },
  checkpoint?: () => void
): boolean {
  if (!('clipsContent' in node) || !node.clipsContent || node.layoutMode !== 'NONE') return false
  const result = overflow ?? computeChildOverflow(node, checkpoint)
  return result.x || result.y
}

export function getInferredAutoLayout(
  node: SceneNode,
  clippedOverflow?: boolean,
  checkpoint?: () => void
): InferredAutoLayoutResult | null {
  checkpoint?.()
  if (
    !('inferredAutoLayout' in node) ||
    (clippedOverflow ?? hasClippedOverflow(node, undefined, checkpoint))
  )
    return null
  checkpoint?.()
  return node.inferredAutoLayout
}

export function getLayoutParent(
  tree: VisibleTree,
  snapshot: NodeSnapshot
): NodeSnapshot | undefined {
  let parentId = snapshot.parentId
  while (parentId) {
    const parent = tree.nodes.get(parentId)
    if (!parent) return undefined
    if (!SKIP_LAYOUT_TYPES.has(parent.node.type)) return parent
    if (isGroupLayoutBox(tree, parent)) return parent
    parentId = parent.parentId
  }
  return undefined
}

export function isFlowGroup(tree: VisibleTree, snapshot: NodeSnapshot): boolean {
  if (snapshot.type !== 'GROUP') return false
  if ('layoutPositioning' in snapshot.node && snapshot.node.layoutPositioning === 'ABSOLUTE')
    return false
  const parent = snapshot.parentId ? tree.nodes.get(snapshot.parentId) : undefined
  if (!parent) return false
  return isAutoLayoutParent(parent)
}

// Groups in auto layout need a box even when nested or absolutely positioned.
// Freeform groups keep sharing their nearest container's coordinate system.
export function isGroupLayoutBox(tree: VisibleTree, snapshot: NodeSnapshot): boolean {
  if (snapshot.type !== 'GROUP') return false
  let parent = snapshot.parentId ? tree.nodes.get(snapshot.parentId) : undefined
  while (parent?.type === 'GROUP') {
    parent = parent.parentId ? tree.nodes.get(parent.parentId) : undefined
  }
  return !!parent && isAutoLayoutParent(parent)
}

function isAutoLayoutParent(parent: NodeSnapshot): boolean {
  return (
    ('layoutMode' in parent.node && parent.node.layoutMode !== 'NONE') ||
    parent.autoLayoutHint === 'inferred'
  )
}
