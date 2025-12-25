import type { VisibleTree } from '../model'

import { getLayoutParent } from '../layout-parent'

type StyleMap = Map<string, Record<string, string>>

export function ensureRelativeForAbsoluteChildren(
  tree: VisibleTree,
  styles: StyleMap,
  svgRoots?: Set<string>
): void {
  const layoutParents = new Set<string>()
  tree.rootIds.forEach((rootId) => collect(layoutParents, rootId, tree, styles, svgRoots))
  layoutParents.forEach((id) => {
    const style = styles.get(id) ?? {}
    if (style.position) return
    styles.set(id, { ...style, position: 'relative' })
  })
}

function collect(
  layoutParents: Set<string>,
  nodeId: string,
  tree: VisibleTree,
  styles: StyleMap,
  svgRoots?: Set<string>
): void {
  const node = tree.nodes.get(nodeId)
  if (!node) return
  const style = styles.get(node.id)
  if (style?.position?.toLowerCase() === 'absolute') {
    const layoutParent = getLayoutParent(tree, node)
    if (layoutParent) layoutParents.add(layoutParent.id)
  }

  const children = node.children ?? []
  children.forEach((childId) => collect(layoutParents, childId, tree, styles, svgRoots))
}
