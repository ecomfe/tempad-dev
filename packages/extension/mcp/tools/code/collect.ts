import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { preprocessCssValue, stripFallback } from '@/utils/css'
import { resolveStylesFromNodeData } from '@/utils/figma-style/style-resolver'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { GetCodeCacheContext } from './cache'
import type { CollectedData, NodeSnapshot, VisibleTree } from './model'

import { hasImageFills, replaceImageUrlsWithAssets } from './assets'
import { getNodeSemanticsCached, getPaintsFromState } from './cache'
import { getLayoutParent } from './layout-parent'
import { preprocessStyles, stripInertShadows } from './styles'
import { REQUESTED_SEGMENT_FIELDS } from './text/types'

export async function collectNodeData(
  tree: VisibleTree,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
  cache: GetCodeCacheContext,
  skipIds?: Set<string>
): Promise<CollectedData> {
  const styles = new Map<string, Record<string, string>>()
  const textSegments = new Map<string, StyledTextSegment[] | null>()

  for (const id of tree.order) {
    if (skipIds?.has(id)) continue
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue
    const node = snapshot.node

    if (node.type === 'TEXT') {
      const segments = collectTextSegments(node)
      textSegments.set(id, segments)
    }

    try {
      let css = await node.getCSSAsync()
      css = await resolveStylesFromNodeData(
        css,
        createNodePaintStyleInput(snapshot, cache),
        cache.readers
      )
      const parent = snapshot.parentId ? tree.nodes.get(snapshot.parentId) : undefined

      let processed = preprocessStyles(preprocessRawStyle(css), node, parent?.node, cache)
      if (parent) {
        processed = applyAutoLayoutAbsolutePosition(processed, snapshot, tree, cache)
        processed = applyConstraintsPosition(processed, snapshot, tree, cache)
      }

      if (hasImageFills(node, cache)) {
        processed = await replaceImageUrlsWithAssets(processed, node, config, assetRegistry)
      }

      stripInertShadows(processed, node, cache)
      styles.set(id, processed)
    } catch (error) {
      logger.warn('Failed to process node styles:', error)
    }
  }

  return { nodes: tree.nodes, styles, textSegments }
}

function preprocessRawStyle(style: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    if (value == null) continue
    let next = preprocessCssValue(String(value))
    next = stripFallback(next)
    out[key] = next
  }
  return out
}

function collectTextSegments(node: TextNode): StyledTextSegment[] | null {
  try {
    if (typeof node.getStyledTextSegments !== 'function') return null
    const segments = node.getStyledTextSegments(REQUESTED_SEGMENT_FIELDS)
    return Array.isArray(segments) ? segments : null
  } catch (error) {
    logger.warn('Failed to read styled text segments:', error)
    return null
  }
}

function applyConstraintsPosition(
  style: Record<string, string>,
  node: NodeSnapshot,
  tree: VisibleTree,
  cache: GetCodeCacheContext
): Record<string, string> {
  if (node.node.type === 'GROUP' || node.node.type === 'BOOLEAN_OPERATION') return style
  const parentSnapshot = getLayoutParent(tree, node)
  if (!parentSnapshot) return style
  const currentSemantics = getNodeSemanticsCached(node.node, cache)
  const parentSemantics = getNodeSemanticsCached(parentSnapshot.node, cache)

  const layoutMode = parentSemantics.layout.layoutMode
  if (layoutMode && layoutMode !== 'NONE') return style
  if (hasInferredLayout(parentSnapshot.node, cache)) return style

  const width = toDecimalPlace(node.bounds.width)
  const height = toDecimalPlace(node.bounds.height)
  const parentWidth = toDecimalPlace(parentSnapshot.bounds.width)
  const parentHeight = toDecimalPlace(parentSnapshot.bounds.height)

  if (!parentWidth || !parentHeight) return style

  const transform = currentSemantics.geometry.relativeTransform
  if (!transform || transform.length < 2 || transform[0].length < 3 || transform[1].length < 3) {
    return style
  }

  const left = toDecimalPlace(transform[0][2])
  const top = toDecimalPlace(transform[1][2])
  const right = toDecimalPlace(parentWidth - width - left)
  const bottom = toDecimalPlace(parentHeight - height - top)

  const constraints = currentSemantics.geometry.constraints
  const result: Record<string, string> = { ...style, position: 'absolute' }

  if (constraints) {
    const h = constraints.horizontal
    switch (h) {
      case 'MIN':
        result.left = `${left}px`
        break
      case 'MAX':
        result.right = `${right}px`
        break
      case 'CENTER': {
        const offset = width / 2 + (parentWidth / 2 - width / 2 - left)
        result.left = `calc(50% - ${toDecimalPlace(offset)}px)`
        break
      }
      case 'STRETCH':
        result.left = `${left}px`
        result.right = `${right}px`
        break
      case 'SCALE':
        result.left = `${toDecimalPlace((left / parentWidth) * 100)}%`
        result.right = `${toDecimalPlace((right / parentWidth) * 100)}%`
        break
      default:
        break
    }

    const v = constraints.vertical
    switch (v) {
      case 'MIN':
        result.top = `${top}px`
        break
      case 'MAX':
        result.bottom = `${bottom}px`
        break
      case 'CENTER': {
        const offset = height / 2 + (parentHeight / 2 - height / 2 - top)
        result.top = `calc(50% - ${toDecimalPlace(offset)}px)`
        break
      }
      case 'STRETCH':
        result.top = `${top}px`
        result.bottom = `${bottom}px`
        break
      case 'SCALE':
        result.top = `${toDecimalPlace((top / parentHeight) * 100)}%`
        result.bottom = `${toDecimalPlace((bottom / parentHeight) * 100)}%`
        break
      default:
        break
    }
  } else {
    // Fallback: no constraints but still have transform/size → pin by left/top.
    result.left = `${left}px`
    result.top = `${top}px`
  }

  // Safety net: if neither side got set, fall back to transform values.
  if (!result.left && !result.right) result.left = `${left}px`
  if (!result.top && !result.bottom) result.top = `${top}px`

  return result
}

