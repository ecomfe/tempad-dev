import type { CodegenConfig } from '@/utils/codegen'
import type { NestedStyleMap } from '@/utils/tailwind'

import { expandShorthands, normalizeStyleValue, normalizeStyleValues } from '@/utils/css'
import { cssToClassNames, nestedCssToClassNames } from '@/utils/tailwind'

import type { StyleMap, StyleStep } from './types'

import { cleanFigmaSpecificStyles } from './background'
import { inferResizingStyles, mergeInferredAutoLayout } from './layout'
import { applyOverflowStyles } from './overflow'

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const
const OVERFLOW_CLIPPING_VALUES = new Set(['hidden', 'clip'])
const GRADIENT_FUNCTION_PREFIXES = [
  'linear-gradient(',
  'radial-gradient(',
  'conic-gradient(',
  'repeating-linear-gradient(',
  'repeating-radial-gradient(',
  'repeating-conic-gradient('
]
const LENGTH_LITERAL_RE = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i
const RING_MASK = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)'

/**
 * Steps:
 * 1) Clean Figma-specific quirks and inject fills when absent.
 * 2) Expand shorthands.
 * 3) Merge inferred auto-layout.
 * 4) Infer resizing styles.
 * 5) Apply overflow rules.
 */
const STYLE_PIPELINE: StyleStep[] = [
  (style, node) => cleanFigmaSpecificStyles(style, node),
  (style) => expandShorthands(style),
  (style, node) => mergeInferredAutoLayout(style, node),
  (style, node, parent) => inferResizingStyles(style, node, parent),
  (style, node) => applyOverflowStyles(style, node)
]

export function preprocessStyles(style: StyleMap, node?: SceneNode, parent?: SceneNode): StyleMap {
  return STYLE_PIPELINE.reduce((acc, step) => step(acc, node, parent), style)
}

export function stripInertShadows(style: StyleMap, node: SceneNode): void {
  if (!style['box-shadow']) return
  if (hasRenderableFill(node)) return
  delete style['box-shadow']
}

function hasRenderableFill(node: SceneNode): boolean {
  if (!('fills' in node)) return false
  const fills = node.fills
  if (!Array.isArray(fills)) return false
  return fills.some(isFillRenderable)
}

function isFillRenderable(fill: Paint | undefined): boolean {
  if (!fill || fill.visible === false) {
    return false
  }
  if (typeof fill.opacity === 'number' && fill.opacity <= 0) {
    return false
  }
  if ('gradientStops' in fill && Array.isArray(fill.gradientStops)) {
    return fill.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

const LAYOUT_KEYS = new Set([
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-x',
  'inset-y',
  'z-index',
  'display',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'flex-direction',
  'flex-wrap',
  'align-self',
  'align-items',
  'justify-self',
  'justify-items',
  'justify-content',
  'place-self',
  'place-items',
  'place-content',
  'order',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'gap',
  'row-gap',
  'column-gap'
])

export function layoutOnly(style: StyleMap): StyleMap {
  const picked: StyleMap = {}
  for (const [key, value] of Object.entries(style)) {
    if (LAYOUT_KEYS.has(key)) picked[key] = value
  }
  return picked
}

export function buildLayoutStyles(
  styles: Map<string, StyleMap>,
  svgRoots?: Set<string>
): Map<string, StyleMap> {
  const out = new Map<string, StyleMap>()
  for (const [id, style] of styles.entries()) {
    let layout = layoutOnly(style)
    if (svgRoots?.has(id)) {
      layout = stripSvgLayout(layout)
    }
    out.set(id, layout)
  }
  return out
}

export function styleToClassNames(style: StyleMap, config: CodegenConfig): string[] {
  const normalizedStyle = normalizeStyleValues(style, config)
  const resolved = resolveGradientBorderClasses(normalizedStyle)
  if (!resolved) {
    return cssToClassNames(normalizedStyle)
  }

  return nestedCssToClassNames(resolved.style)
}

type GradientBorderClassResult = {
  style: NestedStyleMap
}

function resolveGradientBorderClasses(style: StyleMap): GradientBorderClassResult | null {
  const gradient = extractLeadingGradient(style['border-image'] ?? '')
  if (!gradient) return null

  const borderWidth = getBorderWidth(style)
  if (!borderWidth || isZeroValue(borderWidth)) return null

  const preserveBorder = !hasOverflowClipping(style)
  const inset = preserveBorder
    ? (negateLengthLiteral(borderWidth) ?? `calc(-1 * ${borderWidth})`)
    : '0'

  const base: StyleMap = {}
  for (const [key, value] of Object.entries(style)) {
    if (!value) continue
    if (key === 'border-image' || key === 'border-image-slice') continue
    if (isNonRadiusBorderProperty(key)) continue
    base[key] = value
  }

  if (!base.position) {
    base.position = 'relative'
  }
  if (!base.isolation) {
    base.isolation = 'isolate'
  }

  if (preserveBorder) {
    for (const side of BORDER_SIDES) {
      base[`border-${side}-width`] = borderWidth
      base[`border-${side}-style`] = 'solid'
      base[`border-${side}-color`] = 'transparent'
    }
  }

  return {
    style: {
      ...base,
      '&::before': {
        content: '""',
        position: 'absolute',
        inset,
        padding: borderWidth,
        'border-radius': 'inherit',
        background: gradient,
        'pointer-events': 'none',
        '-webkit-mask': RING_MASK,
        '-webkit-mask-composite': 'xor',
        mask: RING_MASK,
        'mask-composite': 'exclude'
      }
    }
  }
}

function extractLeadingGradient(value: string): string | null {
  const input = value.trim()
  if (!input) return null

  const lower = input.toLowerCase()
  if (!GRADIENT_FUNCTION_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return null
  }

  let depth = 0
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (ch === '(') {
      depth++
      continue
    }

    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) {
        return input.slice(0, i + 1).trim()
      }
    }
  }

  return null
}

