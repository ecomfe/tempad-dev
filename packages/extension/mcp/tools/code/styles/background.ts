import { resolveBackgroundFillFromPaints, type FigmaLookupReaders } from '@tempad-dev/shared'

import {
  canonicalizeColor,
  formatHexAlpha,
  normalizeFigmaVarName,
  parseBackgroundShorthand,
  preprocessCssValue,
  splitByTopLevelComma,
  stripFallback,
  toFigmaVarExpr
} from '@/utils/css'

import type { GetCodeCacheContext } from '../cache'
import type { StyleMap } from './types'

import { getVariableRawName } from '../../token/indexer'
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
  const solidStyleColor = resolveSolidFillStyle(node, ctx)
  const gradientStyle = resolveGradientFromPaints(activeFillPaints, gradientSize, readers)
  const backgroundFill = resolveBackgroundFillFromPaints(activeFillPaints, gradientSize, readers, {
    resolveGradientPaint: resolveGradientPaintValue,
    resolveSolidPaint: resolveSolidPaintColor
  })
  const backgroundLayers =
    backgroundFill?.kind === 'layers' ? backgroundFill.value.join(', ') : null

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

    if (gradientStyle && isVarOnly(normalized)) {
      processed.background = gradientStyle
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
        processed['background-color'] = solidStyleColor ?? normalized
        delete processed.background
      }
    } else if (BG_URL_LIGHTGRAY_RE.test(bgValue) && activeFillPaints) {
      const parsed = parseBackgroundShorthand(bgValue)

      if (parsed.image) processed['background-image'] = parsed.image
      if (parsed.size) processed['background-size'] = parsed.size
      if (parsed.repeat) processed['background-repeat'] = parsed.repeat
      if (parsed.position) processed['background-position'] = parsed.position

      const solidFill = findVisibleSolidPaint(activeFillPaints)
      if (solidFill?.color) {
        processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
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
    } else if (gradientStyle) {
      processed.background = gradientStyle
    } else if (solidStyleColor) {
      processed['background-color'] = solidStyleColor
    } else {
      const solidFill = findVisibleSolidPaint(activeFillPaints)
      if (solidFill?.color) {
        processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
      }
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

type GradientPaintWithHandles = GradientPaint & {
  gradientHandlePositions: ReadonlyArray<Vector>
}

function hasGradientHandlePositions(paint: GradientPaint): paint is GradientPaintWithHandles {
  return 'gradientHandlePositions' in paint && Array.isArray(paint.gradientHandlePositions)
}

function findVisibleSolidPaint(paints: ReadonlyArray<Paint>): SolidPaint | null {
  const solid = paints.find(
    (paint): paint is SolidPaint => isVisiblePaint(paint) && isSolidPaint(paint)
  )
  return solid ?? null
}

function resolveSolidFillStyle(node: SceneNode, ctx?: GetCodeCacheContext): string | null {
  const styleId = getFillStyleId(node, ctx)
  if (!styleId) return null

  if (ctx) {
    const paint = getPaintStyleCached(styleId, ctx)?.singleVisibleSolidPaint
    return paint ? resolveSolidPaintColor(paint, ctx.readers) : null
  }

  try {
    const style = figma.getStyleById(styleId)
    if (!isPaintStyle(style)) return null

    const visible = style.paints.filter(isVisiblePaint)
    if (visible.length !== 1) return null
    const paint = visible[0]
    return isSolidPaint(paint) ? resolveSolidPaintColor(paint) : null
  } catch {
    return null
  }
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
      if (variable) return toFigmaVarExpr(getVariableRawName(variable))
    } catch {
      // noop
    }
  }

  return formatHexAlpha(paint.color, paint.opacity ?? 1)
}

function resolveGradientFromPaints(
  paints?: PaintList,
  size?: GradientSize,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!paints || !Array.isArray(paints)) return null
  const visible = paints.filter(isVisiblePaint)
  if (visible.length !== 1) return null

  const paint = visible[0]
  if (!isGradientPaint(paint)) return null
  return resolveGradientPaintValue(paint, size, readers)
}

