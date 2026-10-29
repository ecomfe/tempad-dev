import type { CanvasGridTrack, CanvasNodeSpec, CanvasGridLayout } from '../model'

import { applyError, specError } from '../errors'
import { scalarValuesEqual } from './comparison'
import { applySizingModes } from './layout'
import { isSupportedSceneNode, walkSpecs, isFrameContainer } from './nodes'
import {
  type CanvasFrameContainerNode,
  type ApplyState,
  markMutation,
  type SupportedCanvasNode,
  setValue
} from './state'

function gridTrackMatches(current: GridTrackSize | undefined, desired: CanvasGridTrack): boolean {
  return (
    current?.type === desired.type &&
    (desired.type === 'HUG' ||
      scalarValuesEqual(current.value ?? (current.type === 'FLEX' ? 1 : undefined), desired.value))
  )
}

function applyGridTracks(
  node: CanvasFrameContainerNode,
  field: 'gridColumnSizes' | 'gridRowSizes',
  desired: CanvasGridTrack[],
  state: ApplyState,
  preserveTrailing = false
): void {
  const current = node[field]
  if (current.length < desired.length || (!preserveTrailing && current.length !== desired.length)) {
    specError(`Figma returned ${current.length} ${field}, expected ${desired.length}.`)
  }
  for (const [index, track] of desired.entries()) {
    const target = current[index]!
    if (gridTrackMatches(target, track)) continue
    target.type = track.type
    if (track.type !== 'HUG') target.value = track.value
    markMutation(state, node)
  }
  const applied = node[field]
  const mismatch = desired.findIndex((track, index) => !gridTrackMatches(applied[index], track))
  if (mismatch !== -1) {
    applyError(`Verification failed for "${node.id}": ${field} track ${mismatch} does not match.`)
  }
}

type GridChildNode = Exclude<SupportedCanvasNode, SectionNode>

function applyGridChildAlignment(
  node: GridChildNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const grid = spec.gridChild
  if (!grid) return
  setValue(
    node,
    node.gridChildHorizontalAlign,
    grid.horizontalAlign,
    (value) => (node.gridChildHorizontalAlign = value),
    state
  )
  setValue(
    node,
    node.gridChildVerticalAlign,
    grid.verticalAlign,
    (value) => (node.gridChildVerticalAlign = value),
    state
  )
}

function setGridChildSpans(
  node: GridChildNode,
  rowSpan: number,
  columnSpan: number,
  state: ApplyState
): void {
  setValue(node, node.gridRowSpan, rowSpan, (value) => (node.gridRowSpan = value), state)
  setValue(node, node.gridColumnSpan, columnSpan, (value) => (node.gridColumnSpan = value), state)
}

function setGridChildPosition(
  node: GridChildNode,
  row: number,
  column: number,
  state: ApplyState
): void {
  if (node.gridRowAnchorIndex === row && node.gridColumnAnchorIndex === column) return
  node.setGridChildPosition(row, column)
  markMutation(state, node)
}

function gridAreasOverlap(
  left: { column: number; columnSpan: number; row: number; rowSpan: number },
  right: { column: number; columnSpan: number; row: number; rowSpan: number }
): boolean {
  return (
    left.row < right.row + right.rowSpan &&
    left.row + left.rowSpan > right.row &&
    left.column < right.column + right.columnSpan &&
    left.column + left.columnSpan > right.column
  )
}

type ReconciledGridChild = {
  node: GridChildNode
  spec: CanvasNodeSpec
}

export type ReconciledChild = {
  node: SupportedCanvasNode
  spec: CanvasNodeSpec
}

function liveGridExtent(node: CanvasFrameContainerNode): { columns: number; rows: number } {
  return node.children.reduce(
    (extent, child) =>
      'gridRowAnchorIndex' in child
        ? {
            columns: Math.max(extent.columns, child.gridColumnAnchorIndex + child.gridColumnSpan),
            rows: Math.max(extent.rows, child.gridRowAnchorIndex + child.gridRowSpan)
          }
        : extent,
    { columns: 1, rows: 1 }
  )
}

