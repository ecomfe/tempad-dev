import type { CodegenConfig } from '@/utils/codegen'

import {
  expandShorthands,
  formatHexAlpha,
  normalizeStyleValues,
  parseBackgroundShorthand
} from '@/utils/css'
import { cssToClassNames } from '@/utils/tailwind'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i

type AutoLayoutLike = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  itemSpacing?: number
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
}

type StyleStep = (style: Record<string, string>, node?: SceneNode) => Record<string, string>

/**
 * Steps:
 * 1) Clean Figma-specific quirks and inject fills when absent.
 * 2) Expand shorthands.
 * 3) Merge inferred auto-layout.
 * 4) Infer resizing styles.
 * 5) Apply overflow rules.
 */
const STYLE_PIPELINE: StyleStep[] = [
  cleanFigmaSpecificStyles,
  expandShorthands,
  mergeInferredAutoLayout,
  inferResizingStyles,
  applyOverflowStyles
]

export function preprocessStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  return STYLE_PIPELINE.reduce((acc, step) => step(acc, node), style)
}

function cleanFigmaSpecificStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node) return style
  const processed = style

  if (processed.background) {
    const bgValue = processed.background
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

export function applyOverflowStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node || !('overflowDirection' in node)) return style

  const dir = (node as { overflowDirection?: string }).overflowDirection
  const next = style
  const hasOverflow = (prop: 'overflow' | 'overflow-x' | 'overflow-y') => !!next[prop]
  const overflowInfo = computeChildOverflow(node)

  // Explicit scroll settings take precedence.
  if (dir && dir !== 'NONE') {
    if (dir === 'HORIZONTAL') {
      if (!hasOverflow('overflow-x')) next['overflow-x'] = 'auto'
      if ((node as { clipsContent?: boolean }).clipsContent && overflowInfo.y) {
        if (!hasOverflow('overflow-y')) next['overflow-y'] = 'hidden'
      }
    } else if (dir === 'VERTICAL') {
      if (!hasOverflow('overflow-y')) next['overflow-y'] = 'auto'
      if ((node as { clipsContent?: boolean }).clipsContent && overflowInfo.x) {
        if (!hasOverflow('overflow-x')) next['overflow-x'] = 'hidden'
      }
    } else if (dir === 'BOTH') {
      if (!hasOverflow('overflow')) next.overflow = 'auto'
      // clipsContent is satisfied by scrolling on both axes.
    }
    return next
  }

  // No explicit scroll; only add hidden when clipsContent is on AND children overflow.
  if ((node as { clipsContent?: boolean }).clipsContent && (overflowInfo.x || overflowInfo.y)) {
    if (!hasOverflow('overflow')) next.overflow = 'hidden'
  }

  return next
}

type OverflowInfo = { x: boolean; y: boolean }

function computeChildOverflow(node: SceneNode): OverflowInfo {
  const none = { x: false, y: false }
  if (!('children' in node) || !Array.isArray((node as ChildrenMixin).children)) return none
  const children = (node as SceneNode & ChildrenMixin).children.filter((c) => c.visible)
  if (!children.length) return none

  const parentBounds = getRenderBounds(node)
  if (!parentBounds) return none
  if (parentBounds.width === 0 || parentBounds.height === 0) return none

  const { x: px, y: py, width: pw, height: ph } = parentBounds
  const tol = 0.5 // guard against minor float noise
  const minX = px - tol
  const minY = py - tol
  const maxX = px + pw + tol
  const maxY = py + ph + tol

  let overflowX = false
  let overflowY = false

  for (const child of children) {
    const bounds = getRenderBounds(child)
    if (!bounds) continue
    const cx1 = bounds.x
    const cy1 = bounds.y
    const cx2 = bounds.x + bounds.width
    const cy2 = bounds.y + bounds.height
    if (cx1 < minX || cx2 > maxX) overflowX = true
    if (cy1 < minY || cy2 > maxY) overflowY = true
    if (overflowX && overflowY) break
  }

  return { x: overflowX, y: overflowY }
}

function getRenderBounds(
  node: SceneNode
): { x: number; y: number; width: number; height: number } | null {
  const renderBounds = (node as { absoluteRenderBounds?: Rect | null }).absoluteRenderBounds
  if (renderBounds) {
    const { x, y, width, height } = renderBounds
    if (isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height)) {
      return { x, y, width, height }
    }
  }

  if ('width' in node && 'height' in node && 'x' in node && 'y' in node) {
    const { x, y, width, height } = node as LayoutMixin
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof width === 'number' &&
      typeof height === 'number'
    ) {
      return { x, y, width, height }
    }
  }

  return null
}

