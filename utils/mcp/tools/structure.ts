import type { GetStructureResult, OutlineNode } from '@/mcp/src/tools'

const MAX_STRUCTURE_NODE_COUNT = 800
const TARGET_STRUCTURE_NODE_COUNT = 400

function getChildren(node: SceneNode): SceneNode[] {
  return 'children' in node ? [...node.children] : []
}

function collectDepthCounts(nodes: SceneNode[], depth = 0, counts: number[] = []): number[] {
  if (!counts[depth]) counts[depth] = 0
  for (const node of nodes) {
    if (!node.visible) continue
    counts[depth] += 1
    collectDepthCounts(getChildren(node), depth + 1, counts)
  }
  return counts
}

function suggestStructureDepth(roots: SceneNode[]): number | undefined {
  const counts = collectDepthCounts(roots)
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (total <= MAX_STRUCTURE_NODE_COUNT) {
    return undefined
  }

  let cumulative = 0
  for (let i = 0; i < counts.length; i += 1) {
    cumulative += counts[i]
    if (cumulative > TARGET_STRUCTURE_NODE_COUNT) {
      return i
    }
  }

  return counts.length
}

function buildOutlineNode(node: SceneNode, depth: number, depthLimit?: number): OutlineNode | null {
  const { name, type, visible, x, y, width, height } = node
  if (!visible) return null

  if (depthLimit !== undefined && depth >= depthLimit) {
    return { name, type, x, y, width, height }
  }

  const children = getChildren(node)
    .map((child) => buildOutlineNode(child, depth + 1, depthLimit))
    .filter((child): child is NonNullable<typeof child> => !!child)

  return {
    name,
    type,
    x,
    y,
    width,
    height,
    ...(children.length ? { children } : null)
  }
}

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  const depth = depthLimit !== undefined ? depthLimit : suggestStructureDepth(roots)

  const outlineRoots = roots
    .map((node) => buildOutlineNode(node, 0, depth))
    .filter((node): node is NonNullable<typeof node> => !!node)

  return { roots: outlineRoots }
}
