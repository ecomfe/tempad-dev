import type { OutlineNode } from '@/mcp-server/src/tools'

const NODE_CAP = 800
const NODE_TARGET = 400

export type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DataHint =
  | { kind: 'attr'; name: string; value: string }
  | { kind: 'comment'; value: string }

export type SemanticNode = {
  id: string
  name: string
  type: SceneNode['type']
  tag: string
  depth: number
  index: number
  layout: 'auto' | 'absolute'
  bounds: Bounds
  isComponentInstance: boolean
  isAsset: boolean
  assetKind?: 'vector' | 'image'
  dataHint?: DataHint
  capped?: boolean
  children: SemanticNode[]
}

export type SemanticTreeStats = {
  totalNodes: number
  maxDepth: number
  suggestedDepth?: number
  depthLimit?: number
  capped: boolean
}

export type SemanticTree = {
  roots: SemanticNode[]
  stats: SemanticTreeStats
  depthLimit?: number
  cappedNodeIds: string[]
}

export type SemanticTreeOptions = {
  depthLimit?: number
}

type TraversalContext = {
  depthLimit?: number
  stats: SemanticTreeStats
  cappedNodeIds: string[]
}

type FlattenResult = SemanticNode[]

function assignIndexes(nodes: SemanticNode[]): void {
  nodes.forEach((node, idx) => {
    node.index = idx
    if (node.children.length) assignIndexes(node.children)
  })
}

const VECTOR_LIKE_TYPES = new Set<SceneNode['type']>([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON'
])

function getBounds(node: SceneNode): Bounds {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

function getVisibleChildren(node: SceneNode): SceneNode[] {
  if (!('children' in node)) return []
  return node.children.filter((child) => child.visible)
}

function isWrapper(node: SceneNode): boolean {
  if (!('children' in node)) return false
  const visibleChildren = getVisibleChildren(node)
  if (visibleChildren.length !== 1) return false
  if (node.type === 'SECTION') return false
  if ('isMask' in node && node.isMask) return false

  const hasFills =
    'fills' in node &&
    Array.isArray(node.fills) &&
    node.fills.some((fill) => fill.visible !== false)
  const hasStrokes =
    'strokes' in node &&
    Array.isArray(node.strokes) &&
    node.strokes.some((stroke) => stroke.visible !== false)
  const hasVisibleEffects =
    'effects' in node &&
    Array.isArray(node.effects) &&
    node.effects.some((effect) => effect.visible !== false)
  if (hasFills || hasStrokes || hasVisibleEffects) {
    return false
  }

  return true
}

function resolveTag(node: SceneNode): string {
  if (node.type === 'TEXT') {
    return node.characters.includes('\n') ? 'p' : 'span'
  }

  if (VECTOR_LIKE_TYPES.has(node.type)) {
    return 'svg'
  }

  if (node.type === 'RECTANGLE' && Array.isArray(node.fills)) {
    const hasImageFill = node.fills.some((fill) => fill.type === 'IMAGE' && fill.visible !== false)
    if (hasImageFill) return 'img'
  }

  return 'div'
}

function classifyAsset(node: SceneNode): { isAsset: boolean; assetKind?: 'vector' | 'image' } {
  if (VECTOR_LIKE_TYPES.has(node.type)) {
    return { isAsset: true, assetKind: 'vector' }
  }

  if (node.type === 'RECTANGLE' && Array.isArray(node.fills)) {
    const hasImageFill = node.fills.some((fill) => fill.type === 'IMAGE' && fill.visible !== false)
    if (hasImageFill) {
      return { isAsset: true, assetKind: 'image' }
    }
  }

  if (node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR') {
    return { isAsset: true, assetKind: 'vector' }
  }

  return { isAsset: false }
}

function composeDataHint(node: SceneNode): DataHint | undefined {
  if (node.type === 'INSTANCE') {
    const componentName = node.mainComponent?.name ?? node.name
    return { kind: 'attr', name: 'data-tp', value: `instance:${componentName}` }
  }

  if ('componentPropertyReferences' in node) {
    const refs = Object.keys(node.componentPropertyReferences ?? {})
    if (refs.length) {
      return { kind: 'comment', value: `tp:props(${refs.join(',')})` }
    }
  }

  return undefined
}

function getLayoutKind(node: SceneNode): 'auto' | 'absolute' {
  if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    return 'auto'
  }
  return 'absolute'
}

