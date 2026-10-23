import type { FigmaLookupReaders, PaintResolutionSize } from '@/utils/figma-style/types'

import {
  canonicalizeColor,
  formatHexAlpha,
  parseBackgroundShorthand,
  preprocessCssValue,
  splitByTopLevelComma,
  stripFallback
} from '@/utils/css'
import {
  getBackgroundColorPaint,
  getCssPaintLayers,
  getPaintResolutionSize,
  isRenderablePaint
} from '@/utils/figma-paint'
import {
  formatGradientStopColor as formatPaintGradientStopColor,
  matchBackgroundPaintLayers,
  preserveGradientGeometry,
  resolveBackgroundFillFromPaints,
  resolveGradientPaintCss
} from '@/utils/figma-style/gradient'
import { stripFigmaImageFallback } from '@/utils/figma-style/style-resolver'
import { getVariableCssExpr } from '@/utils/figma-variables'

import type { GetCodeCacheContext } from '../cache'
import type { StyleMap } from './types'

import { getNodeSemanticsCached, getPaintStyleCached, getPaintsFromState } from '../cache'

const BG_URL_RE = /url\(/i

type PaintList = Paint[] | ReadonlyArray<Paint> | null | undefined

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id: string) => figma.getStyleById(id),
  getVariableById: (id: string) => figma.variables.getVariableById(id)
}

export function cleanFigmaSpecificStyles(
  style: StyleMap,
  node?: SceneNode,
  ctx?: GetCodeCacheContext
): StyleMap {
  if (!node) return style

  const processed = style
  const fills = getNodeFills(node, ctx)
  const styleFillPaints = getFillStylePaints(node, ctx)
  const activeFillPaints = styleFillPaints ?? fills
  const gradientSize = getPaintResolutionSize(node)
  const readers = ctx?.readers ?? DEFAULT_READERS
  const hasUrlBackground =
    BG_URL_RE.test(processed.background ?? '') ||
    BG_URL_RE.test(processed['background-image'] ?? '')
  const backgroundFill = hasUrlBackground
    ? null
    : resolveBackgroundFillFromPaints(activeFillPaints, gradientSize, readers, {
        background: processed.background,
        resolveGradientPaint: resolveGradientPaintValue,
        resolveSolidPaint: resolveSolidPaintColor
      })
  const backgroundLayers =
    backgroundFill?.kind === 'layers' ? backgroundFill.value.join(', ') : null
  const fallbackPaint = activeFillPaints
    ? hasUrlBackground
      ? getBackgroundColorPaint(activeFillPaints)?.paint
      : findVisibleSolidPaint(activeFillPaints)
    : null
  const fallbackSolidColor = fallbackPaint ? resolveSolidPaintColor(fallbackPaint, readers) : null

  if (processed.background) {
    const bgValue = processed.background
    const imageBackground = activeFillPaints ? stripFigmaImageFallback(bgValue) : bgValue
    const removedFallback = imageBackground !== bgValue
    if (removedFallback) {
      processed.background = imageBackground
      if (fallbackSolidColor) processed['background-color'] = fallbackSolidColor
    }
    const normalized = stripFallback(preprocessCssValue(imageBackground)).trim()

    const layersWithOpacity = resolveGradientWithOpacity(normalized, activeFillPaints, readers)
    if (layersWithOpacity) {
      processed.background = layersWithOpacity
      return processed
    }

    if (isSolidBackground(normalized)) {
      if (backgroundLayers) {
        processed.background = backgroundLayers
        delete processed['background-color']
        return processed
      }
      processed['background-color'] =
        backgroundFill?.kind === 'color' ? backgroundFill.value : (fallbackSolidColor ?? normalized)
      delete processed.background
    } else if (removedFallback && splitByTopLevelComma(imageBackground).length === 1) {
      const parsed = parseBackgroundShorthand(imageBackground)

      if (parsed.image) processed['background-image'] = parsed.image
      if (parsed.size) processed['background-size'] = parsed.size
      if (parsed.repeat) processed['background-repeat'] = parsed.repeat
      if (parsed.position) processed['background-position'] = parsed.position

      delete processed.background
    }
  }

  if (
    node.type !== 'TEXT' &&
    !processed.background &&
    !processed['background-color'] &&
    activeFillPaints
  ) {
    if (backgroundLayers) {
      processed.background = backgroundLayers
    } else if (backgroundFill?.kind === 'color') {
      processed['background-color'] = backgroundFill.value
    } else if (fallbackSolidColor) {
      processed['background-color'] = fallbackSolidColor
    }
  }

  return processed
}

