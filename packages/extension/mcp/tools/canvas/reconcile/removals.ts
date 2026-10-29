import type { ApplyCanvasResult } from '@tempad-dev/shared'

import type { ParsedCanvasTreeInput } from '../model'

import { getLocalPaintStyles, getLocalEffectStyles } from '../../../local-resources'
import { scopeError, specError, applyError } from '../errors'
import { readOwnedNodeKey } from '../identity'
import { walkAuthoringNodes, isComponentPropertyOwner, walkPhysicalNodes } from '../traversal'
import {
  isSupportedSceneNode,
  isWithinScope,
  isMaskNode,
  outermostNodes,
  lookupNodeById,
  assertOutsideInstance
} from './nodes'
import { resolveShader } from './resources'
import { removedRootResult, boundedApplyResult } from './results'
import { type ApplyState, type SupportedCanvasNode, createApplyState } from './state'
import { isOwnedSvgChild } from './svg'
import { withUndoBoundary } from './undo'

export function* walkRemovalOwnershipNodes(
  roots: Iterable<SceneNode>,
  state: ApplyState
): Generator<SceneNode> {
  const stack = [...roots]
  while (stack.length) {
    const node = stack.pop()!
    const svgWrapper = isOwnedSvgChild(node) && node.parent?.type === 'FRAME' ? node.parent : null
    const wrapperKey = svgWrapper && readOwnedNodeKey(svgWrapper)
    if (wrapperKey && state.keyedNodes.get(wrapperKey)?.id === svgWrapper.id) continue
    yield node
    if ('children' in node && node.type !== 'INSTANCE') {
      for (const child of node.children) stack.push(child)
    }
  }
}

export function validateRemovalOwnership(root: SupportedCanvasNode, state: ApplyState): void {
  for (const node of walkRemovalOwnershipNodes([root], state)) {
    if (!isSupportedSceneNode(node)) {
      scopeError(`Removing "${root.id}" would also remove an unsupported canvas node.`)
    }
    const key = readOwnedNodeKey(node)
    if (!key || state.keyedNodes.get(key)?.id !== node.id) {
      scopeError(`Removing "${root.id}" would also remove a node not owned by apply_canvas.`)
    }
  }
}

export function validateRemovalAncestors(node: SupportedCanvasNode): void {
  let ancestor = node.parent
  while (ancestor) {
    if ((ancestor.type === 'COMPONENT' || ancestor.type === 'COMPONENT_SET') && ancestor.remote) {
      scopeError(`Remote ${ancestor.type.toLowerCase()} "${ancestor.id}" is read-only.`)
    }
    ancestor = ancestor.parent
  }
}

export function resolveRemovalNodes(
  input: ParsedCanvasTreeInput,
  state: ApplyState
): SupportedCanvasNode[] {
  const nodes: SupportedCanvasNode[] = []
  for (const key of input.removeKeys) {
    const node = state.keyedNodes.get(key)
    if (!node) continue
    if (node.id === state.scope?.id) {
      scopeError('The update root cannot be removed.')
    }
    validateRemovalAncestors(node)
    validateRemovalOwnership(node, state)
    state.removalNodeIds.add(node.id)
    nodes.push(node)
  }
  return nodes
}

function collectRemovalComponents(roots: SupportedCanvasNode[]): ComponentNode[] {
  const components: ComponentNode[] = []
  for (const node of walkAuthoringNodes(roots)) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      if (node.remote) {
        scopeError(`Remote ${node.type.toLowerCase()} "${node.id}" cannot be removed.`)
      }
      if (node.type === 'COMPONENT') components.push(node)
    }
  }
  return components
}

export async function validateRemovalComponents(roots: SupportedCanvasNode[]): Promise<void> {
  for (const component of collectRemovalComponents(roots)) {
    const instances = await component.getInstancesAsync()
    if (
      instances.some(
        (instance) => !instance.removed && !roots.some((root) => isWithinScope(instance, root))
      )
    ) {
      scopeError(`Component "${component.id}" has instances outside the removal scope.`)
    }
  }
}

type RemovalReferences = {
  removed: { componentKeys: Set<string>; nodeIds: Set<string> }
  shaders: Array<ShaderEffect | ShaderPaint>
}

function validateRemovalReference(value: string, removed: Set<string>, kind: string): void {
  if (removed.has(value)) {
    scopeError(`${kind} "${value}" is still referenced outside the removal scope.`)
  }
}

