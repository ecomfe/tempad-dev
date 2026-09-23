import type { OutlineNode } from '@tempad-dev/shared'

import { isVisibleMediaPaint } from '@/mcp/media'
import { toPascalCase } from '@/utils/string'

const NODE_CAP = 2048
const NODE_TARGET = 1536

const VECTOR_LIKE_TYPES = new Set<SceneNode['type']>([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON'
])

export function isVectorLikeNode(node: SceneNode): boolean {
  return VECTOR_LIKE_TYPES.has(node.type)
}

function* getVisibleChildren(node: SceneNode): Generator<SceneNode> {
  if (!('children' in node)) return
  for (const child of node.children) {
    if (child.visible) yield child
  }
}

function getSingleVisibleChild(node: SceneNode): SceneNode | undefined {
  if (!('children' in node)) return undefined
  let found: SceneNode | undefined
  for (const child of node.children) {
    if (!child.visible) continue
    if (found) return undefined
    found = child
  }
  return found
}

function getWrapperChild(node: SceneNode): SceneNode | undefined {
  const child = getSingleVisibleChild(node)
  if (
    !child ||
    node.type === 'SECTION' ||
    ('isMask' in node && node.isMask) ||
    hasExplicitOverflow(node) ||
    hasExplicitAutoLayout(node) ||
    hasVisibleSurface(node) ||
    hasPadding(node)
  ) {
    return undefined
  }
  return child
}

export function resolveSemanticTag(node: SceneNode): string {
  if (node.type === 'TEXT') {
    return node.characters.includes('\n') ? 'p' : 'span'
  }

  const assetKind = classifySemanticAsset(node)
  if (assetKind === 'vector') return 'svg'
  if (assetKind === 'image') return 'img'

  return 'div'
}

export function classifySemanticAsset(node: SceneNode): 'vector' | 'image' | undefined {
  if (isVectorLikeNode(node)) return 'vector'

  if (node.type === 'RECTANGLE' && Array.isArray(node.fills)) {
    if (node.fills.some(isVisibleMediaPaint)) return 'image'
  }

  return undefined
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

export function summarizeComponentHint(node: InstanceNode): string | undefined {
  const { mainComponent } = node
  const name =
    mainComponent?.parent?.type === 'COMPONENT_SET'
      ? mainComponent.parent.name
      : (mainComponent?.name ?? node.name)
  return name ? `${toPascalCase(name)}${summarizeComponentProperties(node) ?? ''}` : undefined
}

export function suggestDepthLimit(roots: SceneNode[]): number | undefined {
  let visibleCount = 0
  let targetDepth: number | undefined
  // Level order identifies the target depth before the full physical tree is needed.
  let level: Array<Iterator<SceneNode>> = [roots[Symbol.iterator]()]

  for (let depth = 0; level.length; depth += 1) {
    const nextLevel: Array<Iterator<SceneNode>> = []
    for (const siblings of level) {
      for (let item = siblings.next(); !item.done; item = siblings.next()) {
        const node = item.value
        if (!node.visible) continue
        visibleCount += 1
        if (visibleCount === NODE_TARGET + 1) targetDepth = depth
        if (visibleCount === NODE_CAP + 1) return targetDepth
        if ('children' in node) nextLevel.push(node.children[Symbol.iterator]())
      }
    }
    level = nextLevel
  }
  return undefined
}

export function buildBoundedStructureOutline(
  roots: SceneNode[],
  depthLimit: number | undefined,
  nodeLimit: number
): { roots: OutlineNode[]; physicalNodes: SceneNode[]; observedNodes: number } {
  const effectiveDepthLimit = depthLimit || suggestDepthLimit(roots)
  let observedNodes = 0
  const outlineRoots: OutlineNode[] = []
  const physicalNodes: SceneNode[] = []

  const visitNode = (node: SceneNode, depth: number, siblings: OutlineNode[]): void => {
    if (observedNodes > nodeLimit) return
    if (!node.visible) return

    const capped = effectiveDepthLimit !== undefined && depth >= effectiveDepthLimit
    const wrapperChild = capped ? undefined : getWrapperChild(node)
    if (wrapperChild) {
      visitNode(wrapperChild, depth, siblings)
      return
    }

    observedNodes += 1
    if (observedNodes > nodeLimit) return
    physicalNodes.push(node)
    const outline: OutlineNode = {
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    }
    siblings.push(outline)
    if (capped) return

    const children: OutlineNode[] = []
    for (const child of getVisibleChildren(node)) {
      visitNode(child, depth + 1, children)
      if (observedNodes > nodeLimit) break
    }
    if (children.length) outline.children = children
  }

  for (const root of roots) {
    visitNode(root, 0, outlineRoots)
    if (observedNodes > nodeLimit) break
  }
  return { roots: outlineRoots, physicalNodes, observedNodes }
}