function finalizeManualGrid(
  node: CanvasFrameContainerNode,
  layout: CanvasGridLayout,
  children: ReconciledGridChild[],
  state: ApplyState,
  forceFinalRowCount = false
): void {
  const autoRows = layout.autoRows ?? (layout.rows === undefined && node.gridAutoTracks === 'ROWS')
  const rowCount =
    layout.rows?.length ??
    (autoRows
      ? Math.max(1, ...children.map(({ spec }) => spec.gridChild!.row! + spec.gridChild!.rowSpan))
      : node.gridRowCount)
  setValue(
    node,
    node.gridItemsPositioning,
    'MANUAL' as const,
    (value) => (node.gridItemsPositioning = value),
    state
  )

  const moving = children.filter(({ node: child, spec }) => {
    const grid = spec.gridChild!
    return (
      child.gridRowAnchorIndex !== grid.row ||
      child.gridColumnAnchorIndex !== grid.column ||
      child.gridRowSpan !== grid.rowSpan ||
      child.gridColumnSpan !== grid.columnSpan
    )
  })
  const desiredAreas = children.map(({ spec }) => {
    const grid = spec.gridChild!
    return {
      column: grid.column!,
      columnSpan: grid.columnSpan,
      row: grid.row!,
      rowSpan: grid.rowSpan
    }
  })
  const removalBlockers = node.children.filter((child): child is GridChildNode => {
    if (
      !state.removalNodeIds.has(child.id) ||
      !isSupportedSceneNode(child) ||
      child.type === 'SECTION'
    ) {
      return false
    }
    const liveArea = {
      column: child.gridColumnAnchorIndex,
      columnSpan: child.gridColumnSpan,
      row: child.gridRowAnchorIndex,
      rowSpan: child.gridRowSpan
    }
    return desiredAreas.some((area) => gridAreasOverlap(liveArea, area))
  })
  const staging = [...moving.map(({ node: child }) => child), ...removalBlockers]
  if (staging.length) {
    setValue(
      node,
      node.gridAutoTracks,
      'NONE' as const,
      (value) => (node.gridAutoTracks = value),
      state
    )
    const stagingStart = Math.max(node.gridRowCount, rowCount)
    setValue(
      node,
      node.gridRowCount,
      stagingStart + staging.length,
      (value) => (node.gridRowCount = value),
      state
    )
    for (const [index, child] of staging.entries()) {
      setGridChildSpans(child, 1, 1, state)
      setGridChildPosition(child, stagingStart + index, 0, state)
    }
    if (removalBlockers.length) state.pendingGridRemovalCleanupNodeIds.add(node.id)
  }

  for (const { node: child, spec } of moving) {
    const grid = spec.gridChild!
    setGridChildPosition(child, grid.row!, grid.column!, state)
    setGridChildSpans(child, grid.rowSpan, grid.columnSpan, state)
  }
  const extent = liveGridExtent(node)
  const finalColumnCount = Math.max(layout.columns.length, extent.columns)
  setValue(
    node,
    node.gridColumnCount,
    finalColumnCount,
    (value) => (node.gridColumnCount = value),
    state
  )
  if (!autoRows || moving.length || forceFinalRowCount) {
    const finalRowCount = autoRows ? extent.rows : Math.max(rowCount, extent.rows)
    setValue(node, node.gridRowCount, finalRowCount, (value) => (node.gridRowCount = value), state)
  }

  applyGridTracks(
    node,
    'gridColumnSizes',
    layout.columns,
    state,
    finalColumnCount > layout.columns.length
  )
  if (layout.rows) {
    applyGridTracks(
      node,
      'gridRowSizes',
      layout.rows,
      state,
      node.gridRowCount > layout.rows.length
    )
  }
  if (autoRows && staging.length) {
    setValue(
      node,
      node.gridAutoTracks,
      'ROWS' as const,
      (value) => (node.gridAutoTracks = value),
      state
    )
  }
}

function finalizeFlowGrid(
  node: CanvasFrameContainerNode,
  layout: CanvasGridLayout,
  children: ReconciledGridChild[],
  state: ApplyState
): void {
  setValue(
    node,
    node.gridItemsPositioning,
    'ROW_AUTO_FLOW' as const,
    (value) => (node.gridItemsPositioning = value),
    state
  )
  for (const { node: child, spec } of children) {
    const grid = spec.gridChild!
    setGridChildSpans(child, grid.rowSpan, grid.columnSpan, state)
  }
  const extent = liveGridExtent(node)
  const finalColumnCount = Math.max(layout.columns.length, extent.columns)
  setValue(
    node,
    node.gridColumnCount,
    finalColumnCount,
    (value) => (node.gridColumnCount = value),
    state
  )

  if (layout.rows) {
    const finalRowCount = Math.max(layout.rows.length, extent.rows)
    setValue(node, node.gridRowCount, finalRowCount, (value) => (node.gridRowCount = value), state)
    applyGridTracks(node, 'gridRowSizes', layout.rows, state, finalRowCount > layout.rows.length)
  }
  applyGridTracks(
    node,
    'gridColumnSizes',
    layout.columns,
    state,
    finalColumnCount > layout.columns.length
  )
}

export function finalizeGrid(
  node: CanvasFrameContainerNode,
  spec: CanvasNodeSpec,
  children: ReconciledChild[],
  state: ApplyState,
  forceFinalRowCount = false
): void {
  const layout = spec.layout
  if (layout?.mode !== 'GRID') return
  const gridChildren: ReconciledGridChild[] = children
    .filter(({ spec: child }) => child.gridChild)
    .map((child) => {
      if (child.node.type === 'SECTION') {
        specError(`Section "${child.spec.key}" cannot be a child of a grid frame.`)
      }
      return { ...child, node: child.node }
    })
  if ((layout.itemsPositioning ?? node.gridItemsPositioning) === 'MANUAL') {
    finalizeManualGrid(node, layout, gridChildren, state, forceFinalRowCount)
  } else {
    finalizeFlowGrid(node, layout, gridChildren, state)
  }
  for (const child of gridChildren) {
    applyGridChildAlignment(child.node, child.spec, state)
    // Figma can reset a grid child's sizing modes while changing its cell or span.
    applySizingModes(child.node, child.spec, node, state)
  }
}

export function finalizeGridsAfterRemovals(rootSpec: CanvasNodeSpec, state: ApplyState): void {
  if (!state.pendingGridRemovalCleanupNodeIds.size) return
  for (const spec of walkSpecs(rootSpec)) {
    const node = state.keyedNodes.get(spec.key)
    if (
      !node ||
      !isFrameContainer(node) ||
      !state.pendingGridRemovalCleanupNodeIds.delete(node.id)
    ) {
      continue
    }
    const children = (spec.children ?? []).map((childSpec) => {
      const child = state.keyedNodes.get(childSpec.key)
      if (!child || child.removed) {
        specError(`Desired grid child "${childSpec.key}" was unavailable after node removal.`)
      }
      return { node: child, spec: childSpec }
    })
    finalizeGrid(node, spec, children, state, true)
  }
  if (state.pendingGridRemovalCleanupNodeIds.size) {
    specError('A grid staged for node removal was unavailable for final layout cleanup.')
  }
}
