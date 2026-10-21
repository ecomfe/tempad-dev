/**
 * Gradient and color utilities for Figma styles
 */

import { getCssPaintLayers } from '@/utils/figma-paint'
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

  const paint = getCssPaintLayers(paints)[0]?.paint
  if (!paint || !isGradientPaint(paint)) return null

  return resolveGradientPaintCss(paint, size, readers)
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

  const paint = getCssPaintLayers(paints)[0]?.paint
  return paint && isSolidPaint(paint) ? resolveSolidPaint(paint, readers) : null
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
  const background = options.background ?? ''
  const sourceLayers = matchBackgroundPaintLayers(background, paints)

  if (visible.length === 1) {
    const { paint, index } = visible[0]!
    if (isSolidPaint(paint)) {
      const color = resolveSolid(paint, readers, index)
      return color ? { kind: 'color', value: color } : null
    }
  }
  if (
    !sourceLayers &&
    visible.some(({ paint }) => paint.type === 'GRADIENT_DIAMOND') &&
    /(?:linear|radial|conic)-gradient\s*\(/i.test(background)
  ) {
    // A radial fallback cannot preserve an unrecognized native diamond stack.
    return { kind: 'layers', value: splitByTopLevelComma(background) }
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

    const resolved = resolveGradient(paint, size, readers)
    if (!resolved) return null
    const sources = sourceLayers?.[layerIndex]
    const gradient = sources?.every((source) =>
      /^(?:linear|radial|conic)-gradient\s*\(/i.test(source)
    )
      ? sources
          .map((source) => preserveGradientGeometry(source, resolved, paint.type) ?? source)
          .join(', ')
      : resolved
    layers.push(gradient)
  }

  return { kind: 'layers', value: layers }
}

/** Pair complete native CSS stacks with their paints, including Figma's diamond quadrants. */
export function matchBackgroundPaintLayers(
  background: string,
  paints: ReadonlyArray<Paint>
): string[][] | null {
  const layers = splitByTopLevelComma(background)
  const groups: string[][] = []
  let offset = 0
  for (const { paint } of getCssPaintLayers(paints)) {
    const diamond =
      paint.type === 'GRADIENT_DIAMOND' && /^linear-gradient\s*\(/i.test(layers[offset] ?? '')
    const count = diamond ? 4 : 1
    const group = layers.slice(offset, offset + count)
    if (group.length !== count) return null
    if (diamond) {
      const corners = new Set<string>()
      for (const layer of group) {
        const gradient = parseGradient(layer)
        const corner = /^\s+(top|bottom)\s+(left|right)\s*\/\s*50%\s+50%\s+no-repeat\s*$/i.exec(
          gradient?.suffix ?? ''
        )
        if (gradient?.fn !== 'linear-gradient' || !corner) return null
        const position = `${corner[1]!.toLowerCase()} ${corner[2]!.toLowerCase()}`
        if (gradient.geometry?.toLowerCase() !== `to ${position}`) return null
        corners.add(position)
      }
      if (corners.size !== 4) return null
    }
    groups.push(group)
    offset += count
  }
  return offset === layers.length ? groups : null
}

export function preserveGradientGeometry(
  source: string,
  resolved: string,
  paintType?: GradientPaint['type']
): string | null {
  const original = parseGradient(source)
  const replacement = parseGradient(resolved)
  if (!original || !replacement) return null
  const diamondQuadrant =
    paintType === 'GRADIENT_DIAMOND' &&
    original.fn === 'linear-gradient' &&
    replacement.fn === 'radial-gradient'
  if (original.fn !== replacement.fn && !diamondQuadrant) return null

  let first = 0
  let last = original.stops.length
  if (original.stops.length !== replacement.stops.length && replacement.stops.length !== 1) {
    if (original.fn !== 'conic-gradient') return null
    // Figma closes angular gradients with interpolated 0/360-degree stops when
    // the authored stops do not reach those endpoints. Their native colors
    // already include opacity; only the authored stop colors need replacement.
    const firstPosition = gradientAngle(replacement.stops[0]!.position)
    const lastPosition = gradientAngle(replacement.stops.at(-1)!.position)
    if (
      firstPosition !== null &&
      firstPosition.value > 0 &&
      gradientAngle(original.stops[0]!.position)?.value === 0
    )
      first++
    if (
      lastPosition !== null &&
      lastPosition.value < 1 &&
      gradientAngle(original.stops.at(-1)!.position)?.value === 1
    )
      last--
    for (const [index, stop] of replacement.stops.entries()) {
      const sourcePosition = gradientAngle(original.stops[index + first]?.position ?? '')
      const targetPosition = gradientAngle(stop.position)
      if (
        !sourcePosition ||
        !targetPosition ||
        Math.abs(sourcePosition.value - targetPosition.value) >
          sourcePosition.rounding + targetPosition.rounding
      )
        return null
    }
  }
  if (last - first !== replacement.stops.length && replacement.stops.length !== 1) return null
  const stops = original.stops.map((stop, index) => {
    if (index < first || index >= last) return stop.color + stop.position
    const replacementStop = replacement.stops[index - first] ?? replacement.stops[0]!
    return replacementStop.color + stop.position
  })
  const geometry = original.geometry
  return `${original.fn}(${[...(geometry ? [geometry] : []), ...stops].join(', ')})${original.suffix}`
}

function gradientAngle(position: string): { value: number; rounding: number } | null {
  const match = /^\s*([+-]?(?:\d*\.)?\d+)(%|deg)\s*$/.exec(position)
  if (!match) return null
  const decimals = match[1]!.split('.')[1]?.length ?? 0
  // Native CSS uses degrees; generated paint stops use formatPercent's two decimals.
  return match[2] === 'deg'
    ? { value: Number(match[1]) / 360, rounding: (0.5 * 10 ** -decimals) / 360 }
    : { value: Number(match[1]) / 100, rounding: 0.00005 }
}

function parseGradient(value: string): {
  fn: string
  geometry?: string
  stops: { color: string; position: string }[]
  suffix: string
} | null {
  value = value.trim()
  const match = /^(linear-gradient|radial-gradient|conic-gradient)\s*\(/i.exec(value)
  if (!match) return null
  const fn = match[1]!.toLowerCase()
  const start = match[0].length
  let depth = 1
  let end = start
  for (; end < value.length; end++) {
    if (value[end] === '(') depth++
    else if (value[end] === ')' && --depth === 0) break
  }
  if (depth !== 0) return null
  const args = splitByTopLevelComma(value.slice(start, end))
  let geometry: string | undefined
  if (
    args[0] &&
    (fn === 'radial-gradient'
      ? isRadialGeometry(args[0])
      : /^(?:to\s|from\s|at\s|in\s|[+-]?(?:\d*\.)?\d+(?:deg|grad|rad|turn)(?:\s|$))/i.test(args[0]))
  ) {
    geometry = args.shift()
  }
  const stops: { color: string; position: string }[] = []
  for (const arg of args) {
    if (!/^(?:#[\da-f]+|[a-z][\w-]*(?:\(|(?=\s|$)))/i.test(arg)) return null
    let colorEnd = 0
    depth = 0
    for (; colorEnd < arg.length; colorEnd++) {
      const ch = arg[colorEnd]!
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (/\s/.test(ch) && depth === 0) break
    }
    if (depth !== 0) return null
    stops.push({ color: arg.slice(0, colorEnd), position: arg.slice(colorEnd) })
  }
  return stops.length ? { fn, geometry, stops, suffix: value.slice(end + 1) } : null
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
        const fallback = formatHexAlpha(stop.color, baseAlpha)
        const cssVarName = getVariableCssName(v)
        const varName = `var(${cssVarName}, ${fallback})`
        // Bound stop alpha is already in the variable; only paint opacity is independent.
        if (fillOpacity >= 0.99) return varName
        const pct = Math.round(Math.max(0, Math.min(1, fillOpacity)) * 10000) / 100
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
