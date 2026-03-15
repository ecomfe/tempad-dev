import type { NodeSnapshot, VisibleTree } from '../model'

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

export function analyzeVectorColorModel(tree: VisibleTree, rootId: string): VectorColorModel {
  const channels = new Set<string>()
  const colors = new Set<string>()
  let hasVisiblePaint = false
  const stack = [rootId]

  while (stack.length) {
    const id = stack.pop()
    if (!id) continue
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue

    if (breaksThemeable(snapshot)) return { kind: 'fixed' }

    for (const kind of PAINT_KINDS) {
      const nextChannels = collectPaintChannels(snapshot.node, kind)
      if (!nextChannels) return { kind: 'fixed' }
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
    return { kind: 'fixed' }
  }

  return {
    kind: 'single-channel',
    color: Array.from(colors)[0]!
  }
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
  kind: (typeof PAINT_KINDS)[number]
): PaintChannel[] | null {
  if (!(kind in node)) return []

  const paints = (node as { fills?: unknown; strokes?: unknown })[kind]
  if (paints == null) return []
  if (!Array.isArray(paints)) return null
  if (kind === 'strokes' && !hasRenderableStrokes(node)) {
    return []
  }

  const styleChannel = resolveStylePaintChannel(node, kind)
  const visiblePaints = paints.filter(isVisiblePaint)
  const channels: PaintChannel[] = []
  for (const paint of visiblePaints) {
    if (!isVisiblePaint(paint)) continue
    if (paint.type !== 'SOLID' || !paint.color) {
      return null
    }
    const channel =
      styleChannel && visiblePaints.length === 1 ? styleChannel : resolvePaintChannel(paint)
    if (!channel) return null
    channels.push(channel)
  }

  return channels
}

function resolvePaintChannel(paint: SolidPaint): PaintChannel | null {
  return resolveSolidPaintChannel(paint)
}

function isMaskNode(node: SceneNode): boolean {
  return 'isMask' in node && node.isMask === true
}
