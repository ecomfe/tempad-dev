import type { GetCodeCacheContext } from '../cache'
import type { NodeSnapshot, VisibleTree } from '../model'

import { getNodeSemanticsCached } from '../cache'

type StyleMap = Map<string, Record<string, string>>
type Axis = 'x' | 'y'
type AxisState = 'fixed' | 'hug' | 'fill' | 'absolute' | 'unknown'

const FLEX_DISPLAYS = new Set(['flex', 'inline-flex'])
const EPSILON = 0.5
const PX_RE = /^-?\d+(?:\.\d+)?px$/i

export function canonicalizeAutoLayoutStyles(
  tree: VisibleTree,
  styles: StyleMap,
  _svgRoots?: Set<string>,
  ctx?: GetCodeCacheContext
): void {
  for (const id of tree.order) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue

    const style = styles.get(id)
    if (!style || !isAutoLayoutContainer(style)) continue
    if (snapshot.children.length !== 1) continue

    const child = tree.nodes.get(snapshot.children[0]!)
    if (!child) continue
    const childStyle = styles.get(child.id) ?? {}
    if (isAbsolute(childStyle)) continue

    canonicalizeAxis('x', snapshot, style, child, childStyle, ctx)
    canonicalizeAxis('y', snapshot, style, child, childStyle, ctx)
  }
}

function canonicalizeAxis(
  axis: Axis,
  snapshot: NodeSnapshot,
  style: Record<string, string>,
  child: NodeSnapshot,
  childStyle: Record<string, string>,
  ctx?: GetCodeCacheContext
): void {
  if (hasUnsupportedAxisValues(style, axis) || hasUnsupportedAxisValues(childStyle, axis, true)) {
    return
  }

  const state = resolveAxisState(axis, snapshot, style, child, childStyle, ctx)
  if (state === 'fixed') {
    canonicalizeFixedAxis(axis, snapshot, style, child, childStyle, ctx)
    return
  }
  if (state === 'hug') {
    canonicalizeHugAxis(axis, snapshot, style, child)
  }
}

function resolveAxisState(
  axis: Axis,
  snapshot: NodeSnapshot,
  style: Record<string, string>,
  child: NodeSnapshot,
  childStyle: Record<string, string>,
  ctx?: GetCodeCacheContext
): AxisState {
  if (isAbsolute(childStyle)) return 'absolute'
  if (isFillSizing(child.node, axis, ctx)) return 'fill'

  const ownSizing = getSizingMode(snapshot.node, axis, ctx)
  if (ownSizing === 'FILL') return 'fill'
  if (ownSizing === 'HUG') return 'hug'
  if (ownSizing === 'FIXED') return 'fixed'

  return hasExplicitAxisSize(style, axis) ? 'fixed' : 'unknown'
}

function canonicalizeFixedAxis(
  axis: Axis,
  snapshot: NodeSnapshot,
  style: Record<string, string>,
  child: NodeSnapshot,
  childStyle: Record<string, string>,
  ctx?: GetCodeCacheContext
): void {
  if (
    !hasExplicitAxisSize(style, axis) ||
    !isCenteredOnAxis(axis, snapshot.node, style, childStyle, ctx)
  ) {
    return
  }

  const size = getAxisSize(snapshot.bounds, axis)
  const childSize = getAxisSize(child.bounds, axis)
  const slack = size - childSize
  if (!(slack > EPSILON)) return

  const [startKey, endKey] = getPaddingKeys(axis)
  const start = parsePxOrZero(style[startKey])
  const end = parsePxOrZero(style[endKey])
  if (start == null || end == null) return

  if (!approxEqual(start, slack / 2) || !approxEqual(end, slack / 2)) {
    return
  }

  delete style[startKey]
  delete style[endKey]
}

function canonicalizeHugAxis(
  axis: Axis,
  snapshot: NodeSnapshot,
  style: Record<string, string>,
  child: NodeSnapshot
): void {
  const sizeKey = getSizeKey(axis)
  const explicitSize = style[sizeKey]
  if (!explicitSize || parsePxLiteral(explicitSize) == null) return

  const [startKey, endKey] = getPaddingKeys(axis)
  const start = parsePxOrZero(style[startKey])
  const end = parsePxOrZero(style[endKey])
  if (start == null || end == null) return

  const expected = getAxisSize(child.bounds, axis) + start + end
  if (!approxEqual(getAxisSize(snapshot.bounds, axis), expected)) return

  delete style[sizeKey]
}

