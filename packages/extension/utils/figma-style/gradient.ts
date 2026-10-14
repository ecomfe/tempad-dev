/**
 * Gradient and color utilities for Figma styles
 */

import { getCssPaintLayers, isVisiblePaint } from '@/utils/figma-paint'
import { getVariableCssName } from '@/utils/figma-variables'

import type { FigmaLookupReaders, PaintList, PaintResolutionSize } from './types'

import { formatHexAlpha, splitByTopLevelComma } from '../css'

type ResolvedBackgroundFill = { kind: 'color'; value: string } | { kind: 'layers'; value: string[] }

type BackgroundFillResolverOptions = {
  background?: string
  resolveGradientPaint?: (
    paint: GradientPaint,
    size: GradientSize | undefined,
    readers: FigmaLookupReaders
  ) => string | null
  resolveSolidPaint?: (
    paint: SolidPaint,
    readers: FigmaLookupReaders,
    index: number
  ) => string | null
}

function isGradientPaint(paint: Paint): paint is GradientPaint {
  return 'gradientStops' in paint && Array.isArray(paint.gradientStops)
}

function isSolidPaint(paint: Paint): paint is SolidPaint {
  return paint.type === 'SOLID'
}

type GradientPaintWithHandles = GradientPaint & {
  gradientHandlePositions: ReadonlyArray<Vector>
}

type GradientSize = PaintResolutionSize

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id) => figma.getStyleById(id),
  getVariableById: (id) => figma.variables.getVariableById(id)
}

type GradientStopColorFormatter = (
  stop: ColorStop,
  fillOpacity: number,
  readers: FigmaLookupReaders
) => string

function hasGradientHandlePositions(paint: GradientPaint): paint is GradientPaintWithHandles {
  return 'gradientHandlePositions' in paint && Array.isArray(paint.gradientHandlePositions)
}

/**
 * Resolves gradient from paint array
 * Returns CSS gradient string or null
 */
export function resolveGradientFromPaints(
  paints?: PaintList,
  size?: GradientSize,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!paints || !Array.isArray(paints)) return null

  // Find the first visible gradient paint
  const gradientPaint = paints.find(
    (paint): paint is GradientPaint => isVisiblePaint(paint) && isGradientPaint(paint)
  )

  if (!gradientPaint) return null

  return resolveGradientPaintCss(gradientPaint, size, readers)
}

export function resolveGradientPaintCss(
  gradientPaint: GradientPaint,
  size?: GradientSize,
  readers: FigmaLookupReaders = DEFAULT_READERS,
  formatStopColor: GradientStopColorFormatter = formatGradientStopColor
): string | null {
  const fillOpacity = typeof gradientPaint.opacity === 'number' ? gradientPaint.opacity : 1
  const stops = gradientPaint.gradientStops.map((stop) => {
    const pct = formatPercent(stop.position)
    const color = formatStopColor(stop, fillOpacity, readers)
    return `${color} ${pct}`
  })

  switch (gradientPaint.type) {
    case 'GRADIENT_LINEAR': {
      const angle = resolveLinearGradientAngle(gradientPaint, size)
      const args = angle == null ? stops : [`${angle}deg`, ...stops]
      return `linear-gradient(${args.join(', ')})`
    }
    case 'GRADIENT_RADIAL': {
      const geometry = resolveRadialGradientGeometry(gradientPaint)
      const args = geometry ? [geometry, ...stops] : stops
      return `radial-gradient(${args.join(', ')})`
    }
    case 'GRADIENT_DIAMOND':
      return `radial-gradient(${stops.join(', ')})`
    case 'GRADIENT_ANGULAR':
      return `conic-gradient(${stops.join(', ')})`
    default:
      return null
  }
}

/**
 * Resolves solid color from paint array
 * Returns hex color string or null
 */
export function resolveSolidFromPaints(
  paints?: PaintList,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!paints || !Array.isArray(paints)) return null

  // Find the first visible solid paint
  const solidPaint = paints.find(
    (paint): paint is SolidPaint => isVisiblePaint(paint) && isSolidPaint(paint)
  )

  return solidPaint ? resolveSolidPaint(solidPaint, readers) : null
}

