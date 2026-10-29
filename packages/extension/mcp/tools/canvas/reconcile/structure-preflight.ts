import type { CanvasNodeSpec } from '../model'
import type { ApplyState, SupportedCanvasNode, CanvasParentNode } from './state'

import { specError } from '../errors'
import { findExistingNode, isIntrinsicNode, walkSpecs, isWrappedSpec } from './nodes'

function findOmittedChild(
  specs: CanvasNodeSpec[],
  parent: ChildrenMixin,
  state: ApplyState
): SceneNode | undefined {
  const describedIds = new Set(
    specs
      .map((spec) => findExistingNode(spec, state))
      .filter((node): node is SupportedCanvasNode => node !== null)
      .map((node) => node.id)
  )
  return parent.children.find(
    (child) => !describedIds.has(child.id) && !state.removalNodeIds.has(child.id)
  )
}

export function preflightMasks(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing: SupportedCanvasNode | null = null,
  isRoot = true
): void {
  const isDesiredMask = desiredMaskState(spec, existing)
  if (isRoot && isDesiredMask) {
    specError('The canvas root cannot be a mask because its scope would escape the desired tree.')
  }

  const children = spec.children ?? []
  const hasMask = children.some((child) => desiredMaskState(child, findExistingNode(child, state)))
  const lastChild = children.at(-1)
  if (lastChild && desiredMaskState(lastChild, findExistingNode(lastChild, state))) {
    specError(`Mask "${lastChild.key}" must precede at least one sibling to mask.`)
  }

  if (hasMask && existing && 'children' in existing) {
    const omitted = findOmittedChild(children, existing, state)
    if (omitted) {
      specError(
        `Mask container "${spec.key}" has omitted live child "${omitted.id}"; describe every direct child so the mask scope is deterministic.`
      )
    }
  }

  for (const child of children) {
    preflightMasks(child, state, findExistingNode(child, state), false)
  }
}

function desiredMaskState(spec: CanvasNodeSpec, existing: SupportedCanvasNode | null): boolean {
  const desired = spec.figma?.mask
  if (desired !== undefined) return desired !== null
  return !!existing && 'isMask' in existing && existing.isMask
}

export function preflightContainers(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing: SupportedCanvasNode | null = null
): void {
  const childCount = spec.children?.length ?? 0
  if (!existing && spec.type === 'GROUP' && childCount === 0) {
    specError(`New group "${spec.key}" requires at least one child.`)
  }
  if (!existing && spec.type === 'BOOLEAN_OPERATION' && childCount < 2) {
    specError(`New boolean operation "${spec.key}" requires at least two children.`)
  }
  if (!existing && spec.type === 'COMPONENT_SET' && childCount === 0) {
    specError(`New component set "${spec.key}" requires at least one component child.`)
  }
  if (spec.type === 'COMPONENT_SET' && spec.children?.some((child) => child.type !== 'COMPONENT')) {
    specError(`Component set "${spec.key}" can contain only component nodes.`)
  }
  if (
    existing &&
    (existing.type === 'COMPONENT' || existing.type === 'COMPONENT_SET') &&
    existing.remote
  ) {
    specError(`Remote ${existing.type} node "${spec.key}" is read-only.`)
  }
  if (existing && isIntrinsicNode(existing) && spec.children?.length) {
    const omitted = findOmittedChild(spec.children, existing, state)
    if (omitted) {
      specError(
        `Intrinsic container "${spec.key}" has omitted live child "${omitted.id}"; describe every direct child when reconciling its contents.`
      )
    }
  }
  for (const child of spec.children ?? []) {
    preflightContainers(child, state, findExistingNode(child, state))
  }
}

export function preflightMovedChildren(root: CanvasNodeSpec, state: ApplyState): void {
  const order = new Map<CanvasNodeSpec, { start: number; end: number }>()
  let nextOrder = 0
  function recordOrder(spec: CanvasNodeSpec): void {
    const start = nextOrder++
    for (const child of spec.children ?? []) recordOrder(child)
    order.set(spec, { start, end: nextOrder++ })
  }
  recordOrder(root)
  const incoming = new Map<string, number[]>()
  const outgoing = new Map<CanvasParentNode, { ids: Set<string>; lastMove: number }>()
  for (const parentSpec of walkSpecs(root)) {
    // targetNodeId identifies an adopted root before its canvas key is claimed.
    const destination = parentSpec === root ? state.scope : findExistingNode(parentSpec, state)
    for (const childSpec of parentSpec.children ?? []) {
      const child = findExistingNode(childSpec, state)
      const parent = child?.parent
      if (destination && 'children' in destination && parent?.id !== destination.id) {
        const insertions = incoming.get(destination.id) ?? []
        // Only new wrapped containers wait for their children before insertion.
        const timing = order.get(childSpec)!
        insertions.push(!child && isWrappedSpec(childSpec) ? timing.end : timing.start)
        incoming.set(destination.id, insertions)
      }
      if (
        !child ||
        !parent ||
        parent.id === destination?.id ||
        (parent.type !== 'GROUP' &&
          parent.type !== 'BOOLEAN_OPERATION' &&
          parent.type !== 'COMPONENT_SET')
      )
        continue
      const moves = outgoing.get(parent) ?? { ids: new Set<string>(), lastMove: -1 }
      moves.ids.add(child.id)
      // New sets stage every variant before reconciling any variant's descendants.
      const moveOrder = !destination && parentSpec.type === 'COMPONENT_SET' ? parentSpec : childSpec
      moves.lastMove = Math.max(moves.lastMove, order.get(moveOrder)!.start)
      outgoing.set(parent, moves)
    }
  }
  for (const initialParent of [...outgoing.keys()]) {
    let parent = initialParent
    while (true) {
      const { ids, lastMove } = outgoing.get(parent)!
      const addedBeforeMove = (incoming.get(parent.id) ?? []).filter(
        (time) => time < lastMove
      ).length
      // An explicitly removed Group can disappear during the move, emptying its
      // parent before the ordinary removal checks get a live subtree to inspect.
      if (
        parent.type !== 'GROUP' ||
        addedBeforeMove ||
        parent.children.some((child) => !ids.has(child.id))
      )
        break
      const ancestor = parent.parent
      if (
        !ancestor ||
        (ancestor.type !== 'GROUP' &&
          ancestor.type !== 'BOOLEAN_OPERATION' &&
          ancestor.type !== 'COMPONENT_SET')
      )
        break
      const ancestorMoves = outgoing.get(ancestor) ?? { ids: new Set<string>(), lastMove: -1 }
      if (ancestorMoves.ids.has(parent.id)) break
      ancestorMoves.ids.add(parent.id)
      ancestorMoves.lastMove = Math.max(ancestorMoves.lastMove, lastMove)
      outgoing.set(ancestor, ancestorMoves)
      parent = ancestor
    }
  }
  // Aggregate sibling cascades before checking their common ancestor's last move.
  for (const [parent, { ids, lastMove }] of outgoing) {
    const remaining = parent.children.filter(
      (child) => !ids.has(child.id) && !state.removalNodeIds.has(child.id)
    )
    const addedBeforeMove = (incoming.get(parent.id) ?? []).filter((time) => time < lastMove).length
    const minimum = parent.type === 'BOOLEAN_OPERATION' ? 2 : 1
    if (!state.removalNodeIds.has(parent.id) && remaining.length + addedBeforeMove < minimum) {
      specError(
        `Moving these children would leave ${parent.type} "${parent.id}" with fewer than ${minimum} children. Preserve its required children or explicitly remove that container in the same update.`
      )
    }
  }
}
