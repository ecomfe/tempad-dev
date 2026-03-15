import { formatHexAlpha } from '@tempad-dev/shared'

import { canonicalizeVarName, toFigmaVarExpr } from '@/utils/css'

import type { NodeSnapshot, VisibleTree } from '../model'

const PAINT_KINDS = ['fills', 'strokes'] as const

export type VectorColorModel = { kind: 'fixed' } | { kind: 'single-channel'; color: string }

type PaintChannel = {
  key: string
  color: string
}

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
  const token = resolveVariableColor(paint.boundVariables?.color)
  if (token) {
    return {
      key: `var:${token}`,
      color: token
    }
  }

  if (!paint.color) return null
  const color = formatHexAlpha(paint.color, 1)
  return {
    key: `literal:${color.toLowerCase()}`,
    color
  }
}

function resolveStylePaintChannel(
  node: SceneNode,
  kind: (typeof PAINT_KINDS)[number]
): PaintChannel | null {
  const styleId = getPaintStyleId(node, kind)
  if (!styleId) return null

  try {
    const style = figma.getStyleById(styleId)
    if (!style || !('paints' in style) || !Array.isArray(style.paints)) return null

    const visible = style.paints.filter(isVisiblePaint)
    if (visible.length !== 1) return null
    const paint = visible[0]
    if (paint.type !== 'SOLID' || !paint.color) return null

    const token = resolveVariableColor(paint.boundVariables?.color)
    if (token) {
      return {
        key: `var:${token}`,
        color: token
      }
    }

    const color = formatHexAlpha(paint.color, 1)
    return {
      key: `literal:${color.toLowerCase()}`,
      color
    }
  } catch {
    return null
  }
}

function getPaintStyleId(node: SceneNode, kind: (typeof PAINT_KINDS)[number]): string | null {
  const key = kind === 'fills' ? 'fillStyleId' : 'strokeStyleId'
  if (!(key in node)) return null
  const styleId = (node as { fillStyleId?: unknown; strokeStyleId?: unknown })[key]
  return typeof styleId === 'string' && styleId.length > 0 ? styleId : null
}

function resolveVariableColor(alias?: { id?: string } | null): string | null {
  if (!alias?.id) return null
  try {
    const variable = figma.variables.getVariableById(alias.id)
    if (!variable) return null
    return toFigmaVarExpr(getVariableRawName(variable))
  } catch {
    return null
  }
}

function getVariableRawName(variable: Variable): string {
  const codeSyntax = variable.codeSyntax?.WEB
  if (typeof codeSyntax === 'string' && codeSyntax.trim()) {
    const canonical = canonicalizeVarName(codeSyntax.trim())
    if (canonical) return canonical.slice(2)

    const identifier = codeSyntax.trim()
    if (/^[A-Za-z0-9_-]+$/.test(identifier)) return identifier
  }

  const raw = variable.name?.trim?.() ?? ''
  if (raw.startsWith('--')) return raw.slice(2)
  return raw
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
    const visible = 'visible' in effect ? effect.visible !== false : true
    return visible
  })
}

function isMaskNode(node: SceneNode): boolean {
  return 'isMask' in node && node.isMask === true
}

function isVisiblePaint(paint: Paint | null | undefined): paint is Paint {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}
