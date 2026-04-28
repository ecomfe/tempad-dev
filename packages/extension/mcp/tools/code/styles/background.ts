import type { FigmaLookupReaders } from '@/utils/figma-style/types'

import {
  canonicalizeColor,
  formatHexAlpha,
  normalizeFigmaVarName,
  parseBackgroundShorthand,
  preprocessCssValue,
  splitByTopLevelComma,
  stripFallback
} from '@/utils/css'
import {
  resolveBackgroundFillFromPaints,
  resolveGradientPaintCss
} from '@/utils/figma-style/gradient'
import { getVariableCssExpr } from '@/utils/figma-variables'

import type { GetCodeCacheContext } from '../cache'
import type { StyleMap } from './types'

import { getNodeSemanticsCached, getPaintStyleCached, getPaintsFromState } from '../cache'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i
const GRADIENT_FN_RE = /(linear-gradient|radial-gradient|conic-gradient)\s*\(/i

type PaintList = Paint[] | ReadonlyArray<Paint> | null | undefined
type GradientSize = { width: number; height: number }

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id: string) => figma.getStyleById(id),
  getVariableById: (id: string) => figma.variables.getVariableById(id)
}

export function cleanFigmaSpecificStyles(
  style: StyleMap,
  node?: SceneNode,
  ctx?: GetCodeCacheContext
): StyleMap {
  if (!node) return style

  const processed = style
  const fills = getNodeFills(node, ctx)
  const styleFillPaints = getFillStylePaints(node, ctx)
  const activeFillPaints = styleFillPaints ?? fills
  const gradientSize = getGradientSizeFromNode(node)
  const readers = ctx?.readers ?? DEFAULT_READERS
  const backgroundFill = resolveBackgroundFillFromPaints(activeFillPaints, gradientSize, readers, {
    resolveGradientPaint: resolveGradientPaintValue,
    resolveSolidPaint: resolveSolidPaintColor
  })
  const backgroundLayers =
    backgroundFill?.kind === 'layers' ? backgroundFill.value.join(', ') : null
  const fallbackSolidColor = resolveVisibleSolidPaintColor(activeFillPaints, readers)

  if (processed.background) {
    const bgValue = processed.background
    const normalized = stripFallback(preprocessCssValue(bgValue)).trim()

    const gradient = resolveGradientWithOpacity(normalized, node, ctx)
    if (gradient) {
      processed.background = gradient
      return processed
    }

    if (backgroundLayers && (isVarOnly(normalized) || isSolidBackground(normalized))) {
      processed.background = backgroundLayers
      delete processed['background-color']
      return processed
    }

    if (isSolidBackground(normalized)) {
      if (backgroundFill?.kind === 'color') {
        processed['background-color'] = backgroundFill.value
        delete processed.background
      } else if (backgroundLayers) {
        processed.background = backgroundLayers
        delete processed['background-color']
      } else {
        processed['background-color'] = fallbackSolidColor ?? normalized
        delete processed.background
      }
    } else if (BG_URL_LIGHTGRAY_RE.test(bgValue) && activeFillPaints) {
      const parsed = parseBackgroundShorthand(bgValue)

      if (parsed.image) processed['background-image'] = parsed.image
      if (parsed.size) processed['background-size'] = parsed.size
      if (parsed.repeat) processed['background-repeat'] = parsed.repeat
      if (parsed.position) processed['background-position'] = parsed.position

      if (fallbackSolidColor) {
        processed['background-color'] = fallbackSolidColor
      }

      delete processed.background
    }
  }

  if (
    node.type !== 'TEXT' &&
    !processed.background &&
    !processed['background-color'] &&
    activeFillPaints
  ) {
    if (backgroundLayers) {
      processed.background = backgroundLayers
    } else if (backgroundFill?.kind === 'color') {
      processed['background-color'] = backgroundFill.value
    } else if (fallbackSolidColor) {
      processed['background-color'] = fallbackSolidColor
    }
  }

  return processed
}

function getFillStyleId(node: SceneNode, ctx?: GetCodeCacheContext): string | null {
  if (ctx) return getNodeSemanticsCached(node, ctx).paint.fillStyleId
  if (!('fillStyleId' in node)) return null
  const styleId = node.fillStyleId
  return typeof styleId === 'string' && styleId.length > 0 ? styleId : null
}

function getNodeFills(node: SceneNode, ctx?: GetCodeCacheContext): ReadonlyArray<Paint> | null {
  if (ctx) return getPaintsFromState(getNodeSemanticsCached(node, ctx).paint.fillsState)
  if ('fills' in node && Array.isArray(node.fills)) {
    return node.fills
  }
  return null
}

function getGradientSizeFromNode(node: SceneNode): GradientSize | undefined {
  if (!('width' in node) || !('height' in node)) return undefined

  const width = node.width
  const height = node.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  return { width, height }
}

function isPaintStyle(style: BaseStyle | null): style is PaintStyle {
  return !!style && 'paints' in style && Array.isArray(style.paints)
}

function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  return !!paint && paint.visible !== false
}