function collectReferences(value: unknown, references: RemovalReferences): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, references))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.type === 'PATTERN' && typeof record.sourceNodeId === 'string') {
    validateRemovalReference(record.sourceNodeId, references.removed.nodeIds, 'Node')
  } else if (record.type === 'NODE' && typeof record.value === 'string') {
    validateRemovalReference(record.value, references.removed.nodeIds, 'Node')
  } else if (record.type === 'SHADER' && typeof record.id === 'string') {
    references.shaders.push(value as ShaderEffect | ShaderPaint)
  }
  Object.values(record).forEach((item) => collectReferences(item, references))
}

function collectComponentReferences(
  properties: ComponentProperties | ComponentPropertyDefinitions,
  references: RemovalReferences
): void {
  for (const property of Object.values(properties)) {
    if (property.type === 'INSTANCE_SWAP') {
      const value = 'defaultValue' in property ? property.defaultValue : property.value
      if (typeof value === 'string') {
        validateRemovalReference(value, references.removed.nodeIds, 'Node')
      }
    }
    for (const preferred of property.preferredValues ?? []) {
      validateRemovalReference(preferred.key, references.removed.componentKeys, 'Component key')
    }
  }
}

function collectSceneReferences(node: SceneNode, references: RemovalReferences): void {
  const record = node as unknown as Record<string, unknown>
  collectReferences(record.fills, references)
  collectReferences(record.strokes, references)
  collectReferences(record.effects, references)
  if (node.type === 'VECTOR') {
    collectReferences(node.vectorNetwork.regions, references)
  }
  if (isComponentPropertyOwner(node)) {
    collectComponentReferences(node.componentPropertyDefinitions, references)
  } else if (node.type === 'INSTANCE') {
    collectComponentReferences(node.componentProperties, references)
  }
  if (node.type !== 'TEXT') return
  collectReferences(node.hyperlink, references)
  if (node.hyperlink !== figma.mixed && node.fills !== figma.mixed) return
  let segments: Array<Pick<StyledTextSegment, 'fills' | 'hyperlink'>>
  try {
    segments = node.getStyledTextSegments(['fills', 'hyperlink'])
  } catch {
    scopeError(`Rich text on node "${node.id}" could not be inspected before node removal.`)
  }
  collectReferences(segments, references)
}

function collectRemovedIdentities(roots: SupportedCanvasNode[]): {
  componentKeys: Set<string>
  nodeIds: Set<string>
} {
  const componentKeys = new Set<string>()
  const nodeIds = new Set([...walkPhysicalNodes(roots)].map((node) => node.id))
  for (const node of walkAuthoringNodes(roots)) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.key) {
      componentKeys.add(node.key)
    }
  }
  return { componentKeys, nodeIds }
}

const fullyLoadedRemovalDocuments = new WeakSet<DocumentNode>()

export async function loadRemovalPages(roots: SupportedCanvasNode[]): Promise<void> {
  if (
    !roots.length ||
    fullyLoadedRemovalDocuments.has(figma.root) ||
    !figma.root.children.some((page) => page.id !== figma.currentPage.id)
  )
    return
  try {
    await figma.loadAllPagesAsync()
    fullyLoadedRemovalDocuments.add(figma.root)
  } catch {
    scopeError('Document pages could not be inspected before node removal.')
  }
}

export async function validateRemovalReferences(
  roots: SupportedCanvasNode[],
  state: ApplyState
): Promise<void> {
  const removed = collectRemovedIdentities(roots)
  // Reparenting the last child can auto-delete a Group before this final scan.
  // Keep its explicit removal identity without including children rescued from it.
  for (const id of state.removalNodeIds) removed.nodeIds.add(id)
  if (!removed.nodeIds.size) return
  const references: RemovalReferences = {
    removed,
    shaders: []
  }
  await loadRemovalPages(roots)
  for (const page of figma.root.children) {
    collectReferences(page.backgrounds, references)
    for (const node of walkPhysicalNodes(page.children)) {
      if (removed.nodeIds.has(node.id)) continue
      collectSceneReferences(node, references)
    }
  }
  const removedStyleIds = new Set(state.styles.removals.map(({ style }) => style.id))
  const [paintStyles, effectStyles] = await Promise.all([
    getLocalPaintStyles(),
    getLocalEffectStyles()
  ])
  for (const style of [...paintStyles, ...effectStyles]) {
    if (removedStyleIds.has(style.id)) continue
    collectReferences(style.type === 'PAINT' ? style.paints : style.effects, references)
  }
  for (const usage of references.shaders) {
    const candidates = Object.entries(usage.properties ?? {}).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        (removed.nodeIds.has(entry[1]) || removed.componentKeys.has(entry[1]))
    )
    if (!candidates.length) continue
    const definitions = (await resolveShader(usage.id, state)).propertyDefinitions ?? {}
    for (const [propertyId, value] of candidates) {
      const type = definitions[propertyId]?.type
      if (type === 'INSTANCE_SWAP' || type === 'SLOT') {
        validateRemovalReference(value, removed.nodeIds, 'Node')
        validateRemovalReference(value, removed.componentKeys, 'Component key')
      }
    }
  }
}

