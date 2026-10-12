import type { NodeSnapshot, VisibleTree } from './model'

const SKIP_LAYOUT_TYPES = new Set<SceneNode['type']>(['GROUP', 'BOOLEAN_OPERATION'])

// A clipped, freeform composition cannot be represented by Figma's inferred
// flex padding: negative offsets and the clipping viewport would be lost.
export function hasClippedOverflow(node: SceneNode): boolean {
  if (!('clipsContent' in node) || !node.clipsContent || node.layoutMode !== 'NONE') return false
  return node.children.some((child) => {
    if (!child.visible) return false
    const [[a, c, x], [b, d, y]] = child.relativeTransform
    return [
      [0, 0],
      [child.width, 0],
      [0, child.height],
      [child.width, child.height]
    ].some(([u, v]) => {
      const left = a * u + c * v + x
      const top = b * u + d * v + y
      return left < -0.01 || top < -0.01 || left > node.width + 0.01 || top > node.height + 0.01
    })
  })
}

export function getInferredAutoLayout(node: SceneNode): InferredAutoLayoutResult | null {
  if (!('inferredAutoLayout' in node) || hasClippedOverflow(node)) return null
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
    parentId = parent.parentId
  }
  return undefined
}
