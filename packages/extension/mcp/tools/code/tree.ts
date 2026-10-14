import {
  classifySemanticAsset,
  resolveSemanticTag,
  suggestDepthLimit,
  summarizeComponentHint
} from '@/mcp/semantic-tree'
import { toDecimalPlace } from '@/utils/number'

import type { AutoLayoutHint, DataHint, NodeSnapshot, TreeStats, VisibleTree } from './model'

import { getInferredAutoLayout } from './layout-parent'

export function buildVisibleTree(roots: SceneNode[], checkpoint?: () => void): VisibleTree {
  const depthLimit = suggestDepthLimit(roots, checkpoint)
  const stats: TreeStats = {
    totalNodes: 0,
    maxDepth: 0,
    depthLimit,
    capped: false
  }

  const nodes = new Map<string, NodeSnapshot>()
  const order: string[] = []
  const rootIds: string[] = []

  const visit = (node: SceneNode, depth: number, parentId?: string) => {
    checkpoint?.()
    if (!node.visible) return
    if (stats.totalNodes >= 2000) {
      throw new Error(
        'Code read exceeds the 2,000-node work budget. Use get_structure to select a narrower node and retry.'
      )
    }

    stats.totalNodes += 1
    stats.maxDepth = Math.max(stats.maxDepth, depth)

    const snapshot: NodeSnapshot = {
      id: node.id,
      type: node.type,
      tag: resolveSemanticTag(node),
      name: node.name ?? '',
      visible: node.visible,
      parentId,
      children: [],
      bounds: {
        x: toDecimalPlace(node.x),
        y: toDecimalPlace(node.y),
        width: toDecimalPlace(node.width),
        height: toDecimalPlace(node.height)
      },
      renderBounds: getRenderBounds(node),
      assetKind: classifySemanticAsset(node),
      node
    }

    const dataHint = composeDataHint(node)
    if (dataHint) snapshot.dataHint = dataHint

    nodes.set(snapshot.id, snapshot)
    order.push(snapshot.id)

    if (depthLimit !== undefined && depth >= depthLimit) {
      if (
        'children' in node &&
        node.children.some((child) => {
          checkpoint?.()
          return child.visible
        })
      ) {
        stats.capped = true
        snapshot.dataHint = { ...snapshot.dataHint, 'data-hint-id': node.id }
      }
      return
    }

    if ('children' in node) {
      for (const child of node.children) {
        checkpoint?.()
        if (!child.visible) continue
        snapshot.children.push(child.id)
        visit(child, depth + 1, node.id)
      }
    }
  }

  roots.forEach((root) => {
    checkpoint?.()
    if (!root.visible) return
    rootIds.push(root.id)
    visit(root, 0, undefined)
  })

  // Prove the node budget before native layout inference can inspect a wide
  // subtree that this request will reject anyway.
  for (const snapshot of nodes.values()) {
    checkpoint?.()
    const autoLayoutHint = resolveAutoLayoutHint(snapshot.node, checkpoint)
    if (autoLayoutHint) {
      snapshot.autoLayoutHint = autoLayoutHint
      snapshot.dataHint = snapshot.dataHint ?? {}
      snapshot.dataHint['data-hint-auto-layout'] = autoLayoutHint
    }
  }
  return { rootIds, nodes, order, stats }
}

function getRenderBounds(
  node: SceneNode
): { x: number; y: number; width: number; height: number } | null {
  const renderBounds = (node as { absoluteRenderBounds?: Rect | null }).absoluteRenderBounds
  if (renderBounds) {
    const { x, y, width, height } = renderBounds
    if (isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height)) {
      return {
        x: toDecimalPlace(x),
        y: toDecimalPlace(y),
        width: toDecimalPlace(width),
        height: toDecimalPlace(height)
      }
    }
  }
  return null
}

function resolveAutoLayoutHint(
  node: SceneNode,
  checkpoint?: () => void
): AutoLayoutHint | undefined {
  if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE') {
    return undefined
  }
  if (getInferredAutoLayout(node, undefined, checkpoint)) {
    return 'inferred'
  }
  return undefined
}

function composeDataHint(node: SceneNode): DataHint | undefined {
  const hints: DataHint = {}

  if (node.type === 'INSTANCE') {
    const componentHint = summarizeComponentHint(node)
    if (componentHint) hints['data-hint-design-component'] = componentHint
  }

  return Object.keys(hints).length ? hints : undefined
}

export function addSubtreeIds(id: string, tree: VisibleTree, target: Set<string>): void {
  const node = tree.nodes.get(id)
  if (!node || target.has(id)) return
  target.add(id)
  node.children.forEach((childId) => addSubtreeIds(childId, tree, target))
}
