import type { VisibleTree } from '../model'

import { getLayoutParent } from '../layout-parent'

type StyleMap = Map<string, Record<string, string>>

export function ensureRelativeForAbsoluteChildren(tree: VisibleTree, styles: StyleMap): void {
  for (const id of tree.order) {
    const node = tree.nodes.get(id)
    if (!node || styles.get(id)?.position?.trim().toLowerCase() !== 'absolute') continue
    const layoutParent = getLayoutParent(tree, node)
    if (!layoutParent) continue
    const style = styles.get(layoutParent.id) ?? {}
    const position = style.position?.trim().toLowerCase()
    if (position && position !== 'static') continue
    styles.set(layoutParent.id, { ...style, position: 'relative' })
  }
}
