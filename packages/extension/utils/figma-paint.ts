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

/** Native fills are back-to-front; CSS background layers are front-to-back. */
export function getCssPaintLayers(paints: readonly Paint[]): { paint: Paint; index: number }[] {
  return paints
    .map((paint, index) => ({ paint, index }))
    .filter(({ paint }) => isRenderablePaint(paint))
    .reverse()
}

/** CSS background-color sits below every image layer, so only the bottom paint can supply it. */
export function getBackgroundColorPaint(
  paints: readonly Paint[]
): { paint: SolidPaint; index: number } | null {
  const index = paints.findIndex(isRenderablePaint)
  const paint = paints[index]
  if (
    !paint ||
    paint.type !== 'SOLID' ||
    !paint.color ||
    (paint.opacity ?? 1) !== 1 ||
    (paint.blendMode !== undefined && paint.blendMode !== 'NORMAL')
  ) {
    return null
  }
  return { paint, index }
}

export function getPaintResolutionSize(node: SceneNode): PaintResolutionSize | undefined {
  if (!('width' in node) || !('height' in node)) return undefined

  const { width, height } = node
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined
}
