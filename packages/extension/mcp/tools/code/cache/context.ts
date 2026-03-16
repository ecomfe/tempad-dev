import { resolveSolidFromPaints } from '@tempad-dev/shared'

import type { CacheMetrics, GetCodeCacheContext, PaintStyleSummary } from './types'

const DEFAULT_METRICS = (): CacheMetrics => ({
  nodeSemanticHits: 0,
  nodeSemanticMisses: 0,
  styleHits: 0,
  styleMisses: 0,
  paintStyleHits: 0,
  paintStyleMisses: 0,
  variableHits: 0,
  variableMisses: 0,
  vectorAnalysisHits: 0,
  vectorAnalysisMisses: 0,
  vectorExportCandidates: 0,
  vectorExportSkippedMissing: 0,
  vectorExportSkippedZeroBounds: 0,
  vectorExportNull: 0,
  vectorExportUploaded: 0,
  vectorExportThemeableInline: 0,
  vectorExportRawInline: 0
})

export function createGetCodeCacheContext(
  variableCache = new Map<string, Variable | null>(),
  options?: { metrics?: boolean }
): GetCodeCacheContext {
  const ctx = {
    variables: variableCache,
    styles: new Map<string, BaseStyle | null>(),
    paintStyles: new Map<string, PaintStyleSummary | null>(),
    nodeSemantics: new Map(),
    vectorAnalysis: new Map(),
    metrics: options?.metrics ? DEFAULT_METRICS() : undefined
  } as GetCodeCacheContext

  ctx.readers = {
    getStyleById: (id: string) => getStyleByIdFromContext(id, ctx),
    getVariableById: (id: string) => getVariableByIdFromContext(id, ctx)
  }

  return ctx
}

export function getVariableByIdFromContext(id: string, ctx: GetCodeCacheContext): Variable | null {
  if (ctx.variables.has(id)) {
    if (ctx.metrics) ctx.metrics.variableHits += 1
    return ctx.variables.get(id) ?? null
  }

  if (ctx.metrics) ctx.metrics.variableMisses += 1
  const variable = figma.variables.getVariableById(id)
  ctx.variables.set(id, variable ?? null)
  return variable ?? null
}

export function getStyleByIdFromContext(id: string, ctx: GetCodeCacheContext): BaseStyle | null {
  if (ctx.styles.has(id)) {
    if (ctx.metrics) ctx.metrics.styleHits += 1
    return ctx.styles.get(id) ?? null
  }

  if (ctx.metrics) ctx.metrics.styleMisses += 1
  const style = figma.getStyleById(id)
  ctx.styles.set(id, style ?? null)
  return style ?? null
}

export function getPaintStyleCached(
  styleId: string | null,
  ctx: GetCodeCacheContext
): PaintStyleSummary | null {
  if (!styleId) return null
  if (ctx.paintStyles.has(styleId)) {
    if (ctx.metrics) ctx.metrics.paintStyleHits += 1
    return ctx.paintStyles.get(styleId) ?? null
  }

  if (ctx.metrics) ctx.metrics.paintStyleMisses += 1

  const style = getStyleByIdFromContext(styleId, ctx)
  if (!style || !('paints' in style) || !Array.isArray(style.paints)) {
    ctx.paintStyles.set(styleId, null)
    return null
  }

  const visiblePaints = style.paints.filter(isVisiblePaint)
  const singleVisiblePaint = visiblePaints.length === 1 ? (visiblePaints[0] ?? null) : null
  const singleVisibleSolidPaint =
    singleVisiblePaint?.type === 'SOLID' && singleVisiblePaint.color ? singleVisiblePaint : null

  const summary: PaintStyleSummary = {
    id: styleId,
    paints: style.paints,
    visiblePaintCount: visiblePaints.length,
    singleVisiblePaint,
    singleVisibleSolidPaint,
    singleVisibleSolidColor: singleVisibleSolidPaint
      ? resolveSolidFromPaints([singleVisibleSolidPaint], ctx.readers)
      : null
  }

  ctx.paintStyles.set(styleId, summary)
  return summary
}

function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}
