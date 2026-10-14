import type { NodeSnapshot, VisibleTree } from '../model'

import { isFlowGroup } from '../layout-parent'

type StyleMap = Map<string, Record<string, string>>

const BLEND_STACKING_CONTEXTS = new Set([
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-lighter'
])

export function applyAbsoluteStackingOrder(
  tree: VisibleTree,
  styles: StyleMap,
  svgRoots?: Set<string>
): void {
  const transparentGroups = new Set<string>()
  const sharedOrderGroups = new Set<string>()
  for (const id of [...tree.order].reverse()) {
    const node = tree.nodes.get(id)
    if (!node || svgRoots?.has(id)) continue
    const style = styles.get(id)
    if (
      node.node.type === 'GROUP' &&
      node.node.blendMode === 'NORMAL' &&
      style &&
      style.isolation === undefined &&
      (style.display === undefined ||
        /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|flow-root|list-item|table|inline-table)$/.test(
          style.display
        ))
    ) {
      // Native NORMAL groups stop descendant blending at the group boundary.
      // Isolation preserves that boundary without rebasing absolute descendants.
      styles.set(id, { ...style, isolation: 'isolate' })
    }
    if (
      isStructuralGroup(node, tree, styles) &&
      node.children.every(
        (childId) => transparentGroups.has(childId) || isAbsolute(styles.get(childId))
      )
    )
      transparentGroups.add(id)
    if (
      isStructuralGroup(node, tree, styles, true) &&
      node.children.every(
        (childId) =>
          sharedOrderGroups.has(childId) ||
          isAbsolute(styles.get(childId)) ||
          hasStaticStackingContext(styles.get(childId)) ||
          canPositionCompositingGroup(styles.get(childId))
      )
    )
      sharedOrderGroups.add(id)
  }
  tree.rootIds.forEach((rootId) =>
    visit(rootId, tree, styles, transparentGroups, sharedOrderGroups)
  )
}

function visit(
  nodeId: string,
  tree: VisibleTree,
  styles: StyleMap,
  transparentGroups: Set<string>,
  sharedOrderGroups: Set<string>
): void {
  const node = tree.nodes.get(nodeId)
  if (!node) return

  let children = node.children ?? []
  const groups: string[] = []
  const paintChildren: string[] = []
  const append = (id: string) => {
    const child = tree.nodes.get(id)
    if (child && transparentGroups.has(id)) {
      groups.push(id)
      child.children.forEach(append)
    } else paintChildren.push(id)
  }
  children.forEach(append)
  if (groups.length) {
    if (children.every((id) => transparentGroups.has(id) || isAbsolute(styles.get(id)))) {
      // Boxless groups retain inheritance, DOM hints and event bubbling without
      // changing the containing block or creating an invisible pointer surface.
      for (const id of groups) styles.set(id, { ...styles.get(id), display: 'contents' })
    }
    // Absolute descendants paint in the outer context even when transparent
    // group boxes must remain in flow to keep compositing siblings in place.
    children = paintChildren
  }
  const reverse =
    'layoutMode' in node.node &&
    node.node.layoutMode !== 'NONE' &&
    node.node.itemReverseZIndex === true
  const mixed =
    children.some((id) => isAbsolute(styles.get(id))) &&
    children.some((id) => !isAbsolute(styles.get(id)))
  if (children.length > 1 && (mixed || reverse)) {
    const parentStyle = styles.get(nodeId) ?? {}
    const flexOrGrid = /^(inline-)?(flex|grid)$/.test(parentStyle.display ?? '')
    // Preserve structural groups' containing blocks. A direct transform or filter
    // already establishes one, so positioning that box cannot rebase descendants.
    const unpositionedGroups = flexOrGrid
      ? []
      : children.filter((id) => {
          const type = tree.nodes.get(id)?.type
          const position = styles.get(id)?.position
          return (
            (type === 'GROUP' || type === 'BOOLEAN_OPERATION') &&
            (!position || position === 'static') &&
            !(type === 'GROUP' && canPositionCompositingGroup(styles.get(id)))
          )
        })
    const rankAll = unpositionedGroups.length === 0
    // A bound opacity can stop creating a stacking context in another mode.
    // Keep its structural subtree at the natural paint level: z-index: 0 would
    // isolate descendant blending even when opacity resolves to 1.
    const shareNaturalOrder =
      !reverse &&
      !flexOrGrid &&
      (sharedOrderGroups.has(nodeId) ||
        (unpositionedGroups.some((id) => sharedOrderGroups.has(id)) &&
          unpositionedGroups.every(
            (id) => sharedOrderGroups.has(id) || hasStaticStackingContext(styles.get(id))
          )))
    // Opacity, isolation and blending create level-zero stacking contexts without
    // a containing block. Keep those groups static and paint their siblings at
    // the same level; positioning the groups would move absolute descendants.
    const shareZeroLevel =
      !rankAll &&
      !reverse &&
      unpositionedGroups.every((id) => hasStaticStackingContext(styles.get(id)))
    const lastFlowIndex = children.findLastIndex((id) => !isAbsolute(styles.get(id)))
    let needsIsolation = !shareNaturalOrder && (rankAll || shareZeroLevel)
    for (const [index, childId] of children.entries()) {
      const style = styles.get(childId)
      if (shareNaturalOrder) {
        const type = tree.nodes.get(childId)?.type
        if (
          style &&
          type !== 'GROUP' &&
          type !== 'BOOLEAN_OPERATION' &&
          (!style.position || style.position === 'static') &&
          (!style['z-index'] || style['z-index'] === 'auto')
        )
          styles.set(childId, { ...style, position: 'relative' })
        continue
      }
      if (shareZeroLevel && unpositionedGroups.includes(childId)) continue
      if (!rankAll && !shareZeroLevel && (!isAbsolute(style) || index >= lastFlowIndex)) continue
      needsIsolation = true
      if (!style || (style['z-index'] && style['z-index'] !== 'auto')) continue
      // Rank flow items too: putting every absolute item below the flow loses
      // interleaved paint order. Plain block items need positioning for z-index.
      const paintIndex = reverse ? children.length - index - 1 : index
      styles.set(childId, {
        ...style,
        ...((rankAll || shareZeroLevel) &&
        !flexOrGrid &&
        (!style.position || style.position === 'static')
          ? { position: 'relative' }
          : {}),
        'z-index': String(shareZeroLevel ? 0 : rankAll ? paintIndex : -1)
      })
    }
    if (needsIsolation && !sharedOrderGroups.has(nodeId) && !parentStyle.isolation)
      styles.set(nodeId, { ...parentStyle, isolation: 'isolate' })
  }

  children.forEach((childId) => visit(childId, tree, styles, transparentGroups, sharedOrderGroups))
}