function parseBorderShorthand(normalized: string): { width?: string } {
  const matched = normalized.match(/^\s*(\S+)\s+(\S+)\s+(.+)\s*$/)
  if (matched) {
    const [, width] = matched
    return { width: width.trim() }
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  return { width: parts[0] }
}

function parseBoxValues(value: string): [string, string, string, string] {
  const parts = value.trim().split(/\s+/)
  const [t, r = t, b = t, l = r] = parts
  return [t, r, b, l]
}

function getBorderWidth(style: StyleMap): string | null {
  const sideWidths = BORDER_SIDES.map((side) => {
    const width = style[`border-${side}-width`]
    if (width) return normalizeStyleValue(width)
    const border = style[`border-${side}`]
    if (!border) return null
    const parsed = parseBorderShorthand(normalizeStyleValue(border))
    return parsed.width ? normalizeStyleValue(parsed.width) : null
  })

  if (sideWidths.every((width): width is string => typeof width === 'string' && width.length > 0)) {
    const [first, ...rest] = sideWidths
    if (rest.every((width) => width === first)) {
      return first
    }
  }

  const borderWidth = style['border-width']
  if (borderWidth) {
    const [t, r, b, l] = parseBoxValues(normalizeStyleValue(borderWidth))
    if (t === r && r === b && b === l) return t
  }

  if (style.border) {
    const parsed = parseBorderShorthand(normalizeStyleValue(style.border))
    if (parsed.width) return normalizeStyleValue(parsed.width)
  }

  return null
}

function hasOverflowClipping(style: StyleMap): boolean {
  const overflowValues = [style.overflow, style['overflow-x'], style['overflow-y']]
  return overflowValues.some((value) => {
    if (!value) return false
    const parts = normalizeStyleValue(value).toLowerCase().split(/\s+/).filter(Boolean)
    return parts.some((part) => OVERFLOW_CLIPPING_VALUES.has(part))
  })
}

function isNonRadiusBorderProperty(name: string): boolean {
  return /^border(?:$|-)/.test(name) && !name.includes('radius')
}

function isZeroValue(value: string): boolean {
  return /^0(?:\.0+)?(?:[a-z%]+)?$/i.test(normalizeStyleValue(value))
}

function negateLengthLiteral(value: string): string | null {
  const normalized = normalizeStyleValue(value)
  const matched = normalized.match(LENGTH_LITERAL_RE)
  if (!matched) return null

  const [, amount, unit] = matched
  if (amount.startsWith('-')) {
    return `${amount.slice(1)}${unit}`
  }

  return `-${amount}${unit}`
}

function stripSvgLayout(style: StyleMap): StyleMap {
  if (
    !style.width &&
    !style.height &&
    !style.overflow &&
    !style['overflow-x'] &&
    !style['overflow-y']
  ) {
    return style
  }
  const cleaned: StyleMap = {}
  for (const [key, value] of Object.entries(style)) {
    if (
      key === 'width' ||
      key === 'height' ||
      key === 'overflow' ||
      key === 'overflow-x' ||
      key === 'overflow-y'
    ) {
      continue
    }
    cleaned[key] = value
  }
  return cleaned
}
