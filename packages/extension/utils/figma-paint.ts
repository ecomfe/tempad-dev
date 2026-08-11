import type { PaintResolutionSize } from './figma-style/types'

export function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  return !!paint && paint.visible !== false
}

export function isRenderablePaint(paint: Paint | null | undefined): paint is Paint {
  if (!isVisiblePaint(paint)) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

export function getPaintResolutionSize(node: SceneNode): PaintResolutionSize | undefined {
  if (!('width' in node) || !('height' in node)) return undefined

  const { width, height } = node
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined
}
