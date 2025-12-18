import type { AssetDescriptor } from '@tempad-dev/mcp-shared'

import type { SemanticNode } from '@/mcp/semantic-tree'
import type { CodegenConfig } from '@/utils/codegen'

import { toDecimalPlace } from '@/utils/number'

import type { SvgEntry } from './assets'

import { exportSvgEntry, hasImageFills, replaceImageUrlsWithAssets } from './assets'
import { preprocessStyles, stripInertShadows } from './style'

const VECTOR_LIKE_TYPES = new Set<SceneNode['type']>([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON'
])

export type CollectedSceneData = {
  nodes: Map<string, SceneNode>
  styles: Map<string, Record<string, string>>
  svgs: Map<string, SvgEntry>
}

export async function collectSceneData(
  roots: SemanticNode[],
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<CollectedSceneData> {
  const semanticNodes = flattenSemanticNodes(roots)
  const parentById = buildSemanticParentMap(roots)
  const nodes = new Map<string, SceneNode>()
  const styles = new Map<string, Record<string, string>>()
  const svgs = new Map<string, SvgEntry>()
  const skipped = new Set<string>()

  for (const semantic of semanticNodes) {
    if (skipped.has(semantic.id)) continue

    const node = figma.getNodeById(semantic.id) as SceneNode | null
    if (!node || !node.visible) continue

    nodes.set(semantic.id, node)

    const isSemanticVectorOnly = semantic.children.length > 0 && isVectorSubtree(semantic)

    const isVectorOnlyContainer = isVectorContainer(node) || isSemanticVectorOnly

    if (isVectorOnlyContainer && node.width > 0 && node.height > 0) {
      const svgEntry = await exportSvgEntry(node, config, assetRegistry)
      if (svgEntry) {
        svgs.set(semantic.id, svgEntry)
        skipDescendants(semantic, skipped)
        const processed = await collectNodeStyle(node, semantic, parentById, nodes, styles)
        if (processed) {
          styles.set(semantic.id, processed)
        }
      }
      continue
    }

    const shouldExportVector = semantic.assetKind === 'vector' && node.width > 0 && node.height > 0

    if (shouldExportVector) {
      const svgEntry = await exportSvgEntry(node, config, assetRegistry)
      if (svgEntry) {
        svgs.set(semantic.id, svgEntry)
        const processed = await collectNodeStyle(node, semantic, parentById, nodes, styles)
        if (processed) {
          styles.set(semantic.id, processed)
        }
      }
      continue
    }

    try {
      const css = await node.getCSSAsync()

      let processed = preprocessStyles(css, node)

      const parentSemantic = parentById.get(semantic.id)
      if (parentSemantic) {
        const parentNode =
          nodes.get(parentSemantic.id) ?? (figma.getNodeById(parentSemantic.id) as SceneNode | null)
        const parentStyle = parentSemantic ? styles.get(parentSemantic.id) : undefined
        if (parentNode) {
          processed = applyConstraintsPosition(processed, node, parentNode, parentStyle)
        }
      }

      if (hasImageFills(node)) {
        processed = await replaceImageUrlsWithAssets(processed, node, config, assetRegistry)
      }

      stripInertShadows(processed, node)

      styles.set(semantic.id, processed)
    } catch (error) {
      console.warn('[tempad-dev] Failed to process node styles:', error)
    }
  }

  for (const [id, entry] of Array.from(svgs.entries())) {
    const node = nodes.get(id)
    if (!node) {
      svgs.delete(id)
      continue
    }
    if (node.width <= 0 || node.height <= 0) {
      svgs.delete(id)
      continue
    }
    const widthAttr = Number(entry.props?.width ?? 0)
    const heightAttr = Number(entry.props?.height ?? 0)
    if (widthAttr <= 0 || heightAttr <= 0) {
      svgs.delete(id)
    }
  }

  return { nodes, styles, svgs }
}

function isVectorContainer(node: SceneNode): boolean {
  if (!('children' in node)) return false
  const visibleChildren = node.children.filter((child) => child.visible)
  if (!visibleChildren.length) return false
  return visibleChildren.every((child) => VECTOR_LIKE_TYPES.has(child.type))
}

function isVectorSubtree(semantic: SemanticNode): boolean {
  if (!semantic.children.length) return semantic.assetKind === 'vector'
  return semantic.children.every((child) => isVectorSubtree(child))
}

function buildSemanticParentMap(roots: SemanticNode[]): Map<string, SemanticNode | undefined> {
  const map = new Map<string, SemanticNode | undefined>()
  const walk = (node: SemanticNode, parent?: SemanticNode) => {
    map.set(node.id, parent)
    node.children.forEach((child) => walk(child, node))
  }
  roots.forEach((root) => walk(root, undefined))
  return map
}

async function collectNodeStyle(
  node: SceneNode,
  semantic: SemanticNode,
  parentById: Map<string, SemanticNode | undefined>,
  nodes: Map<string, SceneNode>,
  styles: Map<string, Record<string, string>>
): Promise<Record<string, string> | null> {
  try {
    const css = await node.getCSSAsync()
    let processed = preprocessStyles(css, node)

    const parentSemantic = parentById.get(semantic.id)
    if (parentSemantic) {
      const parentNode =
        nodes.get(parentSemantic.id) ?? (figma.getNodeById(parentSemantic.id) as SceneNode | null)
      const parentStyle = parentSemantic ? styles.get(parentSemantic.id) : undefined
      if (parentNode) {
        processed = applyConstraintsPosition(processed, node, parentNode, parentStyle)
      }
    }

    return processed
  } catch (error) {
    console.warn('[tempad-dev] Failed to process node styles:', error)
    return null
  }
}

function applyConstraintsPosition(
  style: Record<string, string>,
  node: SceneNode,
  parent: SceneNode,
  parentStyle?: Record<string, string>
): Record<string, string> {
  const constraints = (node as { constraints?: Constraints }).constraints
  if (!constraints) return style

  const layoutMode = (parent as { layoutMode?: string }).layoutMode
  if (layoutMode && layoutMode !== 'NONE') return style

  const parentDisplay = parentStyle?.display?.toLowerCase()
  if (parentDisplay && (parentDisplay.includes('flex') || parentDisplay.includes('grid'))) {
    return style
  }

  const width = (node as { width?: number }).width ?? 0
  const height = (node as { height?: number }).height ?? 0
  const parentWidth = (parent as { width?: number }).width ?? 0
  const parentHeight = (parent as { height?: number }).height ?? 0

  if (!parentWidth || !parentHeight) return style

  const transform = (node as { relativeTransform?: Transform }).relativeTransform
  if (!transform || transform.length < 2 || transform[0].length < 3 || transform[1].length < 3) {
    return style
  }

  const left = transform[0][2]
  const top = transform[1][2]
  const right = parentWidth - width - left
  const bottom = parentHeight - height - top

  const result: Record<string, string> = { ...style, position: 'absolute' }

  const h = constraints.horizontal
  switch (h) {
    case 'MIN':
      result.left = `${toDecimalPlace(left)}px`
      break
    case 'MAX':
      result.right = `${toDecimalPlace(right)}px`
      break
    case 'CENTER': {
      const offset = width / 2 + (parentWidth / 2 - width / 2 - left)
      result.left = `calc(50% - ${toDecimalPlace(offset)}px)`
      break
    }
    case 'STRETCH':
      result.left = `${toDecimalPlace(left)}px`
      result.right = `${toDecimalPlace(right)}px`
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
      result.top = `${toDecimalPlace(top)}px`
      break
    case 'MAX':
      result.bottom = `${toDecimalPlace(bottom)}px`
      break
    case 'CENTER': {
      const offset = height / 2 + (parentHeight / 2 - height / 2 - top)
      result.top = `calc(50% - ${toDecimalPlace(offset)}px)`
      break
    }
    case 'STRETCH':
      result.top = `${toDecimalPlace(top)}px`
      result.bottom = `${toDecimalPlace(bottom)}px`
      break
    case 'SCALE':
      result.top = `${toDecimalPlace((top / parentHeight) * 100)}%`
      result.bottom = `${toDecimalPlace((bottom / parentHeight) * 100)}%`
      break
    default:
      break
  }

  return result
}

function skipDescendants(semantic: SemanticNode, bucket: Set<string>): void {
  semantic.children.forEach((child) => {
    bucket.add(child.id)
    skipDescendants(child, bucket)
  })
}

function flattenSemanticNodes(nodes: SemanticNode[]): SemanticNode[] {
  const res: SemanticNode[] = []
  const traverse = (n: SemanticNode) => {
    res.push(n)
    n.children.forEach(traverse)
  }
  nodes.forEach(traverse)
  return res
}
