import {
  classifySemanticAsset,
  resolveSemanticTag,
  suggestDepthLimit,
  summarizeComponentHint
} from '@/mcp/semantic-tree'
import { toDecimalPlace } from '@/utils/number'

import type { AutoLayoutHint, DataHint, NodeSnapshot, TreeStats, VisibleTree } from './model'

import { type GetCodeCacheContext, getChildOverflowCached } from './cache'
import { getInferredAutoLayout } from './layout-parent'

const NODE_WORK_BUDGET = 2000

export function buildVisibleTree(
  roots: SceneNode[],
  checkpoint?: () => void,
  cache?: GetCodeCacheContext
): VisibleTree {
  const depthLimit = suggestDepthLimit(roots, checkpoint, NODE_WORK_BUDGET)
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
    if (stats.totalNodes >= NODE_WORK_BUDGET) {
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

  // Bound the snapshot before native layout inference can inspect physical descendants.
  for (const snapshot of nodes.values()) {
    checkpoint?.()
    const autoLayoutHint = resolveAutoLayoutHint(snapshot.node, checkpoint, cache)
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
  checkpoint?: () => void,
  cache?: GetCodeCacheContext
): AutoLayoutHint | undefined {
  if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE') {
    return undefined
  }
  let clippedOverflow: boolean | undefined
  if (
    cache &&
    'inferredAutoLayout' in node &&
    'clipsContent' in node &&
    node.clipsContent &&
    node.layoutMode === 'NONE'
  ) {
    const overflow = getChildOverflowCached(node, cache, checkpoint)
    clippedOverflow = overflow.x || overflow.y
  }
  if (getInferredAutoLayout(node, clippedOverflow, checkpoint)) {
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