function isAutoLayoutContainer(style: Record<string, string>): boolean {
  return FLEX_DISPLAYS.has((style.display ?? '').trim().toLowerCase())
}

function hasUnsupportedAxisValues(
  style: Record<string, string>,
  axis: Axis,
  isChild = false
): boolean {
  const sizeKey = getSizeKey(axis)
  const minKey = axis === 'x' ? 'min-width' : 'min-height'
  const maxKey = axis === 'x' ? 'max-width' : 'max-height'
  const [startKey, endKey] = getPaddingKeys(axis)
  const keys = isChild ? [sizeKey, minKey, maxKey] : [sizeKey, minKey, maxKey, startKey, endKey]

  return keys.some((key) => isUnsupportedValue(style[key]))
}

function isUnsupportedValue(value?: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('%')) return true
  if (/var\(|calc\(/i.test(trimmed)) return true
  if (PX_RE.test(trimmed)) return false
  return keyLikeLength(trimmed)
}

function keyLikeLength(value: string): boolean {
  return /(?:^|[^a-z])(min|max|fit-content|auto|stretch)(?:$|[^a-z])/i.test(value)
}

function getSizingMode(
  node: SceneNode,
  axis: Axis,
  ctx?: GetCodeCacheContext
): 'FIXED' | 'HUG' | 'FILL' | undefined {
  const semantics = ctx ? getNodeSemanticsCached(node, ctx) : null
  const value =
    axis === 'x'
      ? (semantics?.layout.layoutSizingHorizontal ??
        ('layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : undefined))
      : (semantics?.layout.layoutSizingVertical ??
        ('layoutSizingVertical' in node ? node.layoutSizingVertical : undefined))
  if (value === 'FIXED' || value === 'HUG' || value === 'FILL') {
    return value
  }
  return undefined
}

function isFillSizing(node: SceneNode, axis: Axis, ctx?: GetCodeCacheContext): boolean {
  return getSizingMode(node, axis, ctx) === 'FILL'
}

function hasExplicitAxisSize(style: Record<string, string>, axis: Axis): boolean {
  return parsePxLiteral(style[getSizeKey(axis)]) != null
}

function isCenteredOnAxis(
  axis: Axis,
  node: SceneNode,
  style: Record<string, string>,
  childStyle: Record<string, string>,
  ctx?: GetCodeCacheContext
): boolean {
  const mainAxis = resolveMainAxis(node, style, ctx)
  if (mainAxis === axis) {
    return (style['justify-content'] ?? '').trim().toLowerCase() === 'center'
  }

  const alignSelf = (childStyle['align-self'] ?? '').trim().toLowerCase()
  if (alignSelf) return alignSelf === 'center'
  return (style['align-items'] ?? '').trim().toLowerCase() === 'center'
}

function resolveMainAxis(
  node: SceneNode,
  style: Record<string, string>,
  ctx?: GetCodeCacheContext
): Axis {
  const direction = (style['flex-direction'] ?? '').trim().toLowerCase()
  if (direction === 'column' || direction === 'column-reverse') {
    return 'y'
  }
  if (direction === 'row' || direction === 'row-reverse') {
    return 'x'
  }

  const semantics = ctx ? getNodeSemanticsCached(node, ctx) : null
  const layoutMode =
    semantics?.layout.layoutMode ?? ('layoutMode' in node ? node.layoutMode : undefined)
  if (layoutMode === 'VERTICAL') return 'y'
  if (layoutMode === 'HORIZONTAL') return 'x'

  const inferred =
    semantics?.layout.inferredAutoLayout ??
    ('inferredAutoLayout' in node ? node.inferredAutoLayout : undefined)
  if (inferred?.layoutMode === 'VERTICAL') return 'y'
  if (inferred?.layoutMode === 'HORIZONTAL') return 'x'

  return 'x'
}

function getPaddingKeys(axis: Axis): [string, string] {
  return axis === 'x' ? ['padding-left', 'padding-right'] : ['padding-top', 'padding-bottom']
}

function getSizeKey(axis: Axis): 'width' | 'height' {
  return axis === 'x' ? 'width' : 'height'
}

function getAxisSize(bounds: NodeSnapshot['bounds'], axis: Axis): number {
  return axis === 'x' ? bounds.width : bounds.height
}

function parsePxOrZero(value?: string): number | null {
  if (!value || !value.trim()) return 0
  return parsePxLiteral(value)
}

function parsePxLiteral(value?: string): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!PX_RE.test(trimmed)) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function isAbsolute(style?: Record<string, string>): boolean {
  return (style?.position ?? '').trim().toLowerCase() === 'absolute'
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON
}
