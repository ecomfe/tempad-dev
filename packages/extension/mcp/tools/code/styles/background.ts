import {
  canonicalizeColor,
  formatHexAlpha,
  parseBackgroundShorthand,
  preprocessCssValue,
  stripFallback,
  normalizeFigmaVarName,
  toFigmaVarExpr
} from '@/utils/css'

import { getVariableRawName } from '../../token/indexer'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i

export function cleanFigmaSpecificStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node) return style
  const processed = style
  const solidStyleColor = resolveSolidFillStyle(node)
  const gradientStyle = resolveGradientFillStyle(node) ?? resolveGradientFillFromNode(node)

  if (processed.background) {
    const bgValue = processed.background
    const normalized = stripFallback(preprocessCssValue(bgValue)).trim()

    const gradient = resolveGradientWithOpacity(normalized, node)
    if (gradient) {
      processed.background = gradient
      return processed
    }

    if (gradientStyle && isVarOnly(normalized)) {
      processed.background = gradientStyle
      return processed
    }

    if (isSolidBackground(normalized)) {
      processed['background-color'] = solidStyleColor ?? normalized
      delete processed.background
    } else {
      if (BG_URL_LIGHTGRAY_RE.test(bgValue) && 'fills' in node && Array.isArray(node.fills)) {
        const parsed = parseBackgroundShorthand(bgValue)

        if (parsed.image) processed['background-image'] = parsed.image
        if (parsed.size) processed['background-size'] = parsed.size
        if (parsed.repeat) processed['background-repeat'] = parsed.repeat
        if (parsed.position) processed['background-position'] = parsed.position

        const solidFill = node.fills.find(
          (f) => f.type === 'SOLID' && f.visible !== false
        ) as SolidPaint

        if (solidFill && solidFill.color) {
          processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
        }

        delete processed.background
      }
    }
  }

  if (
    node.type !== 'TEXT' &&
    !processed.background &&
    !processed['background-color'] &&
    'fills' in node &&
    Array.isArray(node.fills)
  ) {
    if (gradientStyle) {
      processed.background = gradientStyle
    } else if (solidStyleColor) {
      processed['background-color'] = solidStyleColor
    } else {
      const solidFill = node.fills.find(
        (f) => f.type === 'SOLID' && f.visible !== false
      ) as SolidPaint
      if (solidFill && solidFill.color) {
        processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
      }
    }
  }

  return processed
}

function resolveSolidFillStyle(node: SceneNode): string | null {
  if (!('fillStyleId' in node)) return null
  const styleId = node.fillStyleId
  if (!styleId || typeof styleId !== 'string') return null

  try {
    const style = figma.getStyleById(styleId) as PaintStyle | null
    if (!style || !Array.isArray(style.paints)) return null

    const visible = style.paints.filter((paint) => paint && paint.visible !== false)
    if (visible.length !== 1) return null
    const paint = visible[0]
    if (!paint || paint.type !== 'SOLID') return null

    const solid = paint as SolidPaint
    const bound = solid.boundVariables?.color
    if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
      try {
        const variable = figma.variables.getVariableById(bound.id)
        if (variable) return toFigmaVarExpr(getVariableRawName(variable))
      } catch {
        // noop
      }
    }
    if (!solid.color) return null

    return formatHexAlpha(solid.color, solid.opacity ?? 1)
  } catch {
    return null
  }
}

function resolveGradientFillStyle(node: SceneNode): string | null {
  if (!('fillStyleId' in node)) return null
  const styleId = node.fillStyleId
  if (!styleId || typeof styleId !== 'string') return null

  try {
    const style = figma.getStyleById(styleId) as PaintStyle | null
    return resolveGradientFromPaints(style?.paints)
  } catch {
    return null
  }
}

function resolveGradientFillFromNode(node: SceneNode): string | null {
  if (!('fills' in node) || !Array.isArray(node.fills)) return null
  return resolveGradientFromPaints(node.fills as Paint[])
}

function resolveGradientFromPaints(paints?: Paint[] | ReadonlyArray<Paint> | null): string | null {
  if (!paints || !Array.isArray(paints)) return null
  const visible = paints.filter((paint) => paint && paint.visible !== false)
  if (visible.length !== 1) return null
  const paint = visible[0]
  if (!paint || !('gradientStops' in paint) || !Array.isArray(paint.gradientStops)) return null
  const gradientPaint = paint as GradientPaint

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

function resolveGradientWithOpacity(value: string, node: SceneNode): string | null {
  if (!value) return null
  if (!/gradient\(/i.test(value)) return null
  if (!('fills' in node) || !Array.isArray(node.fills)) return null

  const fill = node.fills.find((f) => f && f.visible !== false && f.type === 'GRADIENT_LINEAR') as
    | GradientPaint
    | undefined
  if (!fill || !Array.isArray(fill.gradientStops)) return null

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
    const color = formatGradientStopColor(stop, fillOpacity)
    return `${color} ${pct}`
  })

  const args = hasAngle ? [angle, ...stops] : stops
  return `${parsed.fn}(${args.join(', ')})`
}

function parseGradient(value: string): { fn: string; args: string[] } | null {
  const match = value.match(/(linear-gradient|radial-gradient|conic-gradient)\s*\(/i)
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
  return { fn, args: splitTopLevel(inner) }
}

function splitTopLevel(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: '"' | "'" | null = null
  let buf = ''

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]

    if (quote) {
      if (ch === '\\') {
        buf += ch
        i += 1
        if (i < input.length) buf += input[i]
        continue
      }
      if (ch === quote) quote = null
      buf += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }

    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)

    if (ch === ',' && depth === 0) {
      out.push(buf.trim())
      buf = ''
      continue
    }

    buf += ch
  }

  if (buf.trim()) out.push(buf.trim())
  return out
}

function formatPercent(pos: number): string {
  const pct = Math.round(pos * 10000) / 100
  return `${pct}%`
}

function formatGradientStopColor(stop: ColorStop, fillOpacity: number): string {
  const baseAlpha = stop.color?.a ?? 1
  const alpha = Math.max(0, Math.min(1, baseAlpha * fillOpacity))

  const bound = stop.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    const v = figma.variables.getVariableById(bound.id)
    const expr = v ? toFigmaVarExpr(getVariableRawName(v)) : `var(${normalizeFigmaVarName('')})`
    if (alpha >= 0.99) return expr
    const pct = Math.round(alpha * 10000) / 100
    return `color-mix(in srgb, ${expr} ${pct}%, transparent)`
  }

  return formatHexAlpha(stop.color, alpha)
}

function resolveLinearGradientAngle(paint: GradientPaint): number | null {
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

function normalizeGradientAngle(dx: number, dy: number): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (dx === 0 && dy === 0) return null
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90
  angle += 180
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
