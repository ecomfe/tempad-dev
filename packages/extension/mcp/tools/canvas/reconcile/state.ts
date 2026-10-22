import type { ApplyCanvasResult } from '@tempad-dev/shared'

import type { ResolvedCanvasAssets } from '../assets'
import type { CanvasNodeSpec } from '../model'

import { specError } from '../errors'
import { type CanvasFontState, createFontState } from '../fonts'
import { type MutationCounter, claimNodeKey } from '../identity'
import { type CanvasMediaState, createMediaState } from '../media'
import { type CanvasStyleState, createStyleState } from '../styles'
import { type CanvasVariableState, createVariableState } from '../variables'
import { scalarValuesEqual } from './comparison'
import { collectKeyedNodes } from './nodes'
import { protectNode } from './undo'

export type SupportedCanvasNode = Extract<SceneNode, { type: CanvasNodeSpec['type'] }>

export type CanvasFrameContainerNode = ComponentNode | ComponentSetNode | FrameNode | SlotNode

export type CanvasParentNode =
  | BooleanOperationNode
  | ComponentNode
  | ComponentSetNode
  | FrameNode
  | GroupNode
  | PageNode
  | SectionNode
  | SlotNode

export type IntrinsicContainerNode = BooleanOperationNode | GroupNode

export type WrappedContainerNode = ComponentSetNode | IntrinsicContainerNode

export type WrappedContainerSpec = CanvasNodeSpec & { type: WrappedContainerNode['type'] }

export type ProtectedNodeSnapshot = {
  content: string
  childIds: string[] | null
  componentPropertyNames: string[] | null
  geometry: { height: number; width: number; x: number; y: number } | null
  key: string
  owner: string
  parentId: string | null
  type: BaseNode['type']
  textSegments?: string
}

export type ApplyState = {
  media: CanvasMediaState
  claimedNodeIds: Set<string>
  componentCache: Map<string, ComponentNode>
  componentPropertyKeys: Map<string, Record<string, string>>
  createdNodeIds: Set<string>
  createdPageIds: Set<string>
  desiredKeys: Set<string>
  explicitNodes: Map<string, SupportedCanvasNode | null>
  fonts: CanvasFontState
  ignoredLiteralWarnings: VerificationWarning[]
  keyedNodes: Map<string, SupportedCanvasNode>
  mutations: MutationCounter
  nodeIdsByKey: Record<string, string>
  pendingGridRemovalCleanupNodeIds: Set<string>
  protectedNodes: Map<string, { node: BaseNode; snapshot?: ProtectedNodeSnapshot }>
  removalNodeIds: Set<string>
  referencedNodeIds: Set<string>
  scope: SupportedCanvasNode | null
  shaderCache: Map<string, Shader>
  stabilizedCrossAxisFillNodeIds: Set<string>
  styles: CanvasStyleState
  textRangeSemanticOverrides: Map<string, boolean>
  updatedNodeIds: Set<string>
  undoStarted: boolean
  variables: CanvasVariableState
}

export function markMutation(state: ApplyState, node: BaseNode): void {
  state.mutations.count += 1
  if (!state.createdNodeIds.has(node.id)) {
    state.updatedNodeIds.add(node.id)
  }
}

export function setNodeKey(state: ApplyState, node: SupportedCanvasNode, key: string): void {
  const changed = claimNodeKey(node, key)
  state.keyedNodes.set(key, node)
  if (changed) markMutation(state, node)
}

export function recordCreatedNode(
  node: SupportedCanvasNode,
  state: ApplyState,
  claimed = true
): void {
  state.mutations.count += 1
  state.createdNodeIds.add(node.id)
  if (claimed) state.claimedNodeIds.add(node.id)
}

export function moveIntoParent<Child extends BaseNode>(
  node: Child,
  parent: BaseNode & {
    readonly children: readonly Child[]
    insertChild(index: number, child: Child): void
  },
  index: number,
  state: ApplyState
): void {
  const sameParent = node.parent?.id === parent.id
  if (sameParent && parent.children.indexOf(node) === index) return
  const preceding = sameParent ? [] : parent.children.slice(0, index)
  parent.insertChild(index, node)
  // Moving out of a Group can remove that Group (and empty ancestor Groups)
  // from this parent, shifting the requested insertion slot.
  const expectedIndex = index - preceding.filter((sibling) => sibling.removed).length
  if ((sameParent || expectedIndex !== index) && parent.children.indexOf(node) !== expectedIndex) {
    const currentIndex = parent.children.indexOf(node)
    parent.insertChild(currentIndex < expectedIndex ? expectedIndex + 1 : expectedIndex, node)
  }
  if (parent.children.indexOf(node) !== expectedIndex) {
    specError(`Node "${node.id}" could not be placed at child index ${expectedIndex}.`)
  }
  markMutation(state, node)
}

export function setValue<T>(
  node: BaseNode,
  current: unknown,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || scalarValuesEqual(current, desired)) return
  apply(desired)
  markMutation(state, node)
}

export function createApplyState(
  target: SupportedCanvasNode | null,
  desiredKeys: Set<string>,
  assets: ResolvedCanvasAssets = new Map()
): ApplyState {
  const state: ApplyState = {
    media: createMediaState(assets),
    claimedNodeIds: new Set(),
    componentCache: new Map(),
    componentPropertyKeys: new Map(),
    createdNodeIds: new Set(),
    createdPageIds: new Set(),
    desiredKeys,
    explicitNodes: new Map(),
    fonts: createFontState(),
    ignoredLiteralWarnings: [],
    keyedNodes: target ? collectKeyedNodes(target) : new Map(),
    mutations: { count: 0 },
    nodeIdsByKey: Object.create(null) as Record<string, string>,
    pendingGridRemovalCleanupNodeIds: new Set(),
    protectedNodes: new Map(),
    removalNodeIds: new Set(),
    referencedNodeIds: new Set(),
    scope: target,
    shaderCache: new Map(),
    stabilizedCrossAxisFillNodeIds: new Set(),
    styles: createStyleState(),
    textRangeSemanticOverrides: new Map(),
    updatedNodeIds: new Set(),
    undoStarted: false,
    variables: createVariableState()
  }
  if (target) protectNode(state, target)
  return state
}

export type VerificationWarning = ApplyCanvasResult['verification']['warnings'][number]