function resolveSolidPaint(
  solidPaint: SolidPaint,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!solidPaint.color) return null

  // Check if color is bound to a variable
  const bound = solidPaint.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    try {
      const variable = readers.getVariableById(bound.id)
      if (variable) {
        const fallback = formatHexAlpha(solidPaint.color, solidPaint.opacity)
        const cssVarName = getVariableCssName(variable)
        return `var(${cssVarName}, ${fallback})`
      }
    } catch {
      // Fallback to color value
    }
  }

  return formatHexAlpha(solidPaint.color, solidPaint.opacity)
}

export function resolveBackgroundFillFromPaints(
  paints?: PaintList,
  size?: GradientSize,
  readers: FigmaLookupReaders = DEFAULT_READERS,
  options: BackgroundFillResolverOptions = {}
): ResolvedBackgroundFill | null {
  if (!paints || !Array.isArray(paints)) return null

  const visible = getCssPaintLayers(paints)
  if (!visible.length) return null
  if (visible.some(({ paint }) => !isSolidPaint(paint) && !isGradientPaint(paint))) {
    return null
  }

  const resolveGradient = options.resolveGradientPaint ?? resolveGradientPaintCss
  const resolveSolid = options.resolveSolidPaint ?? resolveSolidPaint
  const sourceLayers = splitByTopLevelComma(options.background ?? '')

  if (visible.length === 1) {
    const { paint, index } = visible[0]!
    if (isSolidPaint(paint)) {
      const color = resolveSolid(paint, readers, index)
      return color ? { kind: 'color', value: color } : null
    }
  }

  const layers: string[] = []
  for (const [layerIndex, { paint, index }] of visible.entries()) {
    if (isSolidPaint(paint)) {
      const color = resolveSolid(paint, readers, index)
      if (!color) return null
      layers.push(`linear-gradient(${color}, ${color})`)
      continue
    }
    if (!isGradientPaint(paint)) return null

    let gradient = resolveGradient(paint, size, readers)
    if (!gradient) return null
    if (paint.type === 'GRADIENT_RADIAL' && sourceLayers.length === visible.length) {
      gradient = preserveRadialGeometry(sourceLayers[layerIndex]!, gradient)
    }
    layers.push(gradient)
  }

  return { kind: 'layers', value: layers }
}

function preserveRadialGeometry(source: string, resolved: string): string {
  const match = source.match(/^radial-gradient\(([\s\S]*)\)$/i)
  if (!match) return resolved
  const geometry = splitByTopLevelComma(match[1]!)[0]
  if (!geometry || !isRadialGeometry(geometry)) return resolved
  const args = splitByTopLevelComma(resolved.slice('radial-gradient('.length, -1))
  if (args[0] && isRadialGeometry(args[0])) args.shift()
  return `radial-gradient(${[geometry, ...args].join(', ')})`
}

