import type { CanvasFigmaPaint, CanvasHyperlink } from '@tempad-dev/shared'

import type {
  SupportedCanvasNode,
  WrappedContainerSpec,
  IntrinsicContainerNode,
  CanvasParentNode,
  CanvasFrameContainerNode,
  ApplyState
} from './state'

import { getCurrentContextNodeById, getNodeById, getContainingPage } from '../../../local-resources'
import { scopeError, specError } from '../errors'
import { readOwnedNodeKey, pagesByKey } from '../identity'
import {
  isCanvasNodeType,
  type CanvasNodeTypeHints,
  type CanvasPreservedNodeType,
  type CanvasGridHint,
  isPreservedNodeType,
  type CanvasNodeSpec,
  isIntrinsicContainer,
  isFrameContainerType
} from '../model'
import { walkAuthoringNodes, isInsideInstance } from '../traversal'

export function isSupportedSceneNode(node: BaseNode | null): node is SupportedCanvasNode {
  return !!node && isCanvasNodeType(node.type)
}

export function isSceneNode(node: BaseNode | null): node is SceneNode {
  return !!node && 'x' in node && 'y' in node
}

export async function lookupNodeById(id: string): Promise<BaseNode | null> {
  const node = getCurrentContextNodeById(id) ?? (await getNodeById(id))
  return node && !node.removed ? node : null
}

export async function collectUpdateNodeTypeHints(
  targetNodeId: string
): Promise<CanvasNodeTypeHints | undefined> {
  const target = await lookupNodeById(targetNodeId)
  if (!isSupportedSceneNode(target)) return undefined

  const byKey = new Map<string, CanvasPreservedNodeType>()
  const byNodeId = new Map<string, CanvasPreservedNodeType>()
  const keys = new Set<string>()
  const grids = new Map<string, CanvasGridHint>()
  for (const node of walkAuthoringNodes([target])) {
    const key = readOwnedNodeKey(node)
    if (key) keys.add(key)
    if (isSupportedSceneNode(node) && isFrameContainer(node) && node.layoutMode === 'GRID') {
      const grid = {
        itemsPositioning: node.gridItemsPositioning,
        children: node.children.flatMap((child) =>
          'gridRowAnchorIndex' in child && child.layoutPositioning !== 'ABSOLUTE'
            ? [
                {
                  id: child.id,
                  key: readOwnedNodeKey(child),
                  row: child.gridRowAnchorIndex,
                  column: child.gridColumnAnchorIndex,
                  rowSpan: child.gridRowSpan,
                  columnSpan: child.gridColumnSpan
                }
              ]
            : []
        )
      }
      grids.set(node.id, grid)
      if (key) grids.set(key, grid)
    }
    if (!isPreservedNodeType(node.type)) continue
    const type = node.type
    byNodeId.set(node.id, type)
    if (key && !byKey.has(key)) byKey.set(key, type)
  }

  const root = isPreservedNodeType(target.type) ? target.type : undefined
  return { byKey, byNodeId, keys, grids, ...(root ? { root } : {}) }
}

export function isMaskNode(node: SceneNode): boolean {
  return 'isMask' in node && node.isMask
}

export function isWrappedSpec(spec: CanvasNodeSpec): spec is WrappedContainerSpec {
  return spec.type === 'BOOLEAN_OPERATION' || spec.type === 'COMPONENT_SET' || spec.type === 'GROUP'
}

export function isIntrinsicNode(node: SupportedCanvasNode): node is IntrinsicContainerNode {
  return isIntrinsicContainer(node.type)
}

export function isFrameContainer(
  node: SupportedCanvasNode | CanvasParentNode
): node is CanvasFrameContainerNode {
  return isFrameContainerType(node.type)
}

export function isWithinScope(node: BaseNode, scope: BaseNode): boolean {
  let current: BaseNode | null = node
  while (current) {
    if (current.id === scope.id) return true
    current = current.parent
  }
  return false
}