function getFillStyleId(node: SceneNode, ctx?: GetCodeCacheContext): string | null {
  if (ctx) return getNodeSemanticsCached(node, ctx).paint.fillStyleId
  if (!('fillStyleId' in node)) return null
  const styleId = node.fillStyleId
  return typeof styleId === 'string' && styleId.length > 0 ? styleId : null
}

function getNodeFills(node: SceneNode, ctx?: GetCodeCacheContext): ReadonlyArray<Paint> | null {
  if (ctx) return getPaintsFromState(getNodeSemanticsCached(node, ctx).paint.fillsState)
  if ('fills' in node && Array.isArray(node.fills)) {
    return node.fills
  }
  return null
}

function isPaintStyle(style: BaseStyle | null): style is PaintStyle {
  return !!style && 'paints' in style && Array.isArray(style.paints)
}

function isSolidPaint(paint: Paint): paint is SolidPaint {
  return paint.type === 'SOLID'
}

function isGradientPaint(paint: Paint): paint is GradientPaint {
  return 'gradientStops' in paint && Array.isArray(paint.gradientStops)
}

function findVisibleSolidPaint(paints: ReadonlyArray<Paint>): SolidPaint | null {
  const layers = getCssPaintLayers(paints)
  const paint = layers[0]?.paint
  if (!paint || !isSolidPaint(paint)) return null
  if (
    layers.length > 1 &&
    ((paint.opacity ?? 1) < 1 || (paint.blendMode !== undefined && paint.blendMode !== 'NORMAL'))
  )
    return null
  return paint
}

function getFillStylePaints(
  node: SceneNode,
  ctx?: GetCodeCacheContext
): ReadonlyArray<Paint> | null {
  const styleId = getFillStyleId(node, ctx)
  if (!styleId) return null

  if (ctx) {
    return getPaintStyleCached(styleId, ctx)?.paints ?? null
  }

  try {
    const style = figma.getStyleById(styleId)
    if (!isPaintStyle(style)) return null
    return style.paints
  } catch {
    return null
  }
}

function resolveSolidPaintColor(
  paint: SolidPaint,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  if (!paint.color) return null

  const bound = paint.boundVariables?.color
  if (bound && typeof bound === 'object' && 'id' in bound && bound.id) {
    try {
      const variable = readers.getVariableById(bound.id)
      if (variable) return getVariableCssExpr(variable)
    } catch {
      // noop
    }
  }

  return formatHexAlpha(paint.color, paint.opacity ?? 1)
}

function resolveGradientPaintValue(
  gradientPaint: GradientPaint,
  size?: PaintResolutionSize,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  return resolveGradientPaintCss(gradientPaint, size, readers, formatGradientStopColor)
}

function resolveGradientWithOpacity(
  value: string,
  fills: PaintList,
  readers: FigmaLookupReaders
): string | null {
  if (!value || !/gradient\(/i.test(value)) return null
  if (!fills) return null

  const layers = matchBackgroundPaintLayers(value, fills)
  // Match complete CSS layers, including synthetic solid gradients and images.
  // A partial native CSS stack cannot safely be paired by paint index.
  if (!layers) return null
  let changed = false
  const rewritten = layers.flatMap(({ paint: fill, sources: group }) => {
    if (!isRenderablePaint(fill) || !isGradientPaint(fill)) return group

    const fillOpacity = typeof fill.opacity === 'number' ? fill.opacity : 1
    const hasStopAlpha = fill.gradientStops.some((stop) => (stop.color?.a ?? 1) < 1)
    if (fillOpacity >= 0.99 && !hasStopAlpha) return group

    const resolved = resolveGradientPaintValue(fill, undefined, readers)
    return group.map((layer) => {
      const corrected = resolved ? preserveGradientGeometry(layer, resolved, fill.type) : null
      if (!corrected) return layer
      changed = true
      return corrected
    })
  })
  return changed ? rewritten.join(', ') : null
}

function formatGradientStopColor(
  stop: ColorStop,
  fillOpacity: number,
  readers: FigmaLookupReaders
): string {
  return stripFallback(formatPaintGradientStopColor(stop, fillOpacity, readers))
}

function isSolidBackground(value: string): boolean {
  if (!value) return false

  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^var\(\s*--[A-Za-z0-9_-]+\s*\)$/i.test(trimmed)) return true
  return canonicalizeColor(trimmed.toLowerCase()) !== null
}
