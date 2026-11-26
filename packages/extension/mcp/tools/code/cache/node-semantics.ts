import { isVisibleMediaPaint } from '@/mcp/media'
import { readFigma3d } from '@/utils/figma-3d'
import { isRenderablePaint } from '@/utils/figma-paint'

import type { GetCodeCacheContext, NodeSemanticSnapshot, PaintArrayState } from './types'

import { getInferredAutoLayout } from '../layout-parent'
import { computeChildOverflow } from '../styles/overflow'

export function getChildOverflowCached(
  node: SceneNode,
  ctx: GetCodeCacheContext,
  checkpoint = ctx.checkpoint
): { x: boolean; y: boolean } {
  checkpoint?.()
  const cached = ctx.childOverflow.get(node)
  if (cached) return cached
  const overflow = computeChildOverflow(node, checkpoint)
  ctx.childOverflow.set(node, overflow)
  return overflow
}

export function getNodeSemanticsCached(
  node: SceneNode,
  ctx: GetCodeCacheContext
): NodeSemanticSnapshot {
  ctx.checkpoint?.()
  const id = node.id
  const cached = ctx.nodeSemantics.get(id)
  if (cached) {
    if (ctx.metrics) ctx.metrics.nodeSemanticHits += 1
    return cached
  }

  if (ctx.metrics) ctx.metrics.nodeSemanticMisses += 1

  let paint: NodeSemanticSnapshot['paint'] | undefined
  let layout: NodeSemanticSnapshot['layout'] | undefined
  let geometry: NodeSemanticSnapshot['geometry'] | undefined
  let isMask: boolean | undefined
  const snapshot: NodeSemanticSnapshot = {
    get paint() {
      return (paint ??= readPaintSemantics(node))
    },
    get layout() {
      return (layout ??= readLayoutSemantics(node, ctx))
    },
    get geometry() {
      return (geometry ??= readGeometrySemantics(node))
    },
    get isMask() {
      return (isMask ??= 'isMask' in node && node.isMask === true)
    }
  }

  ctx.nodeSemantics.set(id, snapshot)
  return snapshot
}

function readPaintSemantics(node: SceneNode): NodeSemanticSnapshot['paint'] {
  const fillsState = readPaintArrayState(node, 'fills')
  const strokesState = readPaintArrayState(node, 'strokes')
  return {
    fillsState,
    strokesState,
    fillStyleId: readStyleId(node, 'fillStyleId'),
    strokeStyleId: readStyleId(node, 'strokeStyleId'),
    hasVisibleFill: hasVisiblePaints(fillsState),
    hasVisibleStroke: hasVisiblePaints(strokesState),
    hasRenderableStroke: hasRenderableStrokes(node),
    hasMediaFill: hasMediaFill(fillsState),
    hasVisibleEffect: hasVisibleEffects(node)
  }
}

function readLayoutSemantics(
  node: SceneNode,
  ctx: GetCodeCacheContext
): NodeSemanticSnapshot['layout'] {
  const layoutMode = readLayoutMode(node)
  const clipsContent = 'clipsContent' in node && node.clipsContent === true
  let overflow: NodeSemanticSnapshot['layout']['childOverflow'] | undefined
  let inferred: NodeSemanticSnapshot['layout']['inferredAutoLayout'] | undefined
  return {
    layoutMode,
    clipsContent,
    get childOverflow() {
      return (overflow ??= clipsContent
        ? getChildOverflowCached(node, ctx)
        : { x: false, y: false })
    },
    get clippedOverflow() {
      return clipsContent && layoutMode === 'NONE' && (this.childOverflow.x || this.childOverflow.y)
    },
    get inferredAutoLayout() {
      if (inferred === undefined) {
        inferred = getInferredAutoLayout(node, this.clippedOverflow, ctx.checkpoint)
      }
      return inferred
    },
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
    layoutPositioning: readLayoutPositioning(node)
  }
}

function readGeometrySemantics(node: SceneNode): NodeSemanticSnapshot['geometry'] {
  let relativeTransform: Transform | null | undefined
  let constraints: Constraints | null | undefined
  return {
    threeD: readFigma3d(node),
    get relativeTransform() {
      if (relativeTransform === undefined) relativeTransform = readRelativeTransform(node)
      return relativeTransform
    },
    get constraints() {
      if (constraints === undefined) constraints = readConstraints(node)
      return constraints
    }
  }
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
  const value = node.layoutAlign
  return typeof value === 'string' ? value : null
}

function readLayoutPositioning(
  node: SceneNode
): NodeSemanticSnapshot['layout']['layoutPositioning'] {
  if (!('layoutPositioning' in node)) return null
  const value = node.layoutPositioning
  return value === 'AUTO' || value === 'ABSOLUTE' ? value : null
}

function readRelativeTransform(node: SceneNode): Transform | null {
  if (!('relativeTransform' in node)) return null
  const value = node.relativeTransform
  return Array.isArray(value) ? value : null
}

function readConstraints(node: SceneNode): Constraints | null {
  if (!('constraints' in node)) return null
  return node.constraints ?? null
}

function hasVisiblePaints(state: PaintArrayState): boolean {
  if (state.kind !== 'array') return false
  return state.paints.some(isRenderablePaint)
}

function hasMediaFill(state: PaintArrayState): boolean {
  if (state.kind !== 'array') return false
  return state.paints.some(isVisibleMediaPaint)
}

export function hasRenderableStrokes(node: SceneNode): boolean {
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

export function hasVisibleEffects(node: SceneNode): boolean {
  if (!('effects' in node)) return false
  const effects = (node as { effects?: unknown }).effects
  if (effects == null) return false
  if (!Array.isArray(effects)) return true

  return effects.some((effect) => {
    if (!effect || typeof effect !== 'object') return false
    return !('visible' in effect) || effect.visible !== false
  })
}
