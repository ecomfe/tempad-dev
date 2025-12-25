import { toDecimalPlace } from '@/utils/number'

const VECTOR_LIKE_TYPES = new Set<SceneNode['type']>([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON'
])

export function applyOverflowStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node || !('overflowDirection' in node)) return style
  if (VECTOR_LIKE_TYPES.has(node.type)) return style

  const dir = (node as { overflowDirection?: string }).overflowDirection
  const next = style
  const hasOverflow = (prop: 'overflow' | 'overflow-x' | 'overflow-y') => !!next[prop]
  const overflowInfo = computeChildOverflow(node)

  // Explicit scroll settings take precedence.
  if (dir && dir !== 'NONE') {
    if (dir === 'HORIZONTAL') {
      if (!hasOverflow('overflow-x')) next['overflow-x'] = 'auto'
      if ((node as { clipsContent?: boolean }).clipsContent && overflowInfo.y) {
        if (!hasOverflow('overflow-y')) next['overflow-y'] = 'hidden'
      }
    } else if (dir === 'VERTICAL') {
      if (!hasOverflow('overflow-y')) next['overflow-y'] = 'auto'
      if ((node as { clipsContent?: boolean }).clipsContent && overflowInfo.x) {
        if (!hasOverflow('overflow-x')) next['overflow-x'] = 'hidden'
      }
    } else if (dir === 'BOTH') {
      if (!hasOverflow('overflow')) next.overflow = 'auto'
      // clipsContent is satisfied by scrolling on both axes.
    }
    return next
  }

  // No explicit scroll; only add hidden when clipsContent is on AND children overflow.
  if ((node as { clipsContent?: boolean }).clipsContent && (overflowInfo.x || overflowInfo.y)) {
    if (!hasOverflow('overflow')) next.overflow = 'hidden'
  }

  return next
}

type OverflowInfo = { x: boolean; y: boolean }

function computeChildOverflow(node: SceneNode): OverflowInfo {
  const none = { x: false, y: false }
  if (!('children' in node) || !Array.isArray((node as ChildrenMixin).children)) return none
  const children = (node as SceneNode & ChildrenMixin).children.filter((c) => c.visible)
  if (!children.length) return none

  const parentBounds = getLayoutBounds(node)
  if (!parentBounds) return none
  if (parentBounds.width === 0 || parentBounds.height === 0) return none

  const { x: px, y: py, width: pw, height: ph } = parentBounds
  const tol = 0.5 // guard against minor float noise
  const minX = px - tol
  const minY = py - tol
  const maxX = px + pw + tol
  const maxY = py + ph + tol

  let overflowX = false
  let overflowY = false

  for (const child of children) {
    const bounds = getLayoutBounds(child)
    if (!bounds) continue
    const cx1 = bounds.x
    const cy1 = bounds.y
    const cx2 = bounds.x + bounds.width
    const cy2 = bounds.y + bounds.height
    if (cx1 < minX || cx2 > maxX) overflowX = true
    if (cy1 < minY || cy2 > maxY) overflowY = true
    if (overflowX && overflowY) break
  }

  return { x: overflowX, y: overflowY }
}

function getLayoutBounds(
  node: SceneNode
): { x: number; y: number; width: number; height: number } | null {
  const bbox = (node as { absoluteBoundingBox?: Rect | null }).absoluteBoundingBox
  if (bbox) {
    const { x, y, width, height } = bbox
    if (isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height)) {
      return {
        x: toDecimalPlace(x),
        y: toDecimalPlace(y),
        width: toDecimalPlace(width),
        height: toDecimalPlace(height)
      }
    }
  }

  const transform = (node as { absoluteTransform?: Transform | null }).absoluteTransform
  if (transform && transform.length >= 2) {
    const size =
      'width' in node && 'height' in node ? { width: node.width, height: node.height } : undefined
    if (size) {
      const { width, height } = size
      const points = [
        applyTransform(transform, 0, 0),
        applyTransform(transform, width, 0),
        applyTransform(transform, 0, height),
        applyTransform(transform, width, height)
      ]
      const xs = points.map((p) => p[0])
      const ys = points.map((p) => p[1])
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      return {
        x: toDecimalPlace(minX),
        y: toDecimalPlace(minY),
        width: toDecimalPlace(maxX - minX),
        height: toDecimalPlace(maxY - minY)
      }
    }
  }

  return null
}

function applyTransform(transform: Transform, x: number, y: number): [number, number] {
  const [[a, c, e], [b, d, f]] = transform
  return [a * x + c * y + e, b * x + d * y + f]
}
