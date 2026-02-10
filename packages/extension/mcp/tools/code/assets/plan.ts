import type { NodeSnapshot, VisibleTree } from '../model'

export type AssetPlan = {
  vectorRoots: Set<string>
  skippedIds: Set<string>
}

type VectorInfo = {
  allNonMaskVectorLike: boolean
  nonMaskLeafCount: number
  hasMask: boolean
}

const VECTOR_LIKE_LEAF_TYPES = new Set<SceneNode['type']>([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON',
  'RECTANGLE'
])

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
    const isVectorGroup =
      !!info &&
      isEligibleContainer(node) &&
      node.children.length > 1 &&
      info.allNonMaskVectorLike &&
      info.nonMaskLeafCount >= 1 &&
      (info.hasMask || info.nonMaskLeafCount > 1)

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

function computeVectorInfo(tree: VisibleTree): Map<string, VectorInfo> {
  const info = new Map<string, VectorInfo>()

  for (let i = tree.order.length - 1; i >= 0; i--) {
    const id = tree.order[i]
    const node = tree.nodes.get(id)
    if (!node) continue

    if (!node.children.length) {
      if (isMaskNode(node)) {
        info.set(id, {
          allNonMaskVectorLike: true,
          nonMaskLeafCount: 0,
          hasMask: true
        })
        continue
      }

      const isVectorLike = isVectorLikeLeaf(node)
      info.set(id, {
        allNonMaskVectorLike: isVectorLike,
        nonMaskLeafCount: isVectorLike ? 1 : 0,
        hasMask: false
      })
      continue
    }

    let allNonMaskVectorLike = true
    let nonMaskLeafCount = 0
    let hasMask = isMaskNode(node)
    for (const childId of node.children) {
      const childInfo = info.get(childId)
      if (!childInfo || !childInfo.allNonMaskVectorLike) {
        allNonMaskVectorLike = false
      }
      if (childInfo) {
        nonMaskLeafCount += childInfo.nonMaskLeafCount
        if (childInfo.hasMask) hasMask = true
      }
    }
    info.set(id, { allNonMaskVectorLike, nonMaskLeafCount, hasMask })
  }

  return info
}

function isEligibleContainer(node: NodeSnapshot): boolean {
  return node.type === 'GROUP' || node.type === 'FRAME'
}

function isMaskNode(snapshot: NodeSnapshot): boolean {
  const node = snapshot.node as { isMask?: boolean }
  return node.isMask === true
}

function isVectorLikeLeaf(snapshot: NodeSnapshot): boolean {
  if (snapshot.assetKind === 'image') return false
  if (snapshot.assetKind === 'vector') return true
  return VECTOR_LIKE_LEAF_TYPES.has(snapshot.type)
}

function skipDescendants(id: string, tree: VisibleTree, skipped: Set<string>): void {
  const node = tree.nodes.get(id)
  if (!node) return
  if (skipped.has(id)) return
  skipped.add(id)
  node.children.forEach((childId) => skipDescendants(childId, tree, skipped))
}
