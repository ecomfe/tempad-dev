import type { CanvasNodeSpec } from '../model'

import { specError } from '../errors'
import { reportCanvasPlacement } from '../feedback'
import { CANVAS_KEY_NAMESPACE, CANVAS_COUNTER_AXIS_SYNC_NAME } from '../identity'
import { currentBoundVariableId } from './binding-values'
import { GEOMETRY_TOLERANCE, transformsMatch, finiteRect } from './comparison'
import { isIntrinsicNode, isFrameContainer, isSupportedSceneNode, walkSpecs } from './nodes'
import {
  type CanvasFrameContainerNode,
  type ApplyState,
  setValue,
  markMutation,
  type SupportedCanvasNode,
  type CanvasParentNode
} from './state'

const ROOT_PLACEMENT_GAP = 80

const PADDING_FIELDS = [
  ['top', 'paddingTop'],
  ['right', 'paddingRight'],
  ['bottom', 'paddingBottom'],
  ['left', 'paddingLeft']
] as const

function applyCounterAxisSpacing(
  node: CanvasFrameContainerNode,
  desired: number | null | undefined,
  state: ApplyState
): void {
  if (desired === undefined) return
  const synced =
    node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_COUNTER_AXIS_SYNC_NAME) === 'true'
  if (desired !== null) {
    setValue(
      node,
      synced ? undefined : node.counterAxisSpacing,
      desired,
      (value) => (node.counterAxisSpacing = value),
      state
    )
    if (synced) {
      node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_COUNTER_AXIS_SYNC_NAME, '')
      markMutation(state, node)
    }
    return
  }

  if (!synced || !Object.is(node.counterAxisSpacing, node.itemSpacing)) {
    node.counterAxisSpacing = null
    markMutation(state, node)
  }
  if (!synced) {
    node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_COUNTER_AXIS_SYNC_NAME, 'true')
    markMutation(state, node)
  }
}

export function applyLayout(
  node: CanvasFrameContainerNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const layout = spec.layout
  if (!layout) return
  const bindings = spec.variables

  setValue(node, node.layoutMode, layout.mode, (value) => (node.layoutMode = value), state)
  if (layout.mode === 'NONE') return

  if (layout.padding !== undefined) {
    for (const [side, field] of PADDING_FIELDS) {
      const desired = typeof layout.padding === 'number' ? layout.padding : layout.padding[side]
      setValue(
        node,
        node[field],
        bindings?.[field] || currentBoundVariableId(node, field) ? undefined : desired,
        (value) => (node[field] = value),
        state
      )
    }
  }
  setValue(
    node,
    node.strokesIncludedInLayout,
    layout.strokesIncluded,
    (value) => (node.strokesIncludedInLayout = value),
    state
  )

  if (layout.mode === 'GRID') {
    setValue(
      node,
      node.gridRowGap,
      bindings?.gridRowGap || currentBoundVariableId(node, 'gridRowGap')
        ? undefined
        : layout.rowGap,
      (value) => (node.gridRowGap = value),
      state
    )
    setValue(
      node,
      node.gridColumnGap,
      bindings?.gridColumnGap || currentBoundVariableId(node, 'gridColumnGap')
        ? undefined
        : layout.columnGap,
      (value) => (node.gridColumnGap = value),
      state
    )

    const rowCount = layout.rows?.length
    if (layout.autoRows !== undefined) {
      setValue(
        node,
        node.gridAutoTracks,
        layout.autoRows ? ('ROWS' as const) : ('NONE' as const),
        (value) => (node.gridAutoTracks = value),
        state
      )
    }
    if (node.gridColumnCount < layout.columns.length) {
      setValue(
        node,
        node.gridColumnCount,
        layout.columns.length,
        (value) => (node.gridColumnCount = value),
        state
      )
    }
    if (rowCount !== undefined && node.gridRowCount < rowCount) {
      setValue(node, node.gridRowCount, rowCount, (value) => (node.gridRowCount = value), state)
    }
    return
  }

  const autoLayout = spec.figma?.autoLayout
  setValue(
    node,
    node.itemSpacing,
    bindings?.gap || currentBoundVariableId(node, 'itemSpacing')
      ? undefined
      : (autoLayout?.itemSpacing ?? layout.gap),
    (value) => (node.itemSpacing = value),
    state
  )
  setValue(node, node.layoutWrap, layout.wrap, (value) => (node.layoutWrap = value), state)
  const counterAxisSpacing =
    autoLayout?.counterAxisSpacing !== undefined ? autoLayout.counterAxisSpacing : layout.counterGap
  if (!bindings?.counterAxisSpacing && !currentBoundVariableId(node, 'counterAxisSpacing')) {
    applyCounterAxisSpacing(node, counterAxisSpacing, state)
  }
  setValue(
    node,
    node.itemReverseZIndex,
    autoLayout?.itemReverseZIndex,
    (value) => (node.itemReverseZIndex = value),
    state
  )
  setValue(
    node,
    node.primaryAxisAlignItems,
    layout.primaryAlign,
    (value) => (node.primaryAxisAlignItems = value),
    state
  )
  setValue(
    node,
    node.counterAxisAlignItems,
    layout.counterAlign,
    (value) => (node.counterAxisAlignItems = value),
    state
  )
  setValue(
    node,
    node.counterAxisAlignContent,
    layout.counterAlignContent,
    (value) => (node.counterAxisAlignContent = value),
    state
  )
}

