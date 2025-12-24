import { toDecimalPlace } from '@/utils/number'

export function applyOverflowStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node || !('overflowDirection' in node)) return style

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

  const parentBounds = getRenderBounds(node)
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
    const bounds = getRenderBounds(child)
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

function getRenderBounds(
  node: SceneNode
): { x: number; y: number; width: number; height: number } | null {
  const renderBounds = (node as { absoluteRenderBounds?: Rect | null }).absoluteRenderBounds
  if (renderBounds) {
    const { x, y, width, height } = renderBounds
    if (isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height)) {
      return {
        x: toDecimalPlace(x),
        y: toDecimalPlace(y),
        width: toDecimalPlace(width),
        height: toDecimalPlace(height)
      }
    }
  }

  if ('width' in node && 'height' in node && 'x' in node && 'y' in node) {
    const { x, y, width, height } = node as LayoutMixin
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof width === 'number' &&
      typeof height === 'number'
    ) {
      return {
        x: toDecimalPlace(x),
        y: toDecimalPlace(y),
        width: toDecimalPlace(width),
        height: toDecimalPlace(height)
      }
    }
  }

  return null
}