export function assertOutsideInstance(node: BaseNode): void {
  if (isInsideInstance(node)) {
    scopeError(`Node "${node.id}" is inside an instance and cannot be targeted by apply_canvas.`)
  }
}

export function containingPage(node: BaseNode): PageNode {
  const page = getContainingPage(node)
  if (page) return page
  scopeError(`Node "${node.id}" is not attached to a page.`)
}

export function pageByKey(key: string): PageNode | undefined {
  const matches = pagesByKey(key)
  if (matches.length > 1) specError(`Page key "${key}" identifies more than one local page.`)
  return matches[0]
}

export function collectKeyedNodes(scope: SupportedCanvasNode): Map<string, SupportedCanvasNode> {
  const keyed = new Map<string, SupportedCanvasNode>()
  for (const node of walkAuthoringNodes([scope])) {
    if (!isSupportedSceneNode(node)) continue
    const key = readOwnedNodeKey(node)
    if (!key) continue
    if (keyed.has(key)) {
      scopeError(
        `Canvas key "${key}" is duplicated on nodes "${keyed.get(key)?.id}" and "${node.id}" inside the update scope. Narrow targetNodeId to one managed subtree, or ask the user to remove the duplicate.`
      )
    }
    keyed.set(key, node)
  }
  return keyed
}

export function* walkSpecs(spec: CanvasNodeSpec): Generator<CanvasNodeSpec> {
  yield spec
  for (const child of spec.children ?? []) yield* walkSpecs(child)
}

export function collectDesiredKeys(root: CanvasNodeSpec): Set<string> {
  return new Set([...walkSpecs(root)].map((spec) => spec.key))
}

export async function resolveExplicitNodes(root: CanvasNodeSpec, state: ApplyState): Promise<void> {
  const ids = new Set<string>()
  for (const spec of walkSpecs(root)) {
    if (spec.nodeId) ids.add(spec.nodeId)
  }
  const orderedIds = [...ids]
  const nodes = await Promise.all(orderedIds.map(lookupNodeById))
  for (const [index, id] of orderedIds.entries()) {
    const node = nodes[index] ?? null
    const supported = isSupportedSceneNode(node) ? node : null
    if (supported) assertOutsideInstance(supported)
    state.explicitNodes.set(id, supported)
  }
}

export function resolveCanvasKey(key: string, state: ApplyState): SupportedCanvasNode {
  const node = state.keyedNodes.get(key) ?? null
  if (!isSupportedSceneNode(node)) {
    specError(`Canvas key "${key}" did not resolve to a reconciled scene node.`)
  }
  state.referencedNodeIds.add(node.id)
  return node
}

export function outermostNodes(nodes: SupportedCanvasNode[]): SupportedCanvasNode[] {
  const ids = new Set(nodes.map((node) => node.id))
  return nodes.filter((node) => {
    let parent = node.parent
    while (parent) {
      if (ids.has(parent.id)) return false
      parent = parent.parent
    }
    return true
  })
}

export function findExistingNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  forcedNode?: SupportedCanvasNode
): SupportedCanvasNode | null {
  if (forcedNode) return forcedNode
  if (spec.nodeId) {
    return state.explicitNodes.get(spec.nodeId) ?? null
  }
  return state.keyedNodes.get(spec.key) ?? null
}

function validateExistingNodeIdentity(
  spec: CanvasNodeSpec,
  state: ApplyState,
  node: SupportedCanvasNode
): void {
  const keyedNode = state.keyedNodes.get(spec.key)
  if (keyedNode && keyedNode.id !== node.id) {
    specError(
      `Canvas key "${spec.key}" already identifies node "${keyedNode.id}", not "${node.id}".`
    )
  }
  if (state.scope && !isWithinScope(node, state.scope)) {
    scopeError(`Node "${node.id}" is outside the requested update scope.`)
  }
  if (node.type !== spec.type) {
    const recovery =
      spec.type === 'INSTANCE'
        ? ' A keyed primitive cannot become an instance in place; give the instance a new key and remove the primitive key in the same update.'
        : node.type === 'INSTANCE'
          ? ' Omit this keyed subtree to preserve the instance in a partial ancestor update, or include its component binding when the instance itself is part of the desired result.'
          : ''
    specError(
      `Canvas key "${spec.key}" expects ${spec.type}, but node "${node.id}" is ${node.type}.${recovery}`
    )
  }
}