export const SIZE_BOUND_FIELDS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const

export function applySizingModes(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): void {
  if (isIntrinsicNode(node) || !supportsLayoutSizing(node, parent)) return
  const size = spec.size
  setValue(
    node,
    node.layoutSizingHorizontal,
    size.horizontal,
    (value) => (node.layoutSizingHorizontal = value),
    state
  )
  setValue(
    node,
    node.layoutSizingVertical,
    size.vertical,
    (value) => (node.layoutSizingVertical = value),
    state
  )
  setValue(
    node,
    node.layoutGrow,
    spec.grow === undefined ? undefined : spec.grow ? 1 : 0,
    (value) => (node.layoutGrow = value),
    state
  )

  if (!isFrameContainer(node) || node.layoutMode === 'NONE' || node.layoutMode === 'GRID') return
  const horizontalMode: 'AUTO' | 'FIXED' = size.horizontal === 'HUG' ? 'AUTO' : 'FIXED'
  const verticalMode: 'AUTO' | 'FIXED' = size.vertical === 'HUG' ? 'AUTO' : 'FIXED'
  const horizontal = node.layoutMode === 'HORIZONTAL'
  setValue(
    node,
    node.primaryAxisSizingMode,
    horizontal ? horizontalMode : verticalMode,
    (value) => (node.primaryAxisSizingMode = value),
    state
  )
  setValue(
    node,
    node.counterAxisSizingMode,
    horizontal ? verticalMode : horizontalMode,
    (value) => (node.counterAxisSizingMode = value),
    state
  )
}

type CrossAxisFill = {
  axis: 'horizontal' | 'vertical'
  recoverySize: number
}

function clampSize(value: number, min: number | null, max: number | null): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 0, value))
}

export function layoutStrokeWeight(
  node: CanvasFrameContainerNode,
  field: 'strokeBottomWeight' | 'strokeLeftWeight' | 'strokeRightWeight' | 'strokeTopWeight'
): number {
  const value = node[field]
  return typeof value === 'number'
    ? value
    : typeof node.strokeWeight === 'number'
      ? node.strokeWeight
      : 0
}

export function includedLayoutEdgeStroke(
  node: CanvasFrameContainerNode,
  field: 'strokeBottomWeight' | 'strokeLeftWeight' | 'strokeRightWeight' | 'strokeTopWeight'
): number {
  if (
    !node.strokesIncludedInLayout ||
    node.strokeAlign !== 'INSIDE' ||
    !Array.isArray(node.strokes) ||
    !node.strokes.some((stroke) => stroke.visible !== false)
  ) {
    return 0
  }
  return layoutStrokeWeight(node, field)
}

function includedLayoutStroke(
  node: CanvasFrameContainerNode,
  axis: 'horizontal' | 'vertical'
): number {
  return axis === 'horizontal'
    ? includedLayoutEdgeStroke(node, 'strokeLeftWeight') +
        includedLayoutEdgeStroke(node, 'strokeRightWeight')
    : includedLayoutEdgeStroke(node, 'strokeTopWeight') +
        includedLayoutEdgeStroke(node, 'strokeBottomWeight')
}

export function crossAxisFill(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent?: SupportedCanvasNode | CanvasParentNode
): CrossAxisFill | null {
  if (
    isIntrinsicNode(node) ||
    !parent ||
    !isFrameContainer(parent) ||
    !('layoutPositioning' in node) ||
    parent.counterAxisSizingMode !== 'FIXED' ||
    parent.layoutWrap !== 'NO_WRAP' ||
    node.layoutPositioning !== 'AUTO'
  ) {
    return null
  }
  if (parent.layoutMode === 'VERTICAL' && spec.size.horizontal === 'FILL') {
    return {
      axis: 'horizontal',
      recoverySize: Math.max(
        GEOMETRY_TOLERANCE,
        clampSize(
          parent.width -
            parent.paddingLeft -
            parent.paddingRight -
            includedLayoutStroke(parent, 'horizontal'),
          node.minWidth,
          node.maxWidth
        )
      )
    }
  }
  if (parent.layoutMode === 'HORIZONTAL' && spec.size.vertical === 'FILL') {
    return {
      axis: 'vertical',
      recoverySize: Math.max(
        GEOMETRY_TOLERANCE,
        clampSize(
          parent.height -
            parent.paddingTop -
            parent.paddingBottom -
            includedLayoutStroke(parent, 'vertical'),
          node.minHeight,
          node.maxHeight
        )
      )
    }
  }
  return null
}

