import type { CanvasNodeSpec } from '../model'

import { specError, canvasReadOnlyError, errorMessage, applyError } from '../errors'
import { loadFonts, currentTextFonts } from '../fonts'
import {
  applyShape,
  applyAppearance,
  applyLayoutAids,
  applyPaintStacks,
  applyEffects,
  applySharedLayerState,
  applyMask
} from './appearance'
import { unlinkStyles, clearVariables, applyStyles, applyVariables } from './bindings'
import {
  componentDefinitionOwner,
  componentPropertyKeys,
  setComponentPropertyKey,
  resolveComponent,
  applyComponent,
  applyComponentMetadata,
  applyAuthoredComponentProperties,
  applySlotProperty,
  applyComponentPropertyReferences
} from './components'
import { type ReconciledChild, finalizeGrid } from './grid'
import {
  applyLayout,
  applySize,
  applyPosition,
  applyRelativeTransform,
  applySizingModes,
  stabilizeCrossAxisFill,
  stabilizeGrowingTextWidth
} from './layout'
import {
  isFrameContainer,
  hasCanvasKeyPaints,
  hasDeferredTextRanges,
  isSupportedSceneNode,
  hasCanvasKeyVectorPattern,
  isCanvasKeyHyperlink,
  findExistingNode,
  resolveExistingNode,
  isWrappedSpec,
  isIntrinsicNode
} from './nodes'
import {
  type CanvasParentNode,
  type ApplyState,
  recordCreatedNode,
  type SupportedCanvasNode,
  markMutation,
  setValue,
  type WrappedContainerSpec,
  type WrappedContainerNode,
  moveIntoParent,
  setNodeKey
} from './state'
import { applySvg } from './svg'
import { applyText, applyTextRanges, applyTextHyperlink } from './text'
import { applyVariableModes } from './variable-modes'
import { ignoredLiteralWarnings } from './warnings'

function containingComponentNode(parent: CanvasParentNode | undefined): ComponentNode | null {
  let current: BaseNode | null = parent ?? null
  while (current) {
    if (current.type === 'COMPONENT') return current
    current = current.parent
  }
  return null
}

function createSlotNode(
  spec: CanvasNodeSpec,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): SlotNode {
  const component = containingComponentNode(parent)
  if (!component || component.remote) {
    specError(`New slot "${spec.key}" must be nested inside a local authored component.`)
  }
  const owner = componentDefinitionOwner(component)
  componentPropertyKeys(owner, state)
  const previousNames = new Set(Object.keys(owner.componentPropertyDefinitions))
  const slot = component.createSlot()
  recordCreatedNode(slot, state)
  const propertyNames = Object.entries(owner.componentPropertyDefinitions)
    .filter(([name, definition]) => !previousNames.has(name) && definition.type === 'SLOT')
    .map(([name]) => name)
  if (propertyNames.length !== 1) {
    specError(`Figma did not create exactly one slot property for "${spec.key}".`)
  }
  setComponentPropertyKey(owner, spec.key, propertyNames[0]!, state)
  return slot
}

async function createNode(spec: CanvasNodeSpec, state: ApplyState): Promise<SupportedCanvasNode> {
  let node: SupportedCanvasNode
  switch (spec.type) {
    case 'BOOLEAN_OPERATION':
    case 'COMPONENT_SET':
    case 'GROUP':
      return specError(`${spec.type} nodes must be created from their children.`)
    case 'SLOT':
      return specError('SLOT nodes must be created by their containing component.')
    case 'COMPONENT':
      node = figma.createComponent()
      break
    case 'FRAME':
      node = figma.createFrame()
      break
    case 'INSTANCE': {
      const component = await resolveComponent(spec.component!, state)
      node = component.createInstance()
      break
    }
    case 'SECTION':
      node = figma.createSection()
      break
    case 'TEXT':
      node = figma.createText()
      break
    case 'RECTANGLE':
      node = figma.createRectangle()
      break
    case 'LINE':
      node = figma.createLine()
      break
    case 'ELLIPSE':
      node = figma.createEllipse()
      break
    case 'POLYGON':
      node = figma.createPolygon()
      break
    case 'STAR':
      node = figma.createStar()
      break
    case 'VECTOR':
      node = figma.createVector()
      break
  }
  recordCreatedNode(node, state)
  normalizeCreatedFrame(node, spec, state)
  return node
}

