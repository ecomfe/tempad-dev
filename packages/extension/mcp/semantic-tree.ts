import type { OutlineNode } from '@tempad-dev/mcp-shared'

import { toPascalCase } from '@/utils/string'

const NODE_CAP = 2048
const NODE_TARGET = 1536

export type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Lightweight metadata extracted from a SceneNode to help downstream renderers
 * preserve authoring intent without duplicating entire properties.
 *
 * Hints are carried as data attributes (e.g. data-hint-design-component).
 */
export type DataHint = Record<string, string>
type AutoLayoutSummary = {
  direction: 'row' | 'column'
  gap?: number
  alignPrimary?: string
  alignCounter?: string
  padding?: { top: number; right: number; bottom: number; left: number }
}

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
  autoLayout?: AutoLayoutSummary
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
  return (
    'children' in node &&
    getVisibleChildren(node).length === 1 &&
    node.type !== 'SECTION' &&
    !('isMask' in node && node.isMask) &&
    !hasExplicitOverflow(node) &&
    !hasExplicitAutoLayout(node) &&
    !hasVisibleSurface(node) &&
    !hasPadding(node)
  )
}

function resolveTag(node: SceneNode): string {
  const { type } = node
  if (type === 'TEXT') {
    return node.characters.includes('\n') ? 'p' : 'span'
  }

  if (VECTOR_LIKE_TYPES.has(type)) {
    return 'svg'
  }

  if (type === 'RECTANGLE' && Array.isArray(node.fills)) {
    const { fills } = node
    const hasImageFill = fills.some((fill) => fill.type === 'IMAGE' && fill.visible !== false)
    if (hasImageFill) return 'img'
  }

  return 'div'
}

function classifyAsset(node: SceneNode): { isAsset: boolean; assetKind?: 'vector' | 'image' } {
  const { type } = node
  if (VECTOR_LIKE_TYPES.has(type)) {
    return { isAsset: true, assetKind: 'vector' }
  }

  if (type === 'RECTANGLE' && Array.isArray(node.fills)) {
    const { fills } = node
    const hasImageFill = fills.some((fill) => fill.type === 'IMAGE' && fill.visible !== false)
    if (hasImageFill) {
      return { isAsset: true, assetKind: 'image' }
    }
  }

  if (type === 'ELLIPSE' || type === 'POLYGON' || type === 'STAR') {
    return { isAsset: true, assetKind: 'vector' }
  }

  return { isAsset: false }
}

function hasExplicitOverflow(node: SceneNode): boolean {
  if (!('overflowDirection' in node)) return false
  const dir = (node as { overflowDirection?: string }).overflowDirection
  return dir !== undefined && dir !== 'NONE'
}

function hasExplicitAutoLayout(node: SceneNode): boolean {
  return 'layoutMode' in node && !!(node.layoutMode && node.layoutMode !== 'NONE')
}

function hasVisibleSurface(node: SceneNode): boolean {
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
  return hasFills || hasStrokes || hasVisibleEffects
}

function hasPadding(node: SceneNode): boolean {
  const paddingKeys: Array<keyof BaseFrameMixin> = [
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft'
  ]
  return paddingKeys.some((key) => typeof (node as Partial<BaseFrameMixin>)[key] === 'number')
}

function composeDataHint(node: SceneNode): DataHint | undefined {
  const hints: DataHint = {}

  if (node.type === 'INSTANCE') {
    const { mainComponent } = node as InstanceNode
    const name =
      mainComponent?.parent?.type === 'COMPONENT_SET'
        ? mainComponent.parent.name
        : (mainComponent?.name ?? node.name)
    const props = summarizeComponentProperties(node) ?? ''
    if (name) {
      hints['data-hint-design-component'] = `${toPascalCase(name)}${props}`
    }
  }

  const layoutHint = summarizeLayoutHint(node)
  if (layoutHint) {
    hints['data-hint-auto-layout'] = layoutHint
  }

  return Object.keys(hints).length ? hints : undefined
}