export function stabilizeCrossAxisFill(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): void {
  if (!('layoutSizingHorizontal' in node)) return
  const fill = crossAxisFill(node, spec, parent)
  if (!fill) return
  const current = fill.axis === 'horizontal' ? node.width : node.height
  if (
    current >= GEOMETRY_TOLERANCE &&
    (!state.createdNodeIds.has(node.id) || state.stabilizedCrossAxisFillNodeIds.has(node.id))
  ) {
    return
  }

  if (fill.axis === 'horizontal') {
    node.layoutSizingHorizontal = 'FIXED'
    node.resize(fill.recoverySize, node.height)
    node.layoutSizingHorizontal = 'FILL'
  } else {
    node.layoutSizingVertical = 'FIXED'
    node.resize(node.width, fill.recoverySize)
    node.layoutSizingVertical = 'FILL'
  }
  state.stabilizedCrossAxisFillNodeIds.add(node.id)
  markMutation(state, node)
}

export function stabilizeGrowingTextWidth(
  node: SupportedCanvasNode,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): void {
  if (
    node.type !== 'TEXT' ||
    node.characters.length === 0 ||
    node.textAutoResize !== 'HEIGHT' ||
    node.layoutGrow <= 0 ||
    node.width > GEOMETRY_TOLERANCE
  ) {
    return
  }

  let width = Math.max(node.minWidth ?? 0, 1)
  if (parent && isFrameContainer(parent)) {
    if (parent.layoutMode === 'VERTICAL') {
      width = Math.max(
        width,
        parent.width -
          parent.paddingLeft -
          parent.paddingRight -
          includedLayoutStroke(parent, 'horizontal')
      )
    } else if (parent.layoutMode === 'HORIZONTAL') {
      const flow = parent.children.filter(
        (
          child
        ): child is SupportedCanvasNode & {
          layoutGrow: number
          layoutPositioning: 'ABSOLUTE' | 'AUTO'
        } =>
          isSupportedSceneNode(child) &&
          'layoutGrow' in child &&
          'layoutPositioning' in child &&
          child.layoutPositioning !== 'ABSOLUTE'
      )
      const fixedWidth = flow.reduce(
        (total, child) => total + (child.id !== node.id && child.layoutGrow <= 0 ? child.width : 0),
        0
      )
      const growCount = Math.max(1, flow.filter((child) => child.layoutGrow > 0).length)
      const available =
        parent.width -
        parent.paddingLeft -
        parent.paddingRight -
        includedLayoutStroke(parent, 'horizontal') -
        Math.max(0, flow.length - 1) * parent.itemSpacing -
        fixedWidth
      width = Math.max(width, available / growCount)
    }
  }
  width = Math.max(GEOMETRY_TOLERANCE, clampSize(width, node.minWidth, node.maxWidth))

  node.layoutSizingHorizontal = 'FIXED'
  node.resize(width, node.height)
  node.layoutSizingHorizontal = 'FILL'
  markMutation(state, node)
}