export function mergeInferredAutoLayout(
  expandedStyle: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node) return expandedStyle
  // Respect explicit grid layout from Figma; don't overwrite with inferred flex.
  const display = expandedStyle.display
  if (display === 'grid' || display === 'inline-grid') {
    return expandedStyle
  }

  const source = getAutoLayoutSource(node)
  if (!source || source.layoutMode === 'NONE' || !source.layoutMode) {
    return expandedStyle
  }

  const merged: Record<string, string> = expandedStyle

  if (!merged.display?.includes('flex')) {
    merged.display = 'flex'
  }
  if (!merged['flex-direction']) {
    merged['flex-direction'] = source.layoutMode === 'HORIZONTAL' ? 'row' : 'column'
  }

  if (typeof source.itemSpacing === 'number' && !hasGap(merged)) {
    merged.gap = `${Math.round(source.itemSpacing)}px`
  }

  const justify = mapAxisAlignToCss(source.primaryAxisAlignItems)
  if (justify && !merged['justify-content']) {
    merged['justify-content'] = justify
  }

  const align = mapAxisAlignToCss(source.counterAxisAlignItems)
  if (align && !merged['align-items']) {
    merged['align-items'] = align
  }

  if (node.type !== 'INSTANCE') {
    // Optimization: Since styles are expanded, we don't need to check "padding".
    // We only check if specific atomic paddings are missing.
    const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = source
    if (t || r || b || l) {
      // Only apply inferred padding if NO padding is present (simplistic heuristic),
      // or we can overwrite. Standard behavior usually prefers manual overrides.
      // Here we check if any specific padding side is set.
      if (!hasAtomicPadding(merged)) {
        merged['padding-top'] = `${t ?? 0}px`
        merged['padding-right'] = `${r ?? 0}px`
        merged['padding-bottom'] = `${b ?? 0}px`
        merged['padding-left'] = `${l ?? 0}px`
      }
    }
  }

  return merged
}

export function inferResizingStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node) return style
  const source = getAutoLayoutSource(node)
  if (!source) return style

  const merged = style
  const { layoutSizingHorizontal, layoutSizingVertical } = source

  if (layoutSizingHorizontal === 'FILL') {
    merged.width = 'auto'
    merged['flex-grow'] = '1'
    merged['flex-shrink'] = '1'
    merged['flex-basis'] = '0%'
  } else if (layoutSizingHorizontal === 'HUG') {
    merged.width = 'max-content'
  }

  if (layoutSizingVertical === 'FILL') {
    merged.height = 'auto'
    if (style['flex-direction'] === 'column') {
      merged['flex-grow'] = '1'
      merged['flex-basis'] = '0%'
    } else {
      merged['align-self'] = 'stretch'
    }
  } else if (layoutSizingVertical === 'HUG') {
    merged.height = 'max-content'
  }

  return merged
}

function getAutoLayoutSource(node?: SceneNode): AutoLayoutLike | undefined {
  if (!node) return undefined
  const inferred =
    (node as { inferredAutoLayout?: AutoLayoutLike | null }).inferredAutoLayout ?? undefined

  if ('layoutMode' in node) {
    const layoutNode = node as AutoLayoutLike
    if (layoutNode.layoutMode && layoutNode.layoutMode !== 'NONE') {
      return layoutNode
    }
    // Fallback to inferred auto layout when Figma CSS doesn’t emit layout props
    if (inferred && inferred.layoutMode && inferred.layoutMode !== 'NONE') {
      return inferred
    }
    return layoutNode
  }

  return inferred
}

function mapAxisAlignToCss(value?: string): string | undefined {
  const map: Record<string, string> = {
    MIN: 'flex-start',
    MAX: 'flex-end',
    CENTER: 'center',
    SPACE_BETWEEN: 'space-between',
    STRETCH: 'stretch'
  }
  return value ? map[value] : undefined
}

function hasGap(s: Record<string, string>) {
  return !!(s.gap || s['row-gap'] || s['column-gap'])
}

function hasAtomicPadding(s: Record<string, string>) {
  return !!(s['padding-top'] || s['padding-right'] || s['padding-bottom'] || s['padding-left'])
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

export function styleToClassNames(
  style: Record<string, string>,
  config: CodegenConfig,
  node?: SceneNode
): string[] {
  // NOTE: If styleToClassNames is called with styles that are ALREADY processed (like in collectSceneData),
  // re-running preprocessStyles might be redundant but harmless (expandShorthands is idempotent).
  // However, for Text Segments which are generated on the fly, this is necessary.
  const processed = preprocessStyles(style, node)
  const normalizedStyle = normalizeStyleValues(processed, config)

  return cssToClassNames(normalizedStyle)
}