function applyAutoLayoutAbsolutePosition(
  style: Record<string, string>,
  node: NodeSnapshot,
  tree: VisibleTree,
  cache: GetCodeCacheContext
): Record<string, string> {
  if (node.node.type === 'GROUP' || node.node.type === 'BOOLEAN_OPERATION') return style
  const parentSnapshot = getLayoutParent(tree, node)
  if (!parentSnapshot) return style
  const currentSemantics = getNodeSemanticsCached(node.node, cache)
  const parentSemantics = getNodeSemanticsCached(parentSnapshot.node, cache)

  const parentLayout = parentSemantics.layout.layoutMode
  const inferredLayout = hasInferredLayout(parentSnapshot.node, cache)
  if ((!parentLayout || parentLayout === 'NONE') && !inferredLayout) return style

  const layoutPositioning = currentSemantics.layout.layoutPositioning
  if (layoutPositioning !== 'ABSOLUTE') return style

  const width = toDecimalPlace(node.bounds.width)
  const height = toDecimalPlace(node.bounds.height)
  const parentWidth = toDecimalPlace(parentSnapshot.bounds.width)
  const parentHeight = toDecimalPlace(parentSnapshot.bounds.height)

  if (!parentWidth || !parentHeight) return style

  const transform = currentSemantics.geometry.relativeTransform
  if (!transform || transform.length < 2 || transform[0].length < 3 || transform[1].length < 3) {
    return style
  }

  const left = toDecimalPlace(transform[0][2])
  const top = toDecimalPlace(transform[1][2])
  const right = toDecimalPlace(parentWidth - width - left)
  const bottom = toDecimalPlace(parentHeight - height - top)

  const result: Record<string, string> = { ...style, position: 'absolute' }

  if (!result.left && !result.right) {
    result.left = `${left}px`
  }
  if (!result.right && result.left === undefined) {
    result.right = `${right}px`
  }

  if (!result.top && !result.bottom) {
    result.top = `${top}px`
  }
  if (!result.bottom && result.top === undefined) {
    result.bottom = `${bottom}px`
  }

  return result
}

function hasInferredLayout(node: SceneNode, cache?: GetCodeCacheContext): boolean {
  const inferred = cache
    ? getNodeSemanticsCached(node, cache).layout.inferredAutoLayout
    : 'inferredAutoLayout' in node
      ? (node as { inferredAutoLayout?: { layoutMode?: string } }).inferredAutoLayout
      : undefined
  return !!inferred?.layoutMode && inferred.layoutMode !== 'NONE'
}

function createNodePaintStyleInput(snapshot: NodeSnapshot, cache: GetCodeCacheContext) {
  const semantics = getNodeSemanticsCached(snapshot.node, cache)
  const width = snapshot.bounds.width
  const height = snapshot.bounds.height

  return {
    fillStyleId: semantics.paint.fillStyleId,
    strokeStyleId: semantics.paint.strokeStyleId,
    fills: getPaintsFromState(semantics.paint.fillsState),
    strokes: getPaintsFromState(semantics.paint.strokesState),
    dimensions:
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : undefined
  }
}
