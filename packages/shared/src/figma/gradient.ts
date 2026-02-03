/**
 * Gradient and color utilities for Figma styles
 */

import { formatHexAlpha } from './color'

/**
 * Resolves gradient from paint array
 * Returns CSS gradient string or null
 */
export function resolveGradientFromPaints(
  paints?: Paint[] | ReadonlyArray<Paint> | null
): string | null {
  if (!paints || !Array.isArray(paints)) return null

  // Find the first visible gradient paint
  const gradientPaint = paints.find((paint) => {
    if (!paint || paint.visible === false) return false
    return 'gradientStops' in paint && Array.isArray(paint.gradientStops)
  }) as GradientPaint | undefined

  if (!gradientPaint) return null

  const fillOpacity = typeof gradientPaint.opacity === 'number' ? gradientPaint.opacity : 1
  const stops = gradientPaint.gradientStops.map((stop) => {
    const pct = formatPercent(stop.position)
    const color = formatGradientStopColor(stop, fillOpacity)
    return `${color} ${pct}`
  })

  switch (gradientPaint.type) {
    case 'GRADIENT_LINEAR': {
      const angle = resolveLinearGradientAngle(gradientPaint)
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
  paints?: Paint[] | ReadonlyArray<Paint> | null
): string | null {
  if (!paints || !Array.isArray(paints)) return null

  // Find the first visible solid paint
  const solidPaint = paints.find((paint) => {
    if (!paint || paint.visible === false) return false
    return paint.type === 'SOLID'
  }) as SolidPaint | undefined

  if (!solidPaint || !solidPaint.color) return null

  // Check if color is bound to a variable
  const bound = solidPaint.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    try {
      const variable = figma.variables.getVariableById(bound.id)
      if (variable) {
        const fallback = formatHexAlpha(solidPaint.color, solidPaint.opacity)
        return `var(--${getVariableSimpleName(variable)}, ${fallback})`
      }
    } catch {
      // Fallback to color value
    }
  }

  return formatHexAlpha(solidPaint.color, solidPaint.opacity)
}

/**
 * Formats a gradient stop color
 */
function formatGradientStopColor(stop: ColorStop, fillOpacity: number): string {
  const baseAlpha = stop.color?.a ?? 1
  const alpha = Math.max(0, Math.min(1, baseAlpha * fillOpacity))

  // Check if color is bound to a variable
  const bound = stop.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    try {
      const v = figma.variables.getVariableById(bound.id)
      if (v) {
        const fallbackOpaque = formatHexAlpha(stop.color, 1)
        const fallbackAlpha = formatHexAlpha(stop.color, alpha)
        const varName = `var(--${getVariableSimpleName(v)}, ${fallbackOpaque})`
        if (alpha >= 0.99) return `var(--${getVariableSimpleName(v)}, ${fallbackAlpha})`
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
function resolveLinearGradientAngle(paint: GradientPaint): number | null {
  // First try gradient handle positions (more accurate)
  const handles =
    'gradientHandlePositions' in paint
      ? (paint as { gradientHandlePositions?: ReadonlyArray<Vector> }).gradientHandlePositions
      : undefined

  if (handles && handles.length >= 2) {
    const start = handles[0]
    const end = handles[1]
    if (start && end) {
      const dx = end.x - start.x
      const dy = end.y - start.y
      const angle = normalizeGradientAngle(dx, dy)
      if (angle != null) return angle
    }
  }

  // Fallback to gradient transform
  const transform = paint.gradientTransform
  if (!transform || !Array.isArray(transform) || transform.length < 2) return null

  const row0 = transform[0]
  const row1 = transform[1]
  if (!Array.isArray(row0) || !Array.isArray(row1) || row0.length < 2 || row1.length < 2) {
    return null
  }

  const dx = row0[0]
  const dy = row1[0]
  return normalizeGradientAngle(dx, dy)
}

/**
 * Normalizes gradient angle to degrees
 */
function normalizeGradientAngle(dx: number, dy: number): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (dx === 0 && dy === 0) return null

  // Convert to degrees and normalize
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90
  angle += 180
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
 * Gets simple name from Figma variable
 * This is a simplified version - the full implementation would handle codeSyntax
 */
function getVariableSimpleName(variable: Variable): string {
  // Remove special characters and spaces, convert to kebab-case
  return variable.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