export function preflightExistingNodeIdentities(
  root: CanvasNodeSpec,
  state: ApplyState,
  target: SupportedCanvasNode | null
): void {
  const claimed = new Set<string>()
  const visit = (spec: CanvasNodeSpec, forcedNode?: SupportedCanvasNode): void => {
    const node = findExistingNode(spec, state, forcedNode)
    if (!node) {
      if (spec.nodeId) {
        scopeError(`Node "${spec.nodeId}" does not exist or is not supported by apply_canvas.`)
      }
    } else {
      validateExistingNodeIdentity(spec, state, node)
      if (claimed.has(node.id)) {
        specError(`Node "${node.id}" is referenced more than once in the desired result.`)
      }
      claimed.add(node.id)
    }
    for (const child of spec.children ?? []) visit(child)
  }
  visit(root, target ?? undefined)
}

export function resolveExistingNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  forcedNode?: SupportedCanvasNode
): SupportedCanvasNode | null {
  const node = findExistingNode(spec, state, forcedNode)
  if (!node) {
    if (spec.nodeId) {
      scopeError(`Node "${spec.nodeId}" does not exist or is not supported by apply_canvas.`)
    }
    return null
  }

  validateExistingNodeIdentity(spec, state, node)
  if (state.claimedNodeIds.has(node.id)) {
    specError(`Node "${node.id}" is referenced more than once in the desired result.`)
  }
  state.claimedNodeIds.add(node.id)
  return node
}

function hasCanvasKeyPattern(paints: CanvasFigmaPaint[] | undefined): boolean {
  return (
    paints?.some((paint) => paint.type === 'PATTERN' && paint.sourceCanvasKey !== undefined) ??
    false
  )
}

export function hasCanvasKeyPaints(spec: CanvasNodeSpec): boolean {
  return hasCanvasKeyPattern(spec.figma?.fills) || hasCanvasKeyPattern(spec.figma?.strokes)
}

export function hasCanvasKeyVectorPattern(spec: CanvasNodeSpec): boolean {
  return (
    spec.figma?.shape?.type === 'VECTOR' &&
    (spec.figma.shape.network?.regions?.some((region) => hasCanvasKeyPattern(region.fills)) ??
      false)
  )
}

export function isCanvasKeyHyperlink(
  hyperlink: CanvasHyperlink | undefined
): hyperlink is { type: 'NODE'; value: { canvasKey: string } } {
  return hyperlink?.type === 'NODE' && typeof hyperlink.value !== 'string'
}

export function hasDeferredTextRanges(spec: CanvasNodeSpec): boolean {
  const ranges = spec.figma?.text?.ranges
  return (
    ranges !== undefined &&
    (hasCanvasKeyPaints(spec) ||
      isCanvasKeyHyperlink(spec.figma?.text?.hyperlink) ||
      ranges.some(
        (range) => hasCanvasKeyPattern(range.fills) || isCanvasKeyHyperlink(range.hyperlink)
      ))
  )
}

export function nativeHyperlink(
  hyperlink: CanvasHyperlink | undefined,
  state: ApplyState
): HyperlinkTarget | null | undefined {
  if (hyperlink === undefined || hyperlink === null || hyperlink.type === 'URL') {
    return hyperlink
  }
  return {
    type: 'NODE',
    value:
      typeof hyperlink.value === 'string'
        ? hyperlink.value
        : resolveCanvasKey(hyperlink.value.canvasKey, state).id
  }
}