function isRadialGeometry(value: string): boolean {
  return (
    /^(?:circle\b|ellipse\b|(?:closest|farthest)-(?:side|corner)\b|at\s|calc\(|[+-]?(?:\d*\.)?\d+(?:%|[a-z]+)(?:\s|$))/i.test(
      value
    ) || /\s+at\s+/i.test(value)
  )
}

function resolveRadialGradientGeometry(paint: GradientPaint): string | null {
  let center: Vector
  let u: Vector
  let v: Vector
  if (hasGradientHandlePositions(paint) && paint.gradientHandlePositions.length >= 3) {
    const [start, end, width] = paint.gradientHandlePositions
    if (!start || !end || !width) return null
    center = start
    u = { x: end.x - start.x, y: end.y - start.y }
    v = { x: width.x - start.x, y: width.y - start.y }
  } else {
    const inverse = invertGradientTransform(paint.gradientTransform)
    if (!inverse) return null
    const [[a, c, e], [b, d, f]] = inverse
    // Figma's canonical radial gradient is a circle centered at (0.5, 0.5).
    center = applyTransform(a, c, e, b, d, f, 0.5, 0.5)
    u = { x: a / 2, y: b / 2 }
    v = { x: c / 2, y: d / 2 }
  }
  const rx = Math.hypot(u.x, v.x)
  const ry = Math.hypot(u.y, v.y)
  if (![center.x, center.y, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return null
  // CSS radial gradients cannot rotate an ellipse. Preserve native CSS geometry
  // when supplied, but do not invent an axis-aligned ellipse for a skewed one.
  if (Math.abs(u.x * u.y + v.x * v.y) > 1e-8 * rx * ry) return null
  return `${formatPercent(rx)} ${formatPercent(ry)} at ${formatPercent(center.x)} ${formatPercent(center.y)}`
}

/**
 * Formats a gradient stop color
 */
export function formatGradientStopColor(
  stop: ColorStop,
  fillOpacity: number,
  readers: FigmaLookupReaders
): string {
  const baseAlpha = stop.color?.a ?? 1
  const alpha = Math.max(0, Math.min(1, baseAlpha * fillOpacity))

  // Check if color is bound to a variable
  const bound = stop.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    try {
      const v = readers.getVariableById(bound.id)
      if (v) {
        const fallbackOpaque = formatHexAlpha(stop.color, 1)
        const fallbackAlpha = formatHexAlpha(stop.color, alpha)
        const cssVarName = getVariableCssName(v)
        const varName = `var(${cssVarName}, ${fallbackOpaque})`
        if (alpha >= 0.99) return `var(${cssVarName}, ${fallbackAlpha})`
        // Use color-mix for transparency
        const pct = Math.round(alpha * 10000) / 100
        return `color-mix(in srgb, ${varName} ${pct}%, transparent)`
      }
    } catch {
      // Fallback to color value
    }
  }

  return formatHexAlpha(stop.color, alpha)
}

/**
 * Resolves linear gradient angle from gradient paint
 */
function resolveLinearGradientAngle(paint: GradientPaint, size?: GradientSize): number | null {
  // First try gradient handle positions (more accurate)
  if (hasGradientHandlePositions(paint) && paint.gradientHandlePositions.length >= 2) {
    const start = paint.gradientHandlePositions[0]
    const end = paint.gradientHandlePositions[1]
    if (start && end) {
      const { width, height } = getGradientSize(size)
      const dx = (end.x - start.x) * width
      const dy = (end.y - start.y) * height
      const angle = normalizeGradientAngle(dx, dy)
      if (angle != null) return angle
    }
  }

  // Fallback to gradient transform
  const extracted = extractLinearGradientVectorFromTransform(paint.gradientTransform, size)
  if (!extracted) return null
  const { dx, dy } = extracted
  return normalizeGradientAngle(dx, dy)
}

function extractLinearGradientVectorFromTransform(
  transform: Transform | null | undefined,
  size?: GradientSize
): { dx: number; dy: number } | null {
  const inverse = invertGradientTransform(transform)
  if (!inverse) return null
  const [[a, c, e], [b, d, f]] = inverse
  const start = applyTransform(a, c, e, b, d, f, 0, 0.5)
  const end = applyTransform(a, c, e, b, d, f, 1, 0.5)
  const { width, height } = getGradientSize(size)
  return { dx: (end.x - start.x) * width, dy: (end.y - start.y) * height }
}

function invertGradientTransform(transform: Transform | null | undefined): Transform | null {
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

  return [
    [invA, invC, invE],
    [invB, invD, invF]
  ]
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

function getGradientSize(size?: GradientSize): GradientSize {
  const width = size?.width
  const height = size?.height

  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 1
  }
}

/**
 * Normalizes gradient angle to degrees
 */
function normalizeGradientAngle(dx: number, dy: number): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (dx === 0 && dy === 0) return null

  // Convert from screen-space vector (x right, y down) to CSS angle.
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90
  angle = ((angle % 360) + 360) % 360
  return Math.round(angle * 100) / 100
}

/**
 * Formats position as percentage
 */
function formatPercent(pos: number): string {
  const pct = Math.round(pos * 10000) / 100
  return `${pct}%`
}
