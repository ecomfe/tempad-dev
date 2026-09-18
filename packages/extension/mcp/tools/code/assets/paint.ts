import { formatHexAlpha } from '@/utils/css'
import { isRenderablePaint } from '@/utils/figma-paint'
import { getVariableCssExpr } from '@/utils/figma-variables'

import type { GetCodeCacheContext } from '../cache'

import { getNodeSemanticsCached, getPaintStyleCached, getVariableByIdFromContext } from '../cache'

export type PaintChannel = {
  key: string
  color: string
}

const PAINT_STYLE_KEYS = {
  fills: 'fillStyleId',
  strokes: 'strokeStyleId'
} as const

export function resolveSolidPaintChannel(
  paint: SolidPaint,
  ctx?: GetCodeCacheContext
): PaintChannel | null {
  const token = resolveVariableColor(paint.boundVariables?.color, ctx)
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
  kind: keyof typeof PAINT_STYLE_KEYS,
  ctx?: GetCodeCacheContext
): PaintChannel | null {
  const styleId = ctx ? getStyleIdFromSemantics(node, kind, ctx) : getPaintStyleId(node, kind)
  if (!styleId) return null

  if (ctx) {
    const summary = getPaintStyleCached(styleId, ctx)
    if (!summary?.singleVisibleSolidPaint) return null
    return resolveSolidPaintChannel(summary.singleVisibleSolidPaint, ctx)
  }

  try {
    const style = figma.getStyleById(styleId)
    if (!style || !('paints' in style) || !Array.isArray(style.paints)) return null

    const visible = style.paints.filter(isRenderablePaint)
    if (visible.length !== 1) return null
    const [paint] = visible
    if (paint?.type !== 'SOLID') return null

    return resolveSolidPaintChannel(paint)
  } catch {
    return null
  }
}

function getPaintStyleId(node: SceneNode, kind: keyof typeof PAINT_STYLE_KEYS): string | null {
  const key = PAINT_STYLE_KEYS[kind]
  if (!(key in node)) return null
  const styleId = (node as { fillStyleId?: unknown; strokeStyleId?: unknown })[key]
  return typeof styleId === 'string' && styleId.length > 0 ? styleId : null
}

function getStyleIdFromSemantics(
  node: SceneNode,
  kind: keyof typeof PAINT_STYLE_KEYS,
  ctx: GetCodeCacheContext
): string | null {
  const semantics = getNodeSemanticsCached(node, ctx)
  return kind === 'fills' ? semantics.paint.fillStyleId : semantics.paint.strokeStyleId
}

function resolveVariableColor(
  alias?: { id?: string } | null,
  ctx?: GetCodeCacheContext
): string | null {
  if (!alias?.id) return null
  try {
    const variable = ctx
      ? getVariableByIdFromContext(alias.id, ctx)
      : figma.variables.getVariableById(alias.id)
    if (!variable) return null
    return getVariableCssExpr(variable)
  } catch {
    return null
  }
}