function normalizeCreatedFrame(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  if (
    (node.type === 'FRAME' || node.type === 'COMPONENT') &&
    spec.appearance?.clipsContent === undefined &&
    node.clipsContent
  ) {
    node.clipsContent = false
    markMutation(state, node)
  }
  if (
    (node.type === 'FRAME' || node.type === 'COMPONENT') &&
    spec.appearance?.fill === undefined &&
    node.fills !== figma.mixed &&
    node.fills.length > 0
  ) {
    node.fills = []
    markMutation(state, node)
  }
}

export async function applyNodeProperties(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: CanvasParentNode,
  nativeOnly = false
): Promise<void> {
  try {
    if (node.type !== 'TEXT') {
      state.ignoredLiteralWarnings.push(...ignoredLiteralWarnings(node, spec, nativeOnly))
    }
    await applyNodePropertiesUnchecked(node, spec, state, parent, nativeOnly)
  } catch (error) {
    throwNodeError(error, spec.key, node.id)
  }
}

const errorsWithNodeContext = new WeakSet<Error>()

function throwNodeError(error: unknown, key: string, nodeId?: string): never {
  const readOnly = canvasReadOnlyError(error)
  if (readOnly) throw readOnly
  const failure =
    error instanceof Error ? error : new Error(errorMessage(error, 'Native mutation failed.'))
  if (errorsWithNodeContext.has(failure)) throw failure
  failure.message = `${failure.message.replace(/\.$/, '')} on "${key}"${nodeId ? ` (${nodeId})` : ''}.`
  errorsWithNodeContext.add(failure)
  throw failure
}

async function applyNodePropertiesUnchecked(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent: CanvasParentNode | undefined,
  nativeOnly: boolean
): Promise<void> {
  if (node.type === 'TEXT') {
    await loadFonts(currentTextFonts(node), state.fonts)
  }
  if (node.type === 'INSTANCE') await applyComponent(node, spec, state)
  await applyVariableModes(node, spec.variableModes, state)
  const textRanges =
    node.type === 'TEXT' && node.characters === spec.text?.characters
      ? spec.figma?.text?.ranges
      : undefined
  await unlinkStyles(node, spec.styles, state, textRanges)
  await clearVariables(node, spec.variables, state, textRanges)
  setValue(
    node,
    node.name,
    node.type === 'TEXT' && spec.figma?.text?.autoRename
      ? undefined
      : (spec.displayName ?? (state.createdNodeIds.has(node.id) ? spec.key : undefined)),
    (value) => (node.name = value),
    state
  )
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    applyComponentMetadata(node, spec, state)
    applyAuthoredComponentProperties(node, spec, state)
  }
  if (node.type === 'SLOT') applySlotProperty(node, spec, state)
  if (isFrameContainer(node)) applyLayout(node, spec, state)
  if (node.type === 'BOOLEAN_OPERATION') {
    setValue(
      node,
      node.booleanOperation,
      spec.figma?.booleanOperation,
      (value) => (node.booleanOperation = value),
      state
    )
  }
  if (node.type === 'SECTION') {
    setValue(
      node,
      node.sectionContentsHidden,
      spec.figma?.section?.contentsHidden,
      (value) => (node.sectionContentsHidden = value),
      state
    )
  }
  await applyShape(node, spec, state)
  applySize(node, spec, parent, state)
  await applySvg(node, spec, state)
  if (parent) applyPosition(node, spec, parent, state)
  applyRelativeTransform(node, spec, parent, state)
  applyAppearance(node, spec, state)
  await applyStyles(node, spec.styles, state, textRanges)
  applyLayoutAids(node, spec, state)
  if (!hasCanvasKeyPaints(spec)) {
    applyPaintStacks(node, spec, state)
  }
  applyEffects(node, spec, state)
  if (node.type === 'TEXT') {
    const previousCharacters = node.characters
    await applyText(node, spec, state)
    // Replacement can discard mixed fill styles as well as typography aliases.
    // Re-evaluate the literal paint against the resulting text's ownership.
    if (node.characters !== previousCharacters) applyAppearance(node, spec, state)
    // Character replacement can discard old aliases. Inspect the remaining
    // ownership before this request adds new node or range bindings.
    state.ignoredLiteralWarnings.push(...ignoredLiteralWarnings(node, spec, nativeOnly))
  }
  await applyVariables(node, spec.variables, state, spec.figma?.text?.ranges)
  if (node.type === 'TEXT' && !hasDeferredTextRanges(spec)) {
    await applyTextRanges(node, spec.figma?.text?.ranges, state, spec.variables)
  }
  applySharedLayerState(node, spec, state)
  applyComponentPropertyReferences(node, spec, state)
  // Text and layout setters can leave a derived sizing mode or its geometry stale.
  if (node.type === 'TEXT') applySizingModes(node, spec, parent, state)
  stabilizeCrossAxisFill(node, spec, parent, state)
  stabilizeGrowingTextWidth(node, parent, state)
}

