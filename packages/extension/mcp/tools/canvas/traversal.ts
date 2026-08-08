function* walkNodes(
  roots: Iterable<SceneNode>,
  shouldDescend: (node: SceneNode) => boolean
): Generator<SceneNode> {
  const stack = [...roots]
  while (stack.length) {
    const node = stack.pop()!
    yield node
    if ('children' in node && shouldDescend(node)) stack.push(...node.children)
  }
}

export function walkAuthoringNodes(roots: Iterable<SceneNode>): Generator<SceneNode> {
  return walkNodes(roots, (node) => node.type !== 'INSTANCE')
}

export function walkPhysicalNodes(roots: Iterable<SceneNode>): Generator<SceneNode> {
  return walkNodes(roots, () => true)
}

export function isInsideInstance(node: BaseNode): boolean {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'INSTANCE') return true
    parent = parent.parent
  }
  return false
}

export function isComponentPropertyOwner(node: BaseNode): node is ComponentNode | ComponentSetNode {
  return (
    node.type === 'COMPONENT_SET' ||
    (node.type === 'COMPONENT' && node.parent?.type !== 'COMPONENT_SET')
  )
}
