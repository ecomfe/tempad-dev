import {
  classifySemanticAsset,
  resolveSemanticTag,
  suggestDepthLimit,
  summarizeComponentHint
} from '@/mcp/semantic-tree'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { AutoLayoutHint, DataHint, NodeSnapshot, TreeStats, VisibleTree } from './model'

export function buildVisibleTree(roots: SceneNode[]): VisibleTree {
  const depthLimit = suggestDepthLimit(roots)
  const stats: TreeStats = {
    totalNodes: 0,
    maxDepth: 0,
    depthLimit,
    capped: false,
    cappedNodeIds: []
  }

  const collectionCache = new Map<string, { name: string; modes: Map<string, string> } | null>()
  const collectionIdByName = new Map<string, string>()
  const warnedDuplicateCollections = new Set<string>()

  const nodes = new Map<string, NodeSnapshot>()
  const order: string[] = []
  const rootIds: string[] = []

  const getCollectionInfo = (id: string) => {
    if (collectionCache.has(id)) return collectionCache.get(id)
    try {
      const collection = figma.variables.getVariableCollectionById(id)
      if (!collection) {
        collectionCache.set(id, null)
        return null
      }

      const name = collection.name || id
      if (name) {
        const existing = collectionIdByName.get(name)
        if (!existing) {
          collectionIdByName.set(name, collection.id)
        } else if (existing !== collection.id && !warnedDuplicateCollections.has(name)) {
          warnedDuplicateCollections.add(name)
          logger.warn(`Duplicate variable collection name "${name}" detected.`)
        }
      }

      const modes = new Map<string, string>()
      if (Array.isArray(collection.modes)) {
        collection.modes.forEach((mode) => {
          modes.set(mode.modeId, mode.name || mode.modeId)
        })
      }

      const info = { name, modes }
      collectionCache.set(id, info)
      return info
    } catch {
      collectionCache.set(id, null)
      return null
    }
  }

  const resolveVariableModeHint = (node: SceneNode): string | undefined => {
    if (!('explicitVariableModes' in node)) return undefined
    const explicit = (node as { explicitVariableModes?: Record<string, string> })
      .explicitVariableModes
    if (!explicit || typeof explicit !== 'object') return undefined

    const entries = Object.entries(explicit)
    if (!entries.length) return undefined

    const parts = entries
      .map(([collectionId, modeId]) => {
        const info = getCollectionInfo(collectionId)
        const collectionName = info?.name || collectionId
        const modeName = info?.modes.get(modeId) || modeId
        return { collectionName, modeName }
      })
      .sort((a, b) => a.collectionName.localeCompare(b.collectionName))
      .map(({ collectionName, modeName }) => `${collectionName}=${modeName}`)

    return parts.length ? parts.join(';') : undefined
  }

  const visit = (node: SceneNode, depth: number, parentId?: string) => {
    if (!node.visible) return

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

    const variableModeHint = resolveVariableModeHint(node)
    if (variableModeHint) {
      snapshot.dataHint = snapshot.dataHint ?? {}
      snapshot.dataHint['data-hint-variable-mode'] = variableModeHint
    }

    const autoLayoutHint = resolveAutoLayoutHint(node)
    if (autoLayoutHint) {
      snapshot.autoLayoutHint = autoLayoutHint
      snapshot.dataHint = snapshot.dataHint ?? {}
      snapshot.dataHint['data-hint-auto-layout'] = autoLayoutHint
    }

    nodes.set(snapshot.id, snapshot)
    order.push(snapshot.id)

    if (depthLimit !== undefined && depth >= depthLimit) {
      stats.capped = true
      if (!stats.cappedNodeIds.includes(snapshot.id)) {
        stats.cappedNodeIds.push(snapshot.id)
      }
      return
    }

    if ('children' in node) {
      const children = node.children.filter((child) => child.visible)
      for (const child of children) {
        snapshot.children.push(child.id)
        visit(child, depth + 1, node.id)
      }
    }
  }

  roots.forEach((root) => {
    if (!root.visible) return
    rootIds.push(root.id)
    visit(root, 0, undefined)
  })

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

function resolveAutoLayoutHint(node: SceneNode): AutoLayoutHint | undefined {
  if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE') {
    return undefined
  }
  if (hasInferredAutoLayout(node)) {
    return 'inferred'
  }
  return undefined
}

function hasInferredAutoLayout(node: SceneNode): boolean {
  if (!('inferredAutoLayout' in node)) return false
  return Boolean(node.inferredAutoLayout)
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
