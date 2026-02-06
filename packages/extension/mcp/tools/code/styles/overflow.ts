import { toDecimalPlace } from '@/utils/number'

import type { LayoutBounds, OverflowDirection, StyleMap } from './types'

const VECTOR_LIKE_TYPES = new Set<SceneNode['type']>([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON'
])

export function applyOverflowStyles(style: StyleMap, node?: SceneNode): StyleMap {
  if (!node || !('overflowDirection' in node)) return style
  if (VECTOR_LIKE_TYPES.has(node.type)) return style

  const dir = getOverflowDirection(node)
  const next = style
  const hasOverflow = (prop: 'overflow' | 'overflow-x' | 'overflow-y') => !!next[prop]
  const overflowInfo = computeChildOverflow(node)

  // Explicit scroll settings take precedence.
  if (dir && dir !== 'NONE') {
    if (dir === 'HORIZONTAL') {
      if (!hasOverflow('overflow-x')) next['overflow-x'] = 'auto'
      if (hasClipsContent(node) && overflowInfo.y) {
        if (!hasOverflow('overflow-y')) next['overflow-y'] = 'hidden'
      }
    } else if (dir === 'VERTICAL') {
      if (!hasOverflow('overflow-y')) next['overflow-y'] = 'auto'
      if (hasClipsContent(node) && overflowInfo.x) {
        if (!hasOverflow('overflow-x')) next['overflow-x'] = 'hidden'
      }
    } else if (dir === 'BOTH') {
      if (!hasOverflow('overflow')) next.overflow = 'auto'
      // clipsContent is satisfied by scrolling on both axes.
    }
    return next
  }

  // No explicit scroll; only add hidden when clipsContent is on AND children overflow.
  if (hasClipsContent(node) && (overflowInfo.x || overflowInfo.y)) {
    if (!hasOverflow('overflow')) next.overflow = 'hidden'
  }

  return next
}

type OverflowInfo = { x: boolean; y: boolean }

function computeChildOverflow(node: SceneNode): OverflowInfo {
  const none = { x: false, y: false }
  if (!('children' in node) || !Array.isArray(node.children)) return none
  const children = node.children.filter((child) => child.visible)
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

function getLayoutBounds(node: SceneNode): LayoutBounds | null {
  const bbox = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null
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

  const transform = 'absoluteTransform' in node ? node.absoluteTransform : null
  if (transform && transform.length >= 2) {
    if ('width' in node && 'height' in node) {
      const width = node.width
      const height = node.height
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

function getOverflowDirection(node: SceneNode): OverflowDirection | undefined {
  if (!('overflowDirection' in node)) return undefined
  const direction = node.overflowDirection
  if (
    direction === 'NONE' ||
    direction === 'HORIZONTAL' ||
    direction === 'VERTICAL' ||
    direction === 'BOTH'
  ) {
    return direction
  }
  return undefined
}

function hasClipsContent(node: SceneNode): boolean {
  return 'clipsContent' in node && node.clipsContent === true
}

function applyTransform(transform: Transform, x: number, y: number): [number, number] {
  const [[a, c, e], [b, d, f]] = transform
  return [a * x + c * y + e, b * x + d * y + f]
}