function hasStaticStackingContext(style?: Record<string, string>): boolean {
  if (style?.isolation === 'isolate') return true
  if (BLEND_STACKING_CONTEXTS.has(style?.['mix-blend-mode']?.trim() ?? '')) return true
  const opacity = style?.opacity?.trim()
  return !!opacity && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(opacity) && Number(opacity) < 1
}

function canPositionCompositingGroup(style?: Record<string, string>): boolean {
  if (!style || style['z-index'] !== undefined) return false
  if (Object.keys(style).some((key) => /^(?:top|right|bottom|left)$|^inset(?:-|$)/.test(key)))
    return false
  // Only direct native CSS functions prove a containing block here. Custom
  // properties and inherited values can resolve to `none` and must keep fallback.
  const direct = (value: string | undefined, functions: RegExp) =>
    !!value && functions.test(value) && !/\b(?:var|env)\(/.test(value)
  return (
    direct(
      style.transform,
      /^(?:matrix(?:3d)?|translate(?:[XYZ]|3d)?|scale(?:[XYZ]|3d)?|rotate(?:[XYZ]|3d)?|skew[XY]?|perspective)\(/
    ) ||
    direct(style.filter, /^(?:blur|drop-shadow)\(/) ||
    direct(style['backdrop-filter'], /^(?:blur|drop-shadow)\(/)
  )
}

function isStructuralGroup(
  snapshot: NodeSnapshot,
  tree: VisibleTree,
  styles: StyleMap,
  allowBoundCompositing = false
): boolean {
  const node = snapshot.node
  const style = styles.get(snapshot.id)
  if (
    node.type !== 'GROUP' ||
    !snapshot.children.length ||
    !style ||
    isFlowGroup(tree, snapshot) ||
    snapshot.autoLayoutHint
  )
    return false
  const boundOpacity =
    allowBoundCompositing && !!node.boundVariables?.opacity && /\bvar\(/.test(style.opacity ?? '')
  const boundEffect =
    allowBoundCompositing &&
    !!node.effects?.some(
      (effect) =>
        effect.visible !== false &&
        'boundVariables' in effect &&
        effect.boundVariables &&
        Object.keys(effect.boundVariables).length > 0
    )
  const boundCompositing = boundOpacity || boundEffect
  if (node.opacity !== undefined && node.opacity !== 1 && !boundOpacity) return false
  if (node.blendMode !== undefined && node.blendMode !== 'PASS_THROUGH') return false
  if (
    node.isMask ||
    (!boundCompositing && node.effects?.some((effect) => effect.visible !== false))
  )
    return false
  if ('clipsContent' in node && node.clipsContent) return false
  const transform = node.relativeTransform
  if (
    !boundCompositing &&
    transform &&
    (transform[0][0] !== 1 ||
      transform[0][1] !== 0 ||
      transform[1][0] !== 0 ||
      transform[1][1] !== 1)
  )
    return false
  return Object.entries(style).every(
    ([property, value]) =>
      property === 'width' ||
      property === 'height' ||
      property === 'pointer-events' ||
      (property === 'position' && value === 'static') ||
      (property === 'display' && (value === 'block' || value === 'contents')) ||
      (property === 'opacity' && (value === '1' || boundOpacity)) ||
      (boundCompositing &&
        (property === 'transform' ||
          property === 'filter' ||
          property === 'backdrop-filter' ||
          property === 'z-index' ||
          /^(?:top|right|bottom|left)$|^inset(?:-|$)/.test(property) ||
          (property === 'isolation' && value === 'auto')))
  )
}

function isAbsolute(style?: Record<string, string>): boolean {
  return style?.position?.toLowerCase() === 'absolute'
}