function validateRemovalResult(roots: SupportedCanvasNode[], state: ApplyState): void {
  for (const root of roots) {
    for (const node of walkPhysicalNodes([root])) {
      if (state.claimedNodeIds.has(node.id)) {
        specError(`Desired node "${node.id}" would remain inside a removed subtree.`)
      }
      if (state.referencedNodeIds.has(node.id)) {
        specError(`Referenced node "${node.id}" would be removed by this result.`)
      }
    }
  }

  const rootsByParent = new Map<BaseNode & ChildrenMixin, Set<string>>()
  for (const root of roots) {
    const parent = root.parent
    if (!parent || !('children' in parent)) continue
    const ids = rootsByParent.get(parent) ?? new Set<string>()
    ids.add(root.id)
    rootsByParent.set(parent, ids)
  }
  for (const [parent, removedIds] of rootsByParent) {
    const remaining = parent.children.filter((child) => !removedIds.has(child.id))
    if (
      parent.children.some(isMaskNode) &&
      remaining.some((child) => !state.claimedNodeIds.has(child.id))
    ) {
      specError(
        `Removing a sibling in mask container "${parent.id}" requires every remaining sibling in the desired result.`
      )
    }
    const last = remaining.at(-1)
    if (last && isMaskNode(last)) {
      specError(`Mask "${last.id}" must precede at least one remaining sibling.`)
    }
    if (parent.type === 'GROUP' && remaining.length < 1) {
      specError(`Removing these nodes would implicitly remove group "${parent.id}".`)
    }
    if (parent.type === 'BOOLEAN_OPERATION' && remaining.length < 2) {
      specError(`Boolean operation "${parent.id}" requires at least two remaining operands.`)
    }
    if (parent.type === 'COMPONENT_SET' && remaining.length < 1) {
      specError(`Component set "${parent.id}" requires at least one remaining variant.`)
    }
  }
}

export async function applyRemovals(
  removalNodes: SupportedCanvasNode[],
  state: ApplyState
): Promise<string[]> {
  const roots = outermostNodes(removalNodes.filter((node) => !node.removed))
  validateRemovalResult(roots, state)
  await validateRemovalReferences(roots, state)
  removeValidatedNodes(roots, state)
  return removalNodes.map((node) => node.id)
}

function removeValidatedNodes(roots: SupportedCanvasNode[], state: ApplyState): void {
  for (const root of roots) {
    root.remove()
    state.mutations.count += 1
  }
}

export async function removeUpdateRoot(targetNodeId: string): Promise<ApplyCanvasResult> {
  const candidate = await lookupNodeById(targetNodeId)
  if (!candidate) return removedRootResult(targetNodeId)
  if (!isSupportedSceneNode(candidate)) {
    scopeError('The requested removal target is not a supported scene node.')
  }
  assertOutsideInstance(candidate)

  const state = createApplyState(candidate, new Set())
  validateRemovalAncestors(candidate)
  validateRemovalOwnership(candidate, state)
  state.removalNodeIds.add(candidate.id)
  const parent = candidate.parent
  await loadRemovalPages([candidate])
  await validateRemovalComponents([candidate])
  validateRemovalResult([candidate], state)
  await validateRemovalReferences([candidate], state)

  return withUndoBoundary(async () => {
    removeValidatedNodes([candidate], state)
    const removedNodeIds = [candidate.id]
    if (
      !candidate.removed &&
      (!parent ||
        !('children' in parent) ||
        parent.children.some((child) => child.id === candidate.id))
    ) {
      applyError(`Verification failed: root "${candidate.id}" is still present.`)
    }
    return boundedApplyResult(removedRootResult(candidate.id, removedNodeIds, state))
  }, state)
}
