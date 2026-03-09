import { formatHexAlpha } from '@tempad-dev/shared'

import type { NodeSnapshot, VisibleTree } from '../model'

const PAINT_KINDS = ['fills', 'strokes'] as const

export function isThemeableVector(tree: VisibleTree, rootId: string): boolean {
  const colors = new Set<string>()
  let hasVisiblePaint = false
  const stack = [rootId]

  while (stack.length) {
    const id = stack.pop()
    if (!id) continue
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue

    if (breaksThemeable(snapshot)) return false

    for (const kind of PAINT_KINDS) {
      const keys = collectColorKeys(snapshot.node, kind)
      if (!keys) return false
      if (!keys.length) continue
      hasVisiblePaint = true
      keys.forEach((key) => colors.add(key))
    }

    stack.push(...snapshot.children)
  }

  return hasVisiblePaint && colors.size === 1
}

function breaksThemeable(snapshot: NodeSnapshot): boolean {
  return (
    snapshot.type === 'TEXT' ||
    snapshot.assetKind === 'image' ||
    isMaskNode(snapshot.node) ||
    hasVisibleEffects(snapshot.node)
  )
}

function collectColorKeys(node: SceneNode, kind: (typeof PAINT_KINDS)[number]): string[] | null {
  if (!(kind in node)) return []

  const paints = (node as { fills?: unknown; strokes?: unknown })[kind]
  if (paints == null) return []
  if (!Array.isArray(paints)) return null
  if (kind === 'strokes' && !hasRenderableStrokes(node)) {
    return []
  }

  const keys: string[] = []
  for (const paint of paints) {
    if (!isVisiblePaint(paint)) continue
    if (paint.type !== 'SOLID' || !paint.color) {
      return null
    }
    keys.push(formatHexAlpha(paint.color, 1).toLowerCase())
  }

  return keys
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