export function supportsLayoutSizing(
  node: SupportedCanvasNode,
  parent: SupportedCanvasNode | CanvasParentNode | undefined
): node is SupportedCanvasNode & LayoutMixin {
  return (
    'layoutSizingHorizontal' in node &&
    (('layoutMode' in node && node.layoutMode !== 'NONE') ||
      (!!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE'))
  )
}

export function applySize(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): void {
  if (isIntrinsicNode(node)) return
  const size = spec.size
  for (const field of SIZE_BOUND_FIELDS) {
    setValue(
      node,
      node[field],
      spec.variables?.[field] || currentBoundVariableId(node, field) ? undefined : size[field],
      (value) => (node[field] = value),
      state
    )
  }
  const width =
    !spec.variables?.width && !currentBoundVariableId(node, 'width') && size.width !== undefined
      ? size.width
      : node.width
  const height =
    !spec.variables?.height && !currentBoundVariableId(node, 'height') && size.height !== undefined
      ? size.height
      : node.height
  if (Math.abs(node.width - width) > 0.01 || Math.abs(node.height - height) > 0.01) {
    node.resize(width, height)
    markMutation(state, node)
  }
  applySizingModes(node, spec, parent, state)
}

export function applyPosition(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent: CanvasParentNode,
  state: ApplyState
): void {
  if (spec.positioning !== undefined && isFrameContainer(parent) && parent.layoutMode !== 'NONE') {
    if (node.type === 'SECTION') {
      specError(`Section "${spec.key}" cannot be a child of an Auto Layout frame.`)
    }
    setValue(
      node,
      node.layoutPositioning,
      spec.positioning,
      (value) => (node.layoutPositioning = value),
      state
    )
  }
  if (!spec.position) return
  const { right, bottom } = spec.absoluteOffsets ?? {}
  const x =
    right !== undefined && 'width' in parent ? parent.width - right - node.width : spec.position.x
  const y =
    bottom !== undefined && 'height' in parent
      ? parent.height - bottom - node.height
      : spec.position.y
  setValue(node, node.x, x, (value) => (node.x = value), state)
  setValue(node, node.y, y, (value) => (node.y = value), state)
}

export function finalizeAbsolutePositions(root: CanvasNodeSpec, state: ApplyState): void {
  for (const spec of walkSpecs(root)) {
    const offsets = spec.absoluteOffsets
    if (!offsets) continue
    const node = state.keyedNodes.get(spec.key)
    const parent = node?.parent
    if (!node || !parent || !('width' in parent)) continue
    // Bindings, consumer modes, and layout may change either bound after markup parsing.
    if (offsets.right !== undefined) {
      setValue(node, node.x, parent.width - offsets.right - node.width, (x) => (node.x = x), state)
    }
    if (offsets.bottom !== undefined) {
      setValue(
        node,
        node.y,
        parent.height - offsets.bottom - node.height,
        (y) => (node.y = y),
        state
      )
    }
  }
}

export function applyRelativeTransform(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): void {
  const transform = spec.figma?.relativeTransform
  if (!transform) return
  const current = node.relativeTransform
  const autoLayoutChild = !!parent && isFrameContainer(parent) && parent.layoutMode !== 'NONE'
  const desired: Transform = autoLayoutChild
    ? [
        [transform[0][0], transform[0][1], current[0][2]],
        [transform[1][0], transform[1][1], current[1][2]]
      ]
    : transform
  if (transformsMatch(current, desired)) return
  node.relativeTransform = desired
  markMutation(state, node)
}

function placementBounds(node: SceneNode): Rect | null {
  const bounds = ('absoluteRenderBounds' in node ? node.absoluteRenderBounds : null) ??
    ('absoluteBoundingBox' in node ? node.absoluteBoundingBox : null) ?? {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    }
  return finiteRect(bounds)
}

function placementOverlap(candidate: Rect, obstacle: Rect): boolean {
  return (
    candidate.x < obstacle.x + obstacle.width + ROOT_PLACEMENT_GAP &&
    candidate.x + candidate.width + ROOT_PLACEMENT_GAP > obstacle.x &&
    candidate.y < obstacle.y + obstacle.height + ROOT_PLACEMENT_GAP &&
    candidate.y + candidate.height + ROOT_PLACEMENT_GAP > obstacle.y
  )
}

export function placeCreatedRoot(
  node: SupportedCanvasNode,
  page: PageNode,
  state: ApplyState
): void {
  const bounds = placementBounds(node)
  if (!bounds) specError(`Created root "${node.id}" has invalid placement bounds.`)
  const center = figma.viewport.center
  const candidate = {
    x: center.x - bounds.width / 2,
    y: center.y - bounds.height / 2,
    width: bounds.width,
    height: bounds.height
  }
  const obstacles = page.children
    .filter((child) => child.id !== node.id)
    .map(placementBounds)
    .filter((value): value is Rect => value !== null)
    .sort((a, b) => a.x - b.x)

  for (const obstacle of obstacles) {
    if (!placementOverlap(candidate, obstacle)) continue
    candidate.x = obstacle.x + obstacle.width + ROOT_PLACEMENT_GAP
    if (!Number.isFinite(candidate.x)) {
      specError(`Page "${page.id}" has invalid placement bounds.`)
    }
  }

  if (obstacles.some((obstacle) => placementOverlap(candidate, obstacle))) {
    specError(`Created root "${node.id}" could not be placed without overlap.`)
  }

  const deltaX = candidate.x - bounds.x
  const deltaY = candidate.y - bounds.y
  if (deltaX !== 0 || deltaY !== 0) {
    const transform = node.relativeTransform
    node.relativeTransform = [
      [transform[0][0], transform[0][1], transform[0][2] + deltaX],
      [transform[1][0], transform[1][1], transform[1][2] + deltaY]
    ]
    markMutation(state, node)
  }
  reportCanvasPlacement(node)
}