type ComponentPropertyValueLike =
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'TEXT'; value: string }
  | { type: 'VARIANT'; value: string }
  | { type: 'INSTANCE_SWAP'; value: string }
  | { type: string; value: unknown }

function getComponentProperties(
  node: InstanceNode
): Record<string, ComponentPropertyValueLike> | undefined {
  try {
    const { componentProperties: props } = node
    if (!props || typeof props !== 'object') {
      return undefined
    }
    return props as Record<string, ComponentPropertyValueLike>
  } catch {
    return undefined
  }
}

function summarizeComponentProperties(node: InstanceNode): string | undefined {
  const properties = getComponentProperties(node)
  if (!properties) {
    return undefined
  }

  const variants: string[] = []
  const others: string[] = []

  for (const [rawKey, prop] of Object.entries(properties)) {
    if (!prop) continue
    const key = rawKey.split('#')[0]

    switch (prop.type) {
      case 'BOOLEAN':
        others.push(`${key}=${prop.value ? 'on' : 'off'}`)
        break
      case 'TEXT':
        if (typeof prop.value === 'string' && prop.value.trim()) {
          others.push(`${key}=${prop.value}`)
        }
        break
      case 'VARIANT':
        if (typeof prop.value === 'string' && prop.value.trim()) {
          variants.push(`${key}=${prop.value}`)
        }
        break
      case 'INSTANCE_SWAP':
        // Skip instance swap for data-hint
        break
      default:
        break
    }
  }

  const entries = [...variants, ...others]
  return entries.length ? entries.map((e) => `[${e}]`).join('') : undefined
}

function summarizeLayoutHint(node: SceneNode): string | undefined {
  const layoutSource = resolveAutoLayoutSource(node)
  // Explicit auto layout is obvious; only hint when not explicitly set.
  if (layoutSource?.layoutMode && layoutSource.layoutMode !== 'NONE') return undefined
  if (
    'inferredAutoLayout' in node &&
    (node as { inferredAutoLayout?: unknown }).inferredAutoLayout
  ) {
    return 'inferred'
  }
  return 'none'
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
      autoLayout: extractAutoLayout(node),
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
    autoLayout: extractAutoLayout(node),
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

type AutoLayoutLike = {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  itemSpacing?: number
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
}

function extractAutoLayout(node: SceneNode): AutoLayoutSummary | undefined {
  const source = resolveAutoLayoutSource(node)
  if (!source || source.layoutMode === 'NONE') {
    return undefined
  }

  const summary: AutoLayoutSummary = {
    direction: source.layoutMode === 'HORIZONTAL' ? 'row' : 'column'
  }

  if (typeof source.itemSpacing === 'number') {
    summary.gap = source.itemSpacing
  }
  if (source.primaryAxisAlignItems) {
    summary.alignPrimary = source.primaryAxisAlignItems
  }
  if (source.counterAxisAlignItems) {
    summary.alignCounter = source.counterAxisAlignItems
  }
  if (
    typeof source.paddingTop === 'number' ||
    typeof source.paddingRight === 'number' ||
    typeof source.paddingBottom === 'number' ||
    typeof source.paddingLeft === 'number'
  ) {
    summary.padding = {
      top: source.paddingTop ?? 0,
      right: source.paddingRight ?? 0,
      bottom: source.paddingBottom ?? 0,
      left: source.paddingLeft ?? 0
    }
  }

  return summary
}

function resolveAutoLayoutSource(node: SceneNode): AutoLayoutLike | undefined {
  if ('layoutMode' in node && node.layoutMode !== undefined) {
    return node as AutoLayoutLike
  }
  if ('inferredAutoLayout' in node) {
    return (node as { inferredAutoLayout?: AutoLayoutLike | null }).inferredAutoLayout ?? undefined
  }
  return undefined
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
