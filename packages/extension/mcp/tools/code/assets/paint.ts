import { formatHexAlpha } from '@tempad-dev/shared'

import { toFigmaVarExpr } from '@/utils/css'

import { getVariableRawName } from '../../token/raw-name'

export type PaintChannel = {
  key: string
  color: string
}

const PAINT_STYLE_KEYS = {
  fills: 'fillStyleId',
  strokes: 'strokeStyleId'
} as const

export function resolveSolidPaintChannel(paint: SolidPaint): PaintChannel | null {
  const token = resolveVariableColor(paint.boundVariables?.color)
  if (token) {
    return {
      key: `var:${token}`,
      color: token
    }
  }

  if (!paint.color) return null
  const color = formatHexAlpha(paint.color, 1)
  return {
    key: `literal:${color.toLowerCase()}`,
    color
  }
}

export function resolveStylePaintChannel(
  node: SceneNode,
  kind: keyof typeof PAINT_STYLE_KEYS
): PaintChannel | null {
  const styleId = getPaintStyleId(node, kind)
  if (!styleId) return null

  try {
    const style = figma.getStyleById(styleId)
    if (!style || !('paints' in style) || !Array.isArray(style.paints)) return null

    const visible = style.paints.filter(isVisiblePaint)
    if (visible.length !== 1) return null
    const paint = visible[0]
    if (paint.type !== 'SOLID' || !paint.color) return null

    return resolveSolidPaintChannel(paint)
  } catch {
    return null
  }
}

export function hasRenderableStrokes(node: SceneNode): boolean {
  const typed = node as {
    strokeWeight?: number | symbol
    strokeTopWeight?: number | symbol
    strokeRightWeight?: number | symbol
    strokeBottomWeight?: number | symbol
    strokeLeftWeight?: number | symbol
  }

  const uniform = typed.strokeWeight
  if (typeof uniform === 'number') return uniform > 0

  const perSide = [
    typed.strokeTopWeight,
    typed.strokeRightWeight,
    typed.strokeBottomWeight,
    typed.strokeLeftWeight
  ]
  const numeric = perSide.filter((value): value is number => typeof value === 'number')
  if (!numeric.length) return true
  return numeric.some((value) => value > 0)
}

export function hasVisibleEffects(node: SceneNode): boolean {
  if (!('effects' in node)) return false
  const effects = (node as { effects?: unknown }).effects
  if (effects == null) return false
  if (!Array.isArray(effects)) return true

  return effects.some((effect) => {
    if (!effect || typeof effect !== 'object') return false
    return !('visible' in effect) || effect.visible !== false
  })
}

export function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

function getPaintStyleId(node: SceneNode, kind: keyof typeof PAINT_STYLE_KEYS): string | null {
  const key = PAINT_STYLE_KEYS[kind]
  if (!(key in node)) return null
  const styleId = (node as { fillStyleId?: unknown; strokeStyleId?: unknown })[key]
  return typeof styleId === 'string' && styleId.length > 0 ? styleId : null
}

function resolveVariableColor(alias?: { id?: string } | null): string | null {
  if (!alias?.id) return null
  try {
    const variable = figma.variables.getVariableById(alias.id)
    if (!variable) return null
    return toFigmaVarExpr(getVariableRawName(variable))
  } catch {
    return null
  }
}
