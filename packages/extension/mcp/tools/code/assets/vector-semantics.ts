import type { GetCodeCacheContext } from '../cache'
import type { NodeSnapshot, VisibleTree } from '../model'

import { getNodeSemanticsCached, getPaintsFromState } from '../cache'
import {
  type PaintChannel,
  hasRenderableStrokes,
  hasVisibleEffects,
  isVisiblePaint,
  resolveSolidPaintChannel,
  resolveStylePaintChannel
} from './paint'

const PAINT_KINDS = ['fills', 'strokes'] as const

export type VectorColorModel = { kind: 'fixed' } | { kind: 'single-channel'; color: string }

export function analyzeVectorColorModel(
  tree: VisibleTree,
  rootId: string,
  ctx?: GetCodeCacheContext
): VectorColorModel {
  const cached = ctx?.vectorAnalysis.get(rootId)
  if (cached) {
    if (ctx?.metrics) ctx.metrics.vectorAnalysisHits += 1
    return cached
  }
  if (ctx?.metrics) ctx.metrics.vectorAnalysisMisses += 1

  const channels = new Set<string>()
  const colors = new Set<string>()
  let hasVisiblePaint = false
  const stack = [rootId]

  while (stack.length) {
    const id = stack.pop()
    if (!id) continue
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue

    if (breaksThemeable(snapshot, ctx)) {
      return cacheColorModel(ctx, rootId, { kind: 'fixed' })
    }

    for (const kind of PAINT_KINDS) {
      const nextChannels = collectPaintChannels(snapshot.node, kind, ctx)
      if (!nextChannels) {
        return cacheColorModel(ctx, rootId, { kind: 'fixed' })
      }
      if (!nextChannels.length) continue
      hasVisiblePaint = true
      nextChannels.forEach((channel) => {
        channels.add(channel.key)
        colors.add(channel.color)
      })
    }

    stack.push(...snapshot.children)
  }

  if (!hasVisiblePaint || channels.size !== 1 || colors.size !== 1) {
    return cacheColorModel(ctx, rootId, { kind: 'fixed' })
  }

  return cacheColorModel(ctx, rootId, {
    kind: 'single-channel',
    color: Array.from(colors)[0]!
  })
}

function breaksThemeable(snapshot: NodeSnapshot, ctx?: GetCodeCacheContext): boolean {
  const semantics = ctx ? getNodeSemanticsCached(snapshot.node, ctx) : null
  return (
    snapshot.type === 'TEXT' ||
    snapshot.assetKind === 'image' ||
    semantics?.layout.isMask === true ||
    (!semantics && isMaskNode(snapshot.node)) ||
    hasVisibleEffects(snapshot.node, ctx)
  )
}

function collectPaintChannels(
  node: SceneNode,
  kind: (typeof PAINT_KINDS)[number],
  ctx?: GetCodeCacheContext
): PaintChannel[] | null {
  const semantics = ctx ? getNodeSemanticsCached(node, ctx) : null
  const paintsState =
    semantics == null
      ? null
      : kind === 'fills'
        ? semantics.paint.fillsState
        : semantics.paint.strokesState

  if (paintsState?.kind === 'unsupported') return null
  const paints = paintsState == null ? readLivePaints(node, kind) : getPaintsFromState(paintsState)
  if (paints == null) return []
  if (kind === 'strokes' && !(semantics?.paint.hasRenderableStroke ?? hasRenderableStrokes(node))) {
    return []
  }

  const visiblePaints = paints.filter(isVisiblePaint)
  const styleChannel = visiblePaints.length === 1 ? resolveStylePaintChannel(node, kind, ctx) : null
  const channels: PaintChannel[] = []
  for (const paint of visiblePaints) {
    if (paint.type !== 'SOLID' || !paint.color) {
      return null
    }
    const channel = styleChannel ?? resolvePaintChannel(paint, ctx)
    if (!channel) return null
    channels.push(channel)
  }

  return channels
}

function readLivePaints(
  node: SceneNode,
  kind: (typeof PAINT_KINDS)[number]
): Paint[] | ReadonlyArray<Paint> | null {
  if (!(kind in node)) return null
  const paints = (node as { fills?: unknown; strokes?: unknown })[kind]
  return Array.isArray(paints) ? paints : null
}

function resolvePaintChannel(paint: SolidPaint, ctx?: GetCodeCacheContext): PaintChannel | null {
  return resolveSolidPaintChannel(paint, ctx)
}

function isMaskNode(node: SceneNode): boolean {
  return 'isMask' in node && node.isMask === true
}

function cacheColorModel(
  ctx: GetCodeCacheContext | undefined,
  rootId: string,
  value: VectorColorModel
): VectorColorModel {
  ctx?.vectorAnalysis.set(rootId, value)
  return value
}
