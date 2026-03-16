import type { NodeSnapshot, VisibleTree } from '../model'

import {
  type PaintAnalysisOptions,
  type PaintChannel,
  hasRenderableStrokes,
  hasVisibleEffects,
  isVisiblePaint,
  resolveSolidPaintChannel,
  resolveStylePaintChannel
} from './paint'

const PAINT_KINDS = ['fills', 'strokes'] as const

export type VectorColorModel = { kind: 'fixed' } | { kind: 'single-channel'; color: string }

export type VectorAnalysisContext = PaintAnalysisOptions & {
  colorModelByRoot: Map<string, VectorColorModel>
}

export function createVectorAnalysisContext(
  variableCache?: Map<string, Variable | null>
): VectorAnalysisContext {
  return {
    colorModelByRoot: new Map<string, VectorColorModel>(),
    styleChannelCache: new Map<string, PaintChannel | null>(),
    variableCache
  }
}

export function analyzeVectorColorModel(
  tree: VisibleTree,
  rootId: string,
  context?: VectorAnalysisContext
): VectorColorModel {
  const cached = context?.colorModelByRoot.get(rootId)
  if (cached) return cached

  const channels = new Set<string>()
  const colors = new Set<string>()
  let hasVisiblePaint = false
  const stack = [rootId]

  while (stack.length) {
    const id = stack.pop()
    if (!id) continue
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue

    if (breaksThemeable(snapshot)) {
      return cacheColorModel(context, rootId, { kind: 'fixed' })
    }

    for (const kind of PAINT_KINDS) {
      const nextChannels = collectPaintChannels(snapshot.node, kind, context)
      if (!nextChannels) {
        return cacheColorModel(context, rootId, { kind: 'fixed' })
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
    return cacheColorModel(context, rootId, { kind: 'fixed' })
  }

  return cacheColorModel(context, rootId, {
    kind: 'single-channel',
    color: Array.from(colors)[0]!
  })
}

function breaksThemeable(snapshot: NodeSnapshot): boolean {
  return (
    snapshot.type === 'TEXT' ||
    snapshot.assetKind === 'image' ||
    isMaskNode(snapshot.node) ||
    hasVisibleEffects(snapshot.node)
  )
}

function collectPaintChannels(
  node: SceneNode,
  kind: (typeof PAINT_KINDS)[number],
  context?: VectorAnalysisContext
): PaintChannel[] | null {
  if (!(kind in node)) return []

  const paints = (node as { fills?: unknown; strokes?: unknown })[kind]
  if (paints == null) return []
  if (!Array.isArray(paints)) return null
  if (kind === 'strokes' && !hasRenderableStrokes(node)) {
    return []
  }

  const visiblePaints = paints.filter(isVisiblePaint)
  if (!visiblePaints.length) return []

  const styleChannel =
    visiblePaints.length === 1
      ? resolveStylePaintChannel(node, kind, {
          styleChannelCache: context?.styleChannelCache,
          variableCache: context?.variableCache
        })
      : null
  const channels: PaintChannel[] = []
  for (const paint of visiblePaints) {
    if (paint.type !== 'SOLID' || !paint.color) {
      return null
    }
    const channel = styleChannel ?? resolvePaintChannel(paint, context)
    if (!channel) return null
    channels.push(channel)
  }

  return channels
}

function resolvePaintChannel(
  paint: SolidPaint,
  context?: VectorAnalysisContext
): PaintChannel | null {
  return resolveSolidPaintChannel(paint, context?.variableCache)
}

function isMaskNode(node: SceneNode): boolean {
  return 'isMask' in node && node.isMask === true
}

function cacheColorModel(
  context: VectorAnalysisContext | undefined,
  rootId: string,
  result: VectorColorModel
): VectorColorModel {
  context?.colorModelByRoot.set(rootId, result)
  return result
}