export async function applyCanvasKeyReferences(
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: CanvasParentNode
): Promise<void> {
  const node = state.keyedNodes.get(spec.key) ?? null
  if (!isSupportedSceneNode(node)) {
    applyError(`Desired node "${spec.key}" was not reconciled.`)
  }
  if (hasCanvasKeyVectorPattern(spec)) {
    await applyShape(node, spec, state, true)
    applySize(node, spec, parent, state)
    if (parent) applyPosition(node, spec, parent, state)
    applyRelativeTransform(node, spec, parent, state)
  }
  if (hasCanvasKeyPaints(spec)) {
    applyPaintStacks(node, spec, state)
  }
  if (node.type === 'TEXT') {
    if (isCanvasKeyHyperlink(spec.figma?.text?.hyperlink)) {
      applyTextHyperlink(node, spec.figma.text.hyperlink, state, spec.figma.text.ranges)
    }
    if (hasDeferredTextRanges(spec)) {
      await applyTextRanges(node, spec.figma?.text?.ranges, state, spec.variables)
    }
  }
  stabilizeCrossAxisFill(node, spec, parent, state)
  for (const child of spec.children ?? []) {
    await applyCanvasKeyReferences(child, state, node as CanvasParentNode)
  }
}

function createWrappedContainer(
  spec: WrappedContainerSpec,
  children: SupportedCanvasNode[],
  parent: CanvasParentNode | undefined,
  index: number,
  state: ApplyState
): WrappedContainerNode {
  const destination = parent ?? figma.currentPage
  const destinationIndex = parent ? index : undefined
  let node: WrappedContainerNode
  switch (spec.type) {
    case 'COMPONENT_SET': {
      const variants = children.filter(
        (child): child is ComponentNode => child.type === 'COMPONENT'
      )
      if (variants.length !== children.length) {
        specError(`Component set "${spec.key}" can contain only component nodes.`)
      }
      node = figma.combineAsVariants(variants, destination, destinationIndex)
      break
    }
    case 'GROUP':
      node = figma.group(children, destination, destinationIndex)
      break
    case 'BOOLEAN_OPERATION':
      switch (spec.figma!.booleanOperation!) {
        case 'UNION':
          node = figma.union(children, destination, destinationIndex)
          break
        case 'SUBTRACT':
          node = figma.subtract(children, destination, destinationIndex)
          break
        case 'INTERSECT':
          node = figma.intersect(children, destination, destinationIndex)
          break
        case 'EXCLUDE':
          node = figma.exclude(children, destination, destinationIndex)
          break
      }
      break
  }
  recordCreatedNode(node, state)
  return node
}

async function reconcileNewWrappedContainer(
  spec: WrappedContainerSpec,
  state: ApplyState,
  parent: CanvasParentNode | undefined,
  index: number
): Promise<WrappedContainerNode> {
  state.nodeIdsByKey[spec.key] = ''
  // Keep staged descendants inside the update scope when their existing ancestors move.
  const stagingParent = parent ?? figma.currentPage
  if (spec.type === 'COMPONENT_SET') {
    const children = spec.children!
    const variants = children.map((child) => {
      const existing = findExistingNode(child, state)
      if (existing && existing.type !== 'COMPONENT') {
        specError(`Component set "${spec.key}" can contain only component nodes.`)
      }
      const variant = existing ?? figma.createComponent()
      if (!existing) {
        recordCreatedNode(variant, state, false)
        normalizeCreatedFrame(variant, child, state)
      }
      setValue(variant, variant.name, child.displayName, (value) => (variant.name = value), state)
      if (variant.parent?.id !== stagingParent.id) {
        moveIntoParent(variant, stagingParent, stagingParent.children.length, state)
      }
      return variant
    })
    const node = createWrappedContainer(spec, variants, parent, index, state) as ComponentSetNode
    setNodeKey(state, node, spec.key)
    await applyNodeProperties(node, spec, state, parent)
    state.nodeIdsByKey[spec.key] = node.id
    const reconciled: ReconciledChild[] = []
    for (const [childIndex, child] of children.entries()) {
      const variant = await reconcileNode(
        child,
        state,
        node,
        desiredChildIndex(
          child,
          children.slice(childIndex + 1),
          state,
          node,
          reconciled.at(-1)?.node,
          variants[childIndex]
        ),
        variants[childIndex]
      )
      reconciled.push({ node: variant, spec: child })
    }
    finalizeGrid(node, spec, reconciled, state)
    for (const child of reconciled) applyMask(child.node, child.spec, state)
    return node
  }

  const stagingIndex = stagingParent.children.length
  const children: ReconciledChild[] = []
  for (const [childIndex, child] of spec.children!.entries()) {
    children.push({
      node: await reconcileNode(
        child,
        state,
        stagingParent,
        desiredChildIndex(
          child,
          spec.children!.slice(childIndex + 1),
          state,
          stagingParent,
          children.at(-1)?.node,
          undefined,
          stagingIndex
        )
      ),
      spec: child
    })
  }

  const node = createWrappedContainer(
    spec,
    children.map(({ node: child }) => child),
    parent,
    index,
    state
  )
  setNodeKey(state, node, spec.key)
  await applyNodeProperties(node, spec, state, parent)
  state.nodeIdsByKey[spec.key] = node.id
  for (const child of children) applyMask(child.node, child.spec, state)
  return node
}