function resolveGradientPaintValue(
  gradientPaint: GradientPaint,
  size?: GradientSize,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  const fillOpacity = typeof gradientPaint.opacity === 'number' ? gradientPaint.opacity : 1
  const stops = gradientPaint.gradientStops.map((stop) => {
    const pct = formatPercent(stop.position)
    const color = formatGradientStopColor(stop, fillOpacity, readers)
    return `${color} ${pct}`
  })

  switch (gradientPaint.type) {
    case 'GRADIENT_LINEAR': {
      const angle = resolveLinearGradientAngle(gradientPaint, size)
      const args = angle == null ? stops : [`${angle}deg`, ...stops]
      return `linear-gradient(${args.join(', ')})`
    }
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_DIAMOND':
      return `radial-gradient(${stops.join(', ')})`
    case 'GRADIENT_ANGULAR':
      return `conic-gradient(${stops.join(', ')})`
    default:
      return null
  }
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
    const expr = variable
      ? toFigmaVarExpr(getVariableRawName(variable))
      : `var(${normalizeFigmaVarName('')})`
    if (alpha >= 0.99) return expr
    const pct = Math.round(alpha * 10000) / 100
    return `color-mix(in srgb, ${expr} ${pct}%, transparent)`
  }

  return formatHexAlpha(stop.color, alpha)
}

function resolveLinearGradientAngle(paint: GradientPaint, size?: GradientSize): number | null {
  if (hasGradientHandlePositions(paint) && paint.gradientHandlePositions.length >= 2) {
    const start = paint.gradientHandlePositions[0]
    const end = paint.gradientHandlePositions[1]
    if (start && end) {
      const gradientSize = normalizeGradientSize(size)
      const dx = (end.x - start.x) * gradientSize.width
      const dy = (end.y - start.y) * gradientSize.height
      const angle = normalizeGradientAngle(dx, dy)
      if (angle != null) return angle
    }
  }

  const extracted = extractLinearGradientVectorFromTransform(paint.gradientTransform, size)
  if (!extracted) return null
  return normalizeGradientAngle(extracted.dx, extracted.dy)
}

function extractLinearGradientVectorFromTransform(
  transform: Transform | null | undefined,
  size?: GradientSize
): { dx: number; dy: number } | null {
  if (!transform || !Array.isArray(transform) || transform.length < 2) return null

  const row0 = transform[0]
  const row1 = transform[1]
  if (!Array.isArray(row0) || !Array.isArray(row1) || row0.length < 2 || row1.length < 2) {
    return null
  }

  const a = row0[0]
  const c = row0[1]
  const e = row0[2] ?? 0
  const b = row1[0]
  const d = row1[1]
  const f = row1[2] ?? 0
  if (![a, b, c, d, e, f].every((value) => Number.isFinite(value))) {
    return null
  }

  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8) {
    return null
  }

  const invA = d / det
  const invC = -c / det
  const invE = (c * f - d * e) / det
  const invB = -b / det
  const invD = a / det
  const invF = (b * e - a * f) / det

  const start = applyTransform(invA, invC, invE, invB, invD, invF, 0, 0.5)
  const end = applyTransform(invA, invC, invE, invB, invD, invF, 1, 0.5)
  const gradientSize = normalizeGradientSize(size)

  return {
    dx: (end.x - start.x) * gradientSize.width,
    dy: (end.y - start.y) * gradientSize.height
  }
}

function applyTransform(
  a: number,
  c: number,
  e: number,
  b: number,
  d: number,
  f: number,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f
  }
}

function normalizeGradientSize(size?: GradientSize): GradientSize {
  const width = size?.width
  const height = size?.height
  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 1
  }
}

function normalizeGradientAngle(dx: number, dy: number): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (dx === 0 && dy === 0) return null

  // Convert from screen-space vector (x right, y down) to CSS angle.
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90
  angle = ((angle % 360) + 360) % 360
  return Math.round(angle * 100) / 100
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
