import type { NodeSnapshot, VisibleTree } from '../model'

export type AssetPlan = {
  vectorRoots: Set<string>
  skippedIds: Set<string>
}

export function planAssets(tree: VisibleTree): AssetPlan {
  const vectorRoots = new Set<string>()
  const skipped = new Set<string>()
  const vectorInfo = computeVectorInfo(tree)

  for (const id of tree.order) {
    if (skipped.has(id)) continue
    const node = tree.nodes.get(id)
    if (!node) continue

    const children = node.children
      .map((childId) => tree.nodes.get(childId))
      .filter(Boolean) as NodeSnapshot[]

    const info = vectorInfo.get(id)
    const isVectorGroup = !!info && info.allVector && info.leafCount > 1 && node.children.length > 1

    if (isVectorGroup) {
      vectorRoots.add(id)
      children.forEach((child) => skipDescendants(child.id, tree, skipped))
      continue
    }

    if (node.assetKind === 'vector') {
      vectorRoots.add(id)
    }
  }

  return { vectorRoots, skippedIds: skipped }
}

function computeVectorInfo(
  tree: VisibleTree
): Map<string, { allVector: boolean; leafCount: number }> {
  const info = new Map<string, { allVector: boolean; leafCount: number }>()

  for (let i = tree.order.length - 1; i >= 0; i--) {
    const id = tree.order[i]
    const node = tree.nodes.get(id)
    if (!node) continue

    if (!node.children.length) {
      const isVector = node.assetKind === 'vector'
      info.set(id, { allVector: isVector, leafCount: isVector ? 1 : 0 })
      continue
    }

    let allVector = true
    let leafCount = 0
    for (const childId of node.children) {
      const childInfo = info.get(childId)
      if (!childInfo || !childInfo.allVector) {
        allVector = false
      }
      if (childInfo) leafCount += childInfo.leafCount
    }
    info.set(id, { allVector, leafCount })
  }

  return info
}

function skipDescendants(id: string, tree: VisibleTree, skipped: Set<string>): void {
  const node = tree.nodes.get(id)
  if (!node) return
  if (skipped.has(id)) return
  skipped.add(id)
  node.children.forEach((childId) => skipDescendants(childId, tree, skipped))
}