function isSolidPaint(paint: Paint): paint is SolidPaint {
  return paint.type === 'SOLID'
}

function isGradientPaint(paint: Paint): paint is GradientPaint {
  return 'gradientStops' in paint && Array.isArray(paint.gradientStops)
}

function isVisibleLinearGradientPaint(paint: Paint): paint is GradientPaint {
  return isVisiblePaint(paint) && paint.type === 'GRADIENT_LINEAR' && isGradientPaint(paint)
}

function findVisibleSolidPaint(paints: ReadonlyArray<Paint>): SolidPaint | null {
  const solid = paints.find(
    (paint): paint is SolidPaint => isVisiblePaint(paint) && isSolidPaint(paint)
  )
  return solid ?? null
}

function getFillStylePaints(
  node: SceneNode,
  ctx?: GetCodeCacheContext
): ReadonlyArray<Paint> | null {
  const styleId = getFillStyleId(node, ctx)
  if (!styleId) return null

  if (ctx) {
    return getPaintStyleCached(styleId, ctx)?.paints ?? null
  }

  try {
    const style = figma.getStyleById(styleId)
    if (!isPaintStyle(style)) return null
    return style.paints
  } catch {
    return null
  }
}

function resolveSolidPaintColor(
  paint: SolidPaint,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!paint.color) return null

  const bound = paint.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    try {
      const variable = readers.getVariableById(bound.id)
      if (variable) return getVariableCssExpr(variable)
    } catch {
      // noop
    }
  }

  return formatHexAlpha(paint.color, paint.opacity ?? 1)
}

function resolveVisibleSolidPaintColor(
  paints: PaintList,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!paints || !Array.isArray(paints)) return null

  const paint = findVisibleSolidPaint(paints)
  return paint ? resolveSolidPaintColor(paint, readers) : null
}

function resolveGradientPaintValue(
  gradientPaint: GradientPaint,
  size?: GradientSize,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  return resolveGradientPaintCss(gradientPaint, size, readers, formatGradientStopColor)
}

function resolveGradientWithOpacity(
  value: string,
  node: SceneNode,
  ctx?: GetCodeCacheContext
): string | null {
  if (!value || !/gradient\(/i.test(value)) return null

  const fills = getNodeFills(node, ctx)
  if (!fills) return null

  const fill = fills.find(isVisibleLinearGradientPaint)
  if (!fill) return null

  const fillOpacity = typeof fill.opacity === 'number' ? fill.opacity : 1
  const hasStopAlpha = fill.gradientStops.some((stop) => (stop.color?.a ?? 1) < 1)
  if (fillOpacity >= 0.99 && !hasStopAlpha) return null

  const parsed = parseGradient(value)
  if (!parsed) return null

  const angle = parsed.args[0]?.trim()
  const hasAngle =
    !!angle &&
    (angle.endsWith('deg') ||
      angle.endsWith('rad') ||
      angle.endsWith('turn') ||
      angle.startsWith('to '))
  const stops = fill.gradientStops.map((stop) => {
    const pct = formatPercent(stop.position)
    const color = formatGradientStopColor(stop, fillOpacity, ctx?.readers ?? DEFAULT_READERS)
    return `${color} ${pct}`
  })

  const args = hasAngle ? [angle, ...stops] : stops
  return `${parsed.fn}(${args.join(', ')})`
}

function parseGradient(value: string): { fn: string; args: string[] } | null {
  const match = value.match(GRADIENT_FN_RE)
  if (!match || match.index == null) return null

  const fn = match[1]
  const start = value.indexOf('(', match.index)
  if (start < 0) return null

  let depth = 0
  let end = -1
  for (let i = start; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null

  const inner = value.slice(start + 1, end)
  return { fn, args: splitByTopLevelComma(inner) }
}

function formatPercent(pos: number): string {
  const pct = Math.round(pos * 10000) / 100
  return `${pct}%`
}

function formatGradientStopColor(
  stop: ColorStop,
  fillOpacity: number,
  readers: FigmaLookupReaders
): string {
  const baseAlpha = stop.color?.a ?? 1
  const alpha = Math.max(0, Math.min(1, baseAlpha * fillOpacity))

  const bound = stop.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    const variable = readers.getVariableById(bound.id)
    const expr = variable ? getVariableCssExpr(variable) : `var(${normalizeFigmaVarName('')})`
    if (alpha >= 0.99) return expr
    const pct = Math.round(alpha * 10000) / 100
    return `color-mix(in srgb, ${expr} ${pct}%, transparent)`
  }

  return formatHexAlpha(stop.color, alpha)
}

function isSolidBackground(value: string): boolean {
  if (!value) return false

  const trimmed = value.trim()
  if (!trimmed) return false
  if (/var\(\s*--[A-Za-z0-9_-]+\s*\)/i.test(trimmed)) return true
  return canonicalizeColor(trimmed.toLowerCase()) !== null
}

function isVarOnly(value: string): boolean {
  if (!value) return false
  return /^var\(\s*--[A-Za-z0-9_-]+\s*\)$/i.test(value.trim())
}
