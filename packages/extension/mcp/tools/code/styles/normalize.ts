import type { CodegenConfig } from '@/utils/codegen'
import type { NestedStyleMap } from '@/utils/tailwind'

import {
  expandShorthands,
  extractLeadingGradient,
  hasOverflowClipping,
  isZeroBorderWidth,
  negateLengthLiteral,
  normalizeStyleValue,
  normalizeStyleValues,
  parseBorderShorthand,
  parseBoxValues
} from '@/utils/css'
import { isRenderablePaint } from '@/utils/figma-paint'
import { cssToClassNames, nestedCssToClassNames } from '@/utils/tailwind'

import type { GetCodeCacheContext } from '../cache'
import type { StyleMap, StyleStep } from './types'

import { getNodeSemanticsCached, getPaintsFromState } from '../cache'
import { cleanFigmaSpecificStyles } from './background'
import { inferResizingStyles, mergeInferredAutoLayout } from './layout'
import { applyOverflowStyles } from './overflow'

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const
const RING_MASK_IMAGE = 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)'
const RING_MASK_BOX = 'content-box, border-box'

/**
 * Steps:
 * 1) Clean Figma-specific quirks and inject fills when absent.
 * 2) Expand shorthands.
 * 3) Merge inferred auto-layout.
 * 4) Infer resizing styles.
 * 5) Apply overflow rules.
 */
const STYLE_PIPELINE: StyleStep[] = [
  (style, node, _parent, ctx) => cleanFigmaSpecificStyles(style, node, ctx),
  (style) => expandShorthands(style),
  (style, node, _parent, ctx) => mergeInferredAutoLayout(style, node, ctx),
  (style, node, parent, ctx) => inferResizingStyles(style, node, parent, ctx),
  (style, node) => applyOverflowStyles(style, node)
]

export function preprocessStyles(
  style: StyleMap,
  node?: SceneNode,
  parent?: SceneNode,
  ctx?: GetCodeCacheContext
): StyleMap {
  return STYLE_PIPELINE.reduce((acc, step) => step(acc, node, parent, ctx), style)
}

export function stripInertShadows(
  style: StyleMap,
  node: SceneNode,
  ctx?: GetCodeCacheContext
): void {
  if (!style['box-shadow']) return
  if (hasRenderableFill(node, ctx)) return
  delete style['box-shadow']
}

function hasRenderableFill(node: SceneNode, ctx?: GetCodeCacheContext): boolean {
  const fills = ctx
    ? getPaintsFromState(getNodeSemanticsCached(node, ctx).paint.fillsState)
    : 'fills' in node && Array.isArray(node.fills)
      ? node.fills
      : null
  if (!fills) return false
  return fills.some(isRenderablePaint)
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
  if (!borderWidth || isZeroBorderWidth(borderWidth)) return null

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
        'mask-image': RING_MASK_IMAGE,
        'mask-origin': RING_MASK_BOX,
        'mask-clip': RING_MASK_BOX,
        'mask-composite': 'exclude'
      }
    }
  }
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

  const [first] = sideWidths
  if (first && sideWidths.every((width) => width === first)) {
    return first
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

function isNonRadiusBorderProperty(name: string): boolean {
  return /^border(?:$|-)/.test(name) && !name.includes('radius')
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
