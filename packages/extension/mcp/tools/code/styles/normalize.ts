import type { CodegenConfig } from '@/utils/codegen'

import { expandShorthands, normalizeStyleValues } from '@/utils/css'
import { cssToClassNames } from '@/utils/tailwind'

import { cleanFigmaSpecificStyles } from './background'
import { inferResizingStyles, mergeInferredAutoLayout } from './layout'
import { applyOverflowStyles } from './overflow'

type StyleStep = (
  style: Record<string, string>,
  node?: SceneNode,
  parent?: SceneNode
) => Record<string, string>

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

export function preprocessStyles(
  style: Record<string, string>,
  node?: SceneNode,
  parent?: SceneNode
): Record<string, string> {
  return STYLE_PIPELINE.reduce((acc, step) => step(acc, node, parent), style)
}

export function stripInertShadows(style: Record<string, string>, node: SceneNode): void {
  if (!style['box-shadow']) return
  if (hasRenderableFill(node)) return
  delete style['box-shadow']
}

function hasRenderableFill(node: SceneNode): boolean {
  if (!('fills' in node)) return false
  const fills = node.fills
  if (!Array.isArray(fills)) return false
  return fills.some((fill) => isFillRenderable(fill as Paint))
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

export function layoutOnly(style: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    if (LAYOUT_KEYS.has(key)) picked[key] = value
  }
  return picked
}

export function buildLayoutStyles(
  styles: Map<string, Record<string, string>>,
  svgRoots?: Set<string>
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  for (const [id, style] of styles.entries()) {
    let layout = layoutOnly(style)
    if (svgRoots?.has(id)) {
      layout = stripSvgLayout(layout)
    }
    out.set(id, layout)
  }
  return out
}

export function styleToClassNames(style: Record<string, string>, config: CodegenConfig): string[] {
  const normalizedStyle = normalizeStyleValues(style, config)
  return cssToClassNames(normalizedStyle)
}

function stripSvgLayout(style: Record<string, string>): Record<string, string> {
  if (
    !style.width &&
    !style.height &&
    !style.overflow &&
    !style['overflow-x'] &&
    !style['overflow-y']
  ) {
    return style
  }
  const cleaned: Record<string, string> = {}
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
