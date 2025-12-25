import type { VisibleTree } from '../model'

type StyleMap = Map<string, Record<string, string>>

export function applyAbsoluteStackingOrder(tree: VisibleTree, styles: StyleMap): void {
  tree.rootIds.forEach((rootId) => visit(rootId, tree, styles))
}

function visit(nodeId: string, tree: VisibleTree, styles: StyleMap): void {
  const node = tree.nodes.get(nodeId)
  if (!node) return

  const children = node.children ?? []
  if (children.length) {
    const needsIsolation = new Set<string>()

    for (let i = 0; i < children.length; i += 1) {
      const childId = children[i]
      const childStyle = styles.get(childId)
      if (!isAbsolute(childStyle)) continue

      const hasLaterInFlow = children
        .slice(i + 1)
        .some((siblingId) => !isAbsolute(styles.get(siblingId)))

      if (!hasLaterInFlow) continue

      if (!childStyle?.['z-index']) {
        styles.set(childId, { ...(childStyle ?? {}), 'z-index': '-1' })
      }
      needsIsolation.add(nodeId)
    }

    needsIsolation.forEach((parentId) => {
      const style = styles.get(parentId) ?? {}
      if (style.isolation) return
      styles.set(parentId, { ...style, isolation: 'isolate' })
    })
  }

  children.forEach((childId) => visit(childId, tree, styles))
}

function isAbsolute(style?: Record<string, string>): boolean {
  return style?.position?.toLowerCase() === 'absolute'
}
