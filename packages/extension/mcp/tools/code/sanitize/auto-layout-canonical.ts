import type { NodeSnapshot, VisibleTree } from '../model'

type StyleMap = Map<string, Record<string, string>>
type Axis = 'x' | 'y'
type AxisState = 'fixed' | 'hug' | 'fill' | 'absolute' | 'unknown'

const FLEX_DISPLAYS = new Set(['flex', 'inline-flex'])
const EPSILON = 0.5
const PX_RE = /^-?\d+(?:\.\d+)?px$/i

export function canonicalizeAutoLayoutStyles(tree: VisibleTree, styles: StyleMap): void {
  for (const id of tree.order) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue

    const style = styles.get(id)
    if (!style || !isAutoLayoutContainer(style)) continue

    const children = snapshot.children
      .map((childId) => tree.nodes.get(childId))
      .filter((child): child is NodeSnapshot => !!child)

    if (children.length !== 1) continue

    const child = children[0]
    const childStyle = styles.get(child.id) ?? {}
    if (isAbsolute(childStyle)) continue

    canonicalizeAxis('x', snapshot, style, child, childStyle)
    canonicalizeAxis('y', snapshot, style, child, childStyle)
  }
}

function canonicalizeAxis(
  axis: Axis,
  snapshot: NodeSnapshot,
  style: Record<string, string>,
  child: NodeSnapshot,
  childStyle: Record<string, string>
): void {
  if (hasUnsupportedAxisValues(style, axis) || hasUnsupportedAxisValues(childStyle, axis, true)) {
    return
  }

  const state = resolveAxisState(axis, snapshot, style, child, childStyle)
  if (state === 'fixed') {
    canonicalizeFixedAxis(axis, snapshot, style, child, childStyle)
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
  childStyle: Record<string, string>
): AxisState {
  if (isAbsolute(childStyle)) return 'absolute'
  if (isFillSizing(child.node, axis)) return 'fill'

  const ownSizing = getSizingMode(snapshot.node, axis)
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
  childStyle: Record<string, string>
): void {
  if (
    !hasExplicitAxisSize(style, axis) ||
    !isCenteredOnAxis(axis, snapshot.node, style, childStyle)
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

function getSizingMode(node: SceneNode, axis: Axis): 'FIXED' | 'HUG' | 'FILL' | undefined {
  const key = axis === 'x' ? 'layoutSizingHorizontal' : 'layoutSizingVertical'
  if (!(key in node)) return undefined
  const value = (node as { layoutSizingHorizontal?: string; layoutSizingVertical?: string })[key]
  if (value === 'FIXED' || value === 'HUG' || value === 'FILL') {
    return value
  }
  return undefined
}

function isFillSizing(node: SceneNode, axis: Axis): boolean {
  return getSizingMode(node, axis) === 'FILL'
}

function hasExplicitAxisSize(style: Record<string, string>, axis: Axis): boolean {
  return parsePxLiteral(style[getSizeKey(axis)]) != null
}

function isCenteredOnAxis(
  axis: Axis,
  node: SceneNode,
  style: Record<string, string>,
  childStyle: Record<string, string>
): boolean {
  const mainAxis = resolveMainAxis(node, style)
  if (mainAxis === axis) {
    return (style['justify-content'] ?? '').trim().toLowerCase() === 'center'
  }

  const alignSelf = (childStyle['align-self'] ?? '').trim().toLowerCase()
  if (alignSelf) return alignSelf === 'center'
  return (style['align-items'] ?? '').trim().toLowerCase() === 'center'
}

function resolveMainAxis(node: SceneNode, style: Record<string, string>): Axis {
  const direction = (style['flex-direction'] ?? '').trim().toLowerCase()
  if (direction === 'column' || direction === 'column-reverse') {
    return 'y'
  }
  if (direction === 'row' || direction === 'row-reverse') {
    return 'x'
  }

  if ('layoutMode' in node) {
    if (node.layoutMode === 'VERTICAL') return 'y'
    if (node.layoutMode === 'HORIZONTAL') return 'x'
  }

  if ('inferredAutoLayout' in node) {
    const inferred = node.inferredAutoLayout
    if (inferred?.layoutMode === 'VERTICAL') return 'y'
  }

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