function visit(
  node: SceneNode,
  depth: number,
  index: number,
  ctx: TraversalContext
): FlattenResult {
  if (!node.visible) return []

  if (ctx.depthLimit !== undefined && depth >= ctx.depthLimit) {
    ctx.stats.totalNodes += 1
    ctx.stats.maxDepth = Math.max(ctx.stats.maxDepth, depth)
    ctx.stats.capped = true
    ctx.cappedNodeIds.push(node.id)

    const semanticNode: SemanticNode = {
      id: node.id,
      name: node.name,
      type: node.type,
      tag: resolveTag(node),
      depth,
      index,
      layout: getLayoutKind(node),
      bounds: getBounds(node),
      isComponentInstance: node.type === 'INSTANCE',
      ...classifyAsset(node),
      capped: true,
      children: []
    }

    const hint = composeDataHint(node)
    if (hint) {
      semanticNode.dataHint = hint
    }

    return [semanticNode]
  }

  if (isWrapper(node)) {
    const children = getVisibleChildren(node)
    return children.flatMap((child, childIndex) => visit(child, depth, childIndex, ctx))
  }

  const children = getVisibleChildren(node).flatMap((child, childIndex) =>
    visit(child, depth + 1, childIndex, ctx)
  )
  assignIndexes(children)

  const semanticNode: SemanticNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    tag: resolveTag(node),
    depth,
    index,
    layout: getLayoutKind(node),
    bounds: getBounds(node),
    isComponentInstance: node.type === 'INSTANCE',
    ...classifyAsset(node),
    children
  }

  const hint = composeDataHint(node)
  if (hint) {
    semanticNode.dataHint = hint
  }

  ctx.stats.totalNodes += 1
  ctx.stats.maxDepth = Math.max(ctx.stats.maxDepth, depth)

  return [semanticNode]
}

function collectDepthCounts(nodes: SceneNode[], depth = 0, counts: number[] = []): number[] {
  if (!counts[depth]) counts[depth] = 0
  for (const node of nodes) {
    if (!node.visible) continue
    counts[depth] += 1
    if ('children' in node) {
      collectDepthCounts(Array.from(node.children), depth + 1, counts)
    }
  }
  return counts
}

export function suggestDepthLimit(roots: SceneNode[]): number | undefined {
  const counts = collectDepthCounts(roots)
  const total = counts.reduce((sum, value) => sum + value, 0)
  if (total <= NODE_CAP) {
    return undefined
  }

  let cumulative = 0
  for (let i = 0; i < counts.length; i += 1) {
    cumulative += counts[i]
    if (cumulative > NODE_TARGET) {
      return i
    }
  }

  return counts.length
}

export function buildSemanticTree(
  roots: SceneNode[],
  options: SemanticTreeOptions = {}
): SemanticTree {
  const depthLimit = options.depthLimit ?? suggestDepthLimit(roots)
  const suggestedDepth = options.depthLimit === undefined ? depthLimit : undefined
  const stats: SemanticTreeStats = {
    totalNodes: 0,
    maxDepth: 0,
    suggestedDepth,
    depthLimit,
    capped: false
  }
  const cappedNodeIds: string[] = []

  const semanticRoots = roots.flatMap((node, index) =>
    visit(node, 0, index, { depthLimit, stats, cappedNodeIds })
  )
  assignIndexes(semanticRoots)

  return {
    roots: semanticRoots,
    stats,
    depthLimit,
    cappedNodeIds
  }
}

export function semanticTreeToOutline(nodes: SemanticNode[]): OutlineNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.bounds.x,
    y: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
    ...(node.children.length ? { children: semanticTreeToOutline(node.children) } : {})
  }))
}
