import type { GetCodeCacheContext, NodeSemanticSnapshot, PaintArrayState } from './types'

export function getNodeSemanticsCached(
  node: SceneNode,
  ctx: GetCodeCacheContext
): NodeSemanticSnapshot {
  const cached = ctx.nodeSemantics.get(node.id)
  if (cached) {
    if (ctx.metrics) ctx.metrics.nodeSemanticHits += 1
    return cached
  }

  if (ctx.metrics) ctx.metrics.nodeSemanticMisses += 1

  const fillsState = readPaintArrayState(node, 'fills')
  const strokesState = readPaintArrayState(node, 'strokes')
  const snapshot: NodeSemanticSnapshot = {
    id: node.id,
    type: node.type,
    paint: {
      fillsState,
      strokesState,
      fillStyleId: readStyleId(node, 'fillStyleId'),
      strokeStyleId: readStyleId(node, 'strokeStyleId'),
      hasVisibleFill: hasVisiblePaints(fillsState),
      hasVisibleStroke: hasVisiblePaints(strokesState),
      hasRenderableStroke: hasRenderableStrokes(node),
      hasImageFill: hasImageFill(fillsState),
      hasVisibleEffect: hasVisibleEffects(node)
    },
    layout: {
      layoutMode: readLayoutMode(node),
      inferredAutoLayout: readInferredAutoLayout(node),
      itemSpacing: readNumericLayoutValue(node, 'itemSpacing'),
      primaryAxisAlignItems: readStringLayoutValue(node, 'primaryAxisAlignItems'),
      counterAxisAlignItems: readStringLayoutValue(node, 'counterAxisAlignItems'),
      paddingTop: readNumericLayoutValue(node, 'paddingTop'),
      paddingRight: readNumericLayoutValue(node, 'paddingRight'),
      paddingBottom: readNumericLayoutValue(node, 'paddingBottom'),
      paddingLeft: readNumericLayoutValue(node, 'paddingLeft'),
      layoutSizingHorizontal: readLayoutSizing(node, 'layoutSizingHorizontal'),
      layoutSizingVertical: readLayoutSizing(node, 'layoutSizingVertical'),
      layoutAlign: readLayoutAlign(node),
      layoutPositioning: readLayoutPositioning(node),
      clipsContent: 'clipsContent' in node && node.clipsContent === true,
      isMask: 'isMask' in node && node.isMask === true
    },
    geometry: {
      relativeTransform: readRelativeTransform(node),
      constraints: readConstraints(node)
    }
  }

  ctx.nodeSemantics.set(node.id, snapshot)
  return snapshot
}

export function getPaintsFromState(state: PaintArrayState): readonly Paint[] | null {
  return state.kind === 'array' ? state.paints : null
}

function readPaintArrayState(node: SceneNode, key: 'fills' | 'strokes'): PaintArrayState {
  if (!(key in node)) return { kind: 'missing' }

  const value = (node as { fills?: unknown; strokes?: unknown })[key]
  if (value == null) return { kind: 'missing' }
  if (!Array.isArray(value)) return { kind: 'unsupported', value }
  return { kind: 'array', paints: value }
}

function readStyleId(node: SceneNode, key: 'fillStyleId' | 'strokeStyleId'): string | null {
  if (!(key in node)) return null
  const value = (node as { fillStyleId?: unknown; strokeStyleId?: unknown })[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readLayoutMode(node: SceneNode): NodeSemanticSnapshot['layout']['layoutMode'] {
  if (!('layoutMode' in node)) return null
  return node.layoutMode ?? null
}

function readInferredAutoLayout(
  node: SceneNode
): NodeSemanticSnapshot['layout']['inferredAutoLayout'] {
  if (!('inferredAutoLayout' in node)) return null
  return node.inferredAutoLayout ?? null
}

function readLayoutSizing(
  node: SceneNode,
  key: 'layoutSizingHorizontal' | 'layoutSizingVertical'
): NodeSemanticSnapshot['layout']['layoutSizingHorizontal'] {
  if (!(key in node)) return null
  const value = (node as { layoutSizingHorizontal?: string; layoutSizingVertical?: string })[key]
  return value === 'FIXED' || value === 'HUG' || value === 'FILL' ? value : null
}

function readNumericLayoutValue(
  node: SceneNode,
  key: 'itemSpacing' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
): number | null {
  if (!(key in node)) return null
  const value = (node as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}

function readStringLayoutValue(
  node: SceneNode,
  key: 'primaryAxisAlignItems' | 'counterAxisAlignItems'
): string | null {
  if (!(key in node)) return null
  const value = (node as unknown as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function readLayoutAlign(node: SceneNode): string | null {
  if (!('layoutAlign' in node)) return null
  return typeof node.layoutAlign === 'string' ? node.layoutAlign : null
}

function readLayoutPositioning(
  node: SceneNode
): NodeSemanticSnapshot['layout']['layoutPositioning'] {
  if (!('layoutPositioning' in node)) return null
  return node.layoutPositioning === 'AUTO' || node.layoutPositioning === 'ABSOLUTE'
    ? node.layoutPositioning
    : null
}

function readRelativeTransform(node: SceneNode): Transform | null {
  if (!('relativeTransform' in node)) return null
  return Array.isArray(node.relativeTransform) ? node.relativeTransform : null
}

function readConstraints(node: SceneNode): Constraints | null {
  if (!('constraints' in node)) return null
  return node.constraints ?? null
}

function hasVisiblePaints(state: PaintArrayState): boolean {
  if (state.kind !== 'array') return false
  return state.paints.some(isVisiblePaint)
}

function hasImageFill(state: PaintArrayState): boolean {
  if (state.kind !== 'array') return false
  return state.paints.some((paint) => paint.type === 'IMAGE' && paint.visible !== false)
}

function hasRenderableStrokes(node: SceneNode): boolean {
  const typed = node as {
    strokeWeight?: number | symbol
    strokeTopWeight?: number | symbol
    strokeRightWeight?: number | symbol
    strokeBottomWeight?: number | symbol
    strokeLeftWeight?: number | symbol
  }

  const uniform = typed.strokeWeight
  if (typeof uniform === 'number') return uniform > 0

  const perSide = [
    typed.strokeTopWeight,
    typed.strokeRightWeight,
    typed.strokeBottomWeight,
    typed.strokeLeftWeight
  ]
  const numeric = perSide.filter((value): value is number => typeof value === 'number')
  if (!numeric.length) return true
  return numeric.some((value) => value > 0)
}

function hasVisibleEffects(node: SceneNode): boolean {
  if (!('effects' in node)) return false
  const effects = (node as { effects?: unknown }).effects
  if (effects == null) return false
  if (!Array.isArray(effects)) return true

  return effects.some((effect) => {
    if (!effect || typeof effect !== 'object') return false
    return !('visible' in effect) || effect.visible !== false
  })
}

function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}
