import type { AssetDescriptor } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { preprocessCssValue, stripFallback } from '@/utils/css'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { CollectedData, NodeSnapshot, VisibleTree } from './model'

import { hasImageFills, replaceImageUrlsWithAssets } from './assets'
import { getLayoutParent } from './layout-parent'
import { preprocessStyles, stripInertShadows } from './styles'
import { REQUESTED_SEGMENT_FIELDS } from './text/types'

export async function collectNodeData(
  tree: VisibleTree,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
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
      const css = await node.getCSSAsync()
      const parent = snapshot.parentId ? tree.nodes.get(snapshot.parentId) : undefined

      let processed = preprocessStyles(preprocessRawStyle(css), node, parent?.node)
      if (parent) {
        processed = applyAutoLayoutAbsolutePosition(processed, snapshot, tree)
        processed = applyConstraintsPosition(processed, snapshot, tree)
      }

      if (hasImageFills(node)) {
        processed = await replaceImageUrlsWithAssets(processed, node, config, assetRegistry)
      }

      stripInertShadows(processed, node)
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
  tree: VisibleTree
): Record<string, string> {
  if (node.node.type === 'GROUP' || node.node.type === 'BOOLEAN_OPERATION') return style
  const currentNode = node.node
  const parentSnapshot = getLayoutParent(tree, node)
  if (!parentSnapshot) return style
  const parentNode = parentSnapshot.node

  const layoutMode = 'layoutMode' in parentNode ? parentNode.layoutMode : undefined
  if (layoutMode && layoutMode !== 'NONE') return style
  if (hasInferredLayout(parentNode)) return style

  const rawWidth = 'width' in currentNode ? currentNode.width : 0
  const rawHeight = 'height' in currentNode ? currentNode.height : 0
  const rawParentWidth = 'width' in parentNode ? parentNode.width : 0
  const rawParentHeight = 'height' in parentNode ? parentNode.height : 0
  const width = toDecimalPlace(rawWidth)
  const height = toDecimalPlace(rawHeight)
  const parentWidth = toDecimalPlace(rawParentWidth)
  const parentHeight = toDecimalPlace(rawParentHeight)

  if (!parentWidth || !parentHeight) return style

  const transform = 'relativeTransform' in currentNode ? currentNode.relativeTransform : undefined
  if (!transform || transform.length < 2 || transform[0].length < 3 || transform[1].length < 3) {
    return style
  }

  const left = toDecimalPlace(transform[0][2])
  const top = toDecimalPlace(transform[1][2])
  const right = toDecimalPlace(parentWidth - width - left)
  const bottom = toDecimalPlace(parentHeight - height - top)

  const constraints = 'constraints' in currentNode ? currentNode.constraints : undefined
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
  tree: VisibleTree
): Record<string, string> {
  if (node.node.type === 'GROUP' || node.node.type === 'BOOLEAN_OPERATION') return style
  const currentNode = node.node
  const parentSnapshot = getLayoutParent(tree, node)
  if (!parentSnapshot) return style
  const parentNode = parentSnapshot.node

  const parentLayout = 'layoutMode' in parentNode ? parentNode.layoutMode : undefined
  const inferredLayout = hasInferredLayout(parentNode)
  if ((!parentLayout || parentLayout === 'NONE') && !inferredLayout) return style

  const layoutPositioning =
    'layoutPositioning' in currentNode ? currentNode.layoutPositioning : undefined
  if (layoutPositioning !== 'ABSOLUTE') return style

  const rawWidth = 'width' in currentNode ? currentNode.width : 0
  const rawHeight = 'height' in currentNode ? currentNode.height : 0
  const rawParentWidth = 'width' in parentNode ? parentNode.width : 0
  const rawParentHeight = 'height' in parentNode ? parentNode.height : 0
  const width = toDecimalPlace(rawWidth)
  const height = toDecimalPlace(rawHeight)
  const parentWidth = toDecimalPlace(rawParentWidth)
  const parentHeight = toDecimalPlace(rawParentHeight)

  if (!parentWidth || !parentHeight) return style

  const transform = 'relativeTransform' in currentNode ? currentNode.relativeTransform : undefined
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

function hasInferredLayout(node: SceneNode): boolean {
  if (!('inferredAutoLayout' in node)) return false
  const inferred = (node as { inferredAutoLayout?: { layoutMode?: string } }).inferredAutoLayout
  return !!inferred?.layoutMode && inferred.layoutMode !== 'NONE'
}
