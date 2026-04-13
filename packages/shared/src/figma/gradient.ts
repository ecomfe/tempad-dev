/**
 * Gradient and color utilities for Figma styles
 */

import type { FigmaLookupReaders, PaintList, PaintResolutionSize } from './types'

import { formatHexAlpha } from './color'

const RE_NON_ASCII = /\P{ASCII}+/gu
const RE_QUOTES = /['"]/g
const RE_SLASH = /\//g
const RE_SPACE_TAB = /[ \t]+/g
const RE_WHITESPACE = /\s+/g
const RE_FAST_PATH = /^[A-Za-z0-9_-]+$/
const RE_BOUND_NON_ALPHANUM = /[^A-Za-z0-9]+/g
const RE_HYPHENS = /-+/g
const RE_BOUND_DIGIT = /([A-Za-z])([0-9])|([0-9])([A-Za-z])/g
const RE_BOUND_CASE = /([a-z])([A-Z])|([A-Z])([A-Z][a-z])/g
const RE_DIGIT = /^\d+$/
const RE_CAPS = /^[A-Z]+$/
const RE_SINGLE = /^[A-Za-z]$/

function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  return !!paint && paint.visible !== false
}

export type ResolvedBackgroundFill =
  | { kind: 'color'; value: string }
  | { kind: 'layers'; value: string[] }

type BackgroundFillResolverOptions = {
  resolveGradientPaint?: (
    paint: GradientPaint,
    size: GradientSize | undefined,
    readers: FigmaLookupReaders
  ) => string | null
  resolveSolidPaint?: (paint: SolidPaint, readers: FigmaLookupReaders) => string | null
}

export function isGradientPaint(paint: Paint): paint is GradientPaint {
  return 'gradientStops' in paint && Array.isArray(paint.gradientStops)
}

export function isSolidPaint(paint: Paint): paint is SolidPaint {
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

function hasGradientHandlePositions(paint: GradientPaint): paint is GradientPaintWithHandles {
  return 'gradientHandlePositions' in paint && Array.isArray(paint.gradientHandlePositions)
}

export function isRenderableBackgroundPaint(paint: Paint | null | undefined): paint is Paint {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if (isGradientPaint(paint)) {
    const fillOpacity = typeof paint.opacity === 'number' ? paint.opacity : 1
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) * fillOpacity > 0)
  }
  return true
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

  return resolveGradientPaint(gradientPaint, size, readers)
}

export function resolveGradientPaint(
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

export function resolveSolidPaint(
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
        const cssVarName = getVariableCssCustomPropertyName(variable)
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

  const visible = paints.filter(isRenderableBackgroundPaint)
  if (!visible.length) return null
  if (visible.some((paint) => !isSolidPaint(paint) && !isGradientPaint(paint))) {
    return null
  }

  const resolveGradient = options.resolveGradientPaint ?? resolveGradientPaint
  const resolveSolid = options.resolveSolidPaint ?? resolveSolidPaint

  if (visible.length === 1) {
    const single = visible[0]
    if (isSolidPaint(single)) {
      const color = resolveSolid(single, readers)
      return color ? { kind: 'color', value: color } : null
    }
    if (!isGradientPaint(single)) return null

    const gradient = resolveGradient(single, size, readers)
    return gradient ? { kind: 'layers', value: [gradient] } : null
  }

  const layers: string[] = []
  for (const paint of visible) {
    if (isSolidPaint(paint)) {
      const color = resolveSolid(paint, readers)
      if (!color) return null
      layers.push(`linear-gradient(${color}, ${color})`)
      continue
    }
    if (!isGradientPaint(paint)) return null

    const gradient = resolveGradient(paint, size, readers)
    if (!gradient) return null
    layers.push(gradient)
  }

  return layers.length ? { kind: 'layers', value: layers } : null
}

/**
 * Formats a gradient stop color
 */
function formatGradientStopColor(
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
        const cssVarName = getVariableCssCustomPropertyName(v)
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
  const { width, height } = getGradientSize(size)

  return {
    dx: (end.x - start.x) * width,
    dy: (end.y - start.y) * height
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

/**
 * Variable naming must match MCP token indexing semantics exactly.
 */
function getVariableCssCustomPropertyName(variable: Variable): string {
  return normalizeFigmaVarName(getVariableRawName(variable))
}

function getVariableRawName(variable: Variable): string {
  const cs = variable.codeSyntax?.WEB
  if (typeof cs === 'string' && cs.trim()) {
    const canonical = canonicalizeVarName(cs.trim())
    if (canonical) return canonical.slice(2)

    const ident = cs.trim()
    if (/^[A-Za-z0-9_-]+$/.test(ident)) return ident
  }

  const raw = variable.name?.trim?.() ?? ''
  if (raw.startsWith('--')) return raw.slice(2)
  return raw
}

function canonicalizeVarName(value: string): string | null {
  const cleaned = value.trim()
  const varMatch = cleaned.match(/^var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,[\s\S]*)?\)$/)
  if (varMatch?.[1]) {
    return normalizeCustomPropertyName(varMatch[1])
  }
  if (cleaned.startsWith('--')) {
    return normalizeCustomPropertyName(cleaned)
  }
  return null
}

function normalizeCustomPropertyBody(name: string): string {
  if (!name) return 'var'
  let raw = name.trim()
  if (raw.startsWith('--')) raw = raw.slice(2)
  raw = raw.replace(/^-+/, '')
  raw = raw.replace(/[^A-Za-z0-9_-]/g, '')
  return raw || 'var'
}

function normalizeCustomPropertyName(name: string): string {
  return `--${normalizeCustomPropertyBody(name)}`
}

function normalizeFigmaVarName(input: string): string {
  let raw = (input ?? '').trim()
  if (!raw) return '--unnamed'

  const canonical = canonicalizeVarName(raw)
  if (canonical) return canonical

  if (raw.startsWith('--')) raw = raw.slice(2).trim()
  raw = raw
    .replace(RE_NON_ASCII, '')
    .replace(RE_QUOTES, '')
    .replace(RE_SLASH, '-')
    .replace(RE_SPACE_TAB, '-')
    .replace(RE_WHITESPACE, '')

  if (RE_FAST_PATH.test(raw)) return `--${raw}`

  const s = raw
    .replace(RE_BOUND_NON_ALPHANUM, '-')
    .replace(RE_HYPHENS, '-')
    .replace(RE_BOUND_DIGIT, '$1-$2$3-$4')
    .replace(RE_BOUND_CASE, '$1$3-$2$4')

  const parts = s.split('-').filter(Boolean)
  const stack: string[] = []

  for (const part of parts) {
    const prev = stack[stack.length - 1]
    if (prev && RE_DIGIT.test(prev) && RE_DIGIT.test(part)) {
      stack[stack.length - 1] += part
    } else if (prev && RE_CAPS.test(prev) && RE_CAPS.test(part)) {
      stack[stack.length - 1] += part
    } else {
      stack.push(part)
    }
  }

  const merged: string[] = []
  for (let i = 0; i < stack.length; ) {
    if (i === 0) {
      merged.push(stack[0])
      i += 1
      continue
    }

    if (RE_SINGLE.test(stack[i])) {
      let j = i + 1
      while (j < stack.length && RE_SINGLE.test(stack[j])) {
        j += 1
      }

      const run = stack.slice(i, j)
      merged.push(run.length >= 2 ? run.join('') : stack[i])
      i = j
      continue
    }

    merged.push(stack[i])
    i += 1
  }

  const out = merged.join('-').toLowerCase()
  return out ? `--${out}` : '--unnamed'
}