function desiredChildIndex(
  spec: CanvasNodeSpec,
  following: CanvasNodeSpec[],
  state: ApplyState,
  parent: CanvasParentNode,
  previous?: SupportedCanvasNode,
  forcedNode?: SupportedCanvasNode,
  minimumIndex = 0
): number {
  const existing = findExistingNode(spec, state, forcedNode)
  const currentIndex = existing?.parent?.id === parent.id ? parent.children.indexOf(existing) : -1
  if (!previous) {
    if (currentIndex >= 0) return currentIndex
    for (const candidate of following) {
      const followingNode = findExistingNode(candidate, state)
      if (followingNode?.parent?.id !== parent.id) continue
      return Math.max(minimumIndex, parent.children.indexOf(followingNode))
    }
    return Math.max(minimumIndex, parent.children.length)
  }

  const previousIndex = parent.children.indexOf(previous)
  if (currentIndex > previousIndex) return currentIndex
  return currentIndex >= 0 && currentIndex < previousIndex ? previousIndex : previousIndex + 1
}

export async function reconcileNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: CanvasParentNode,
  index = 0,
  forcedNode?: SupportedCanvasNode
): Promise<SupportedCanvasNode> {
  const existing = resolveExistingNode(spec, state, forcedNode)
  if (!existing && isWrappedSpec(spec)) {
    try {
      return await reconcileNewWrappedContainer(spec, state, parent, index)
    } catch (error) {
      throwNodeError(error, spec.key, state.nodeIdsByKey[spec.key])
    }
  }
  let node = existing
  try {
    node ??=
      spec.type === 'SLOT' ? createSlotNode(spec, parent, state) : await createNode(spec, state)
    if (parent) moveIntoParent(node, parent, index, state)
    setNodeKey(state, node, spec.key)
  } catch (error) {
    throwNodeError(error, spec.key, node?.id)
  }
  if (!isIntrinsicNode(node)) {
    await applyNodeProperties(node, spec, state, parent)
  }
  state.nodeIdsByKey[spec.key] = node.id

  const children: ReconciledChild[] = []
  if (spec.children?.length) {
    if (
      node.type !== 'BOOLEAN_OPERATION' &&
      node.type !== 'COMPONENT' &&
      node.type !== 'COMPONENT_SET' &&
      node.type !== 'FRAME' &&
      node.type !== 'GROUP' &&
      node.type !== 'SECTION' &&
      node.type !== 'SLOT'
    ) {
      specError(`Node "${spec.key}" of type ${node.type} cannot contain desired children.`)
    }
    for (const [childIndex, child] of spec.children.entries()) {
      children.push({
        node: await reconcileNode(
          child,
          state,
          node,
          desiredChildIndex(
            child,
            spec.children.slice(childIndex + 1),
            state,
            node,
            children.at(-1)?.node
          )
        ),
        spec: child
      })
    }
  }
  if (isFrameContainer(node)) finalizeGrid(node, spec, children, state)
  for (const child of children) applyMask(child.node, child.spec, state)
  if (isIntrinsicNode(node)) {
    await applyNodeProperties(node, spec, state, parent)
  }
  return node
}
