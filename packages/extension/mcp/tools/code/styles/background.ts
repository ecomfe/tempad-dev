import {
  canonicalizeColor,
  formatHexAlpha,
  parseBackgroundShorthand,
  preprocessCssValue,
  stripFallback,
  normalizeFigmaVarName
} from '@/utils/css'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i

export function cleanFigmaSpecificStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node) return style
  const processed = style

  if (processed.background) {
    const bgValue = processed.background
    const normalized = stripFallback(preprocessCssValue(bgValue)).trim()

    const gradient = resolveGradientWithOpacity(normalized, node)
    if (gradient) {
      processed.background = gradient
      return processed
    }

    if (isSolidBackground(normalized)) {
      processed['background-color'] = normalized
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
    const solidFill = node.fills.find(
      (f) => f.type === 'SOLID' && f.visible !== false
    ) as SolidPaint
    if (solidFill && solidFill.color) {
      processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
    }
  }

  return processed
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
    const name = normalizeFigmaVarName(v?.name ?? '')
    const expr = `var(${name})`
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
