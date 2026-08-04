import {
  type ApplyCanvasResult,
  type CanvasDesignReference,
  type CanvasFigmaComponentPropertyDefinition,
  type CanvasFigmaEffect,
  type CanvasFigmaLayoutGrid,
  type CanvasFigmaPaint,
  type CanvasFigmaShaderPropertyValue,
  type CanvasFigmaSlotProperty,
  type CanvasFigmaTextRange,
  type CanvasFigmaVectorNetwork,
  type CanvasHyperlink,
  type CanvasPageProperties,
  type CanvasStyleBindings,
  type CanvasStyleReference,
  type CanvasStyleResource,
  type CanvasVariableBindings,
  type CanvasVariableReference,
  TEMPAD_MCP_ERROR_CODES
} from '@tempad-dev/shared'

import type {
  CanvasGridLayout,
  CanvasGridTrack,
  CanvasNodeSpec,
  ParsedCanvasInput,
  ParsedCanvasTreeInput
} from './model'

import { readBoundedResponseBytes } from '../../bounded-response'
import { createCodedError } from '../../errors'
import {
  type ResolvedCanvasAssets,
  resolveCanvasAssets,
  resolvedImageAsset,
  resolvedSvgAsset,
  SVG_POLICY_VERSION
} from './assets'
import { canvasReadOnlyError, scopeError, specError } from './errors'
import {
  CANVAS_KEY_NAMESPACE,
  CANVAS_NODE_KEY_NAME,
  CANVAS_PAGE_KEY_NAME,
  type MutationCounter,
  designReferenceCacheKey
} from './identity'
import {
  type CanvasStyleState,
  createStyleState,
  prepareStyleResources,
  removeStyleResources,
  resolveStyle
} from './styles'
import {
  type CanvasVariableState,
  createVariableState,
  reconcileVariableCollections,
  removeVariableResources,
  resolveCollection,
  resolveModeId,
  resolvedCollection,
  resolvedModeId,
  resolvedVariable,
  resolveVariable,
  variableReferenceCacheKey
} from './variables'
import { canonicalVectorPaths, vectorPathsEqual } from './vector'

const CANVAS_COUNTER_AXIS_SYNC_NAME = 'counter-axis-spacing-sync'
const CANVAS_COMPONENT_PROPERTY_KEYS_NAME = 'component-property-keys'
const CANVAS_SVG_CHILD_NAME = 'svg-child'
const CANVAS_SVG_COLOR_NAME = 'svg-color'
const CANVAS_SVG_DIGEST_NAME = 'svg-digest'
const CANVAS_SVG_POLICY_NAME = 'svg-policy'
const MAX_VIDEO_BYTES = 100 * 1024 * 1024
const ROOT_PLACEMENT_GAP = 80
const GEOMETRY_TOLERANCE = 0.01
const MAX_IMPORTED_IMAGE_HASHES = 256
const importedImageHashes = new Map<string, string>()
const SUPPORTED_NODE_TYPES = new Set<CanvasNodeSpec['type']>([
  'BOOLEAN_OPERATION',
  'COMPONENT',
  'COMPONENT_SET',
  'FRAME',
  'GROUP',
  'INSTANCE',
  'SECTION',
  'SLOT',
  'TEXT',
  'RECTANGLE',
  'LINE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'VECTOR'
])

type SupportedCanvasNode = Extract<SceneNode, { type: CanvasNodeSpec['type'] }>
type CanvasFrameContainerNode = ComponentNode | ComponentSetNode | FrameNode | SlotNode
type CanvasParentNode =
  | BooleanOperationNode
  | ComponentNode
  | ComponentSetNode
  | FrameNode
  | GroupNode
  | PageNode
  | SectionNode
  | SlotNode
type IntrinsicContainerNode = BooleanOperationNode | GroupNode
type WrappedContainerNode = ComponentSetNode | IntrinsicContainerNode
type WrappedContainerSpec = CanvasNodeSpec & { type: WrappedContainerNode['type'] }
type ComponentPropertyOwner = ComponentNode | ComponentSetNode
type ComponentPropertyReferenceField = 'characters' | 'mainComponent' | 'visible'
type ComponentPropertyContext = {
  existing?: ComponentPropertyOwner
  spec?: CanvasNodeSpec
}

type ApplyState = {
  assets: ResolvedCanvasAssets
  claimedNodeIds: Set<string>
  componentCache: Map<string, ComponentNode>
  componentPropertyKeys: Map<string, Record<string, string>>
  createdNodeIds: Set<string>
  desiredKeys: Set<string>
  fontLoads: Map<string, Promise<void>>
  imageHashes: Map<string, string>
  imageAssetKeys: Set<string>
  imageUrls: Set<string>
  keyedNodes: Map<string, SupportedCanvasNode>
  mutations: MutationCounter
  nodeIdsByKey: Record<string, string>
  removalNodeIds: Set<string>
  referencedNodeIds: Set<string>
  scope: SupportedCanvasNode | null
  shaderCache: Map<string, Shader>
  styles: CanvasStyleState
  updatedNodeIds: Set<string>
  variables: CanvasVariableState
  videoHashes: Map<string, string>
  videoUrls: Set<string>
}

function isSupportedSceneNode(node: BaseNode | null): node is SupportedCanvasNode {
  return !!node && SUPPORTED_NODE_TYPES.has(node.type as CanvasNodeSpec['type'])
}

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return !!node && 'x' in node && 'y' in node
}

function isMaskNode(node: SceneNode): boolean {
  return 'isMask' in node && node.isMask
}

function isWrappedSpec(spec: CanvasNodeSpec): spec is WrappedContainerSpec {
  return spec.type === 'BOOLEAN_OPERATION' || spec.type === 'COMPONENT_SET' || spec.type === 'GROUP'
}

function isIntrinsicNode(node: SupportedCanvasNode): node is IntrinsicContainerNode {
  return node.type === 'BOOLEAN_OPERATION' || node.type === 'GROUP'
}

function isFrameContainer(
  node: SupportedCanvasNode | CanvasParentNode
): node is CanvasFrameContainerNode {
  return (
    node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET' ||
    node.type === 'FRAME' ||
    node.type === 'SLOT'
  )
}

function isWithinScope(node: BaseNode, scope: BaseNode): boolean {
  let current: BaseNode | null = node
  while (current) {
    if (current.id === scope.id) return true
    current = current.parent
  }
  return false
}

function containingPage(node: BaseNode): PageNode {
  let current: BaseNode | null = node
  while (current) {
    if (current.type === 'PAGE') return current
    current = current.parent
  }
  scopeError(`Node "${node.id}" is not attached to a page.`)
}

function pageById(id: string): PageNode | undefined {
  return figma.root.children.find((page) => page.id === id)
}

function pageByKey(key: string): PageNode | undefined {
  let match: PageNode | undefined
  for (const page of figma.root.children) {
    if (page.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME) !== key) {
      continue
    }
    if (match) specError(`Page key "${key}" identifies more than one local page.`)
    match = page
  }
  return match
}

async function resolveResultPage(
  properties: CanvasPageProperties | undefined,
  target: SupportedCanvasNode | null,
  state: ApplyState
): Promise<PageNode> {
  const containing = target ? containingPage(target) : figma.currentPage
  const id = properties?.id
  const key = properties?.pageKey
  const explicit = id ? pageById(id) : undefined
  if (id && !explicit) specError(`Page "${id}" does not exist.`)
  const keyed = key ? pageByKey(key) : undefined
  if (explicit && keyed && explicit.id !== keyed.id) {
    specError(`Page key "${key}" does not identify "${explicit.id}".`)
  }

  let page = explicit ?? keyed
  if (target) {
    if (page && page.id !== containing.id) {
      scopeError(`The update target belongs to page "${containing.id}", not "${page.id}".`)
    }
    page = containing
  }
  const createsPage = !page && key !== undefined
  if (createsPage && properties?.name === undefined) {
    specError(`New page "${key}" requires a name.`)
  }
  const index = properties?.index
  const maxIndex = figma.root.children.length - (createsPage ? 0 : 1)
  if (index !== undefined && index > maxIndex) {
    specError(`Page index ${index} exceeds the maximum index ${maxIndex}.`)
  }
  if (createsPage) {
    page = figma.createPage()
    state.mutations.count += 1
  }
  page ??= containing

  const currentKey = key ? page.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME) : ''
  if (key && currentKey && currentKey !== key) {
    specError(`Page "${page.id}" is already owned by authoring key "${currentKey}".`)
  }
  if (page.id !== figma.currentPage.id) await page.loadAsync()
  if (key && !currentKey) {
    page.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME, key)
    markMutation(state, page)
  }
  return page
}

function collectKeyedNodes(scope: SupportedCanvasNode): Map<string, SupportedCanvasNode> {
  const keyed = new Map<string, SupportedCanvasNode>()
  for (const node of walkNodes([scope])) {
    if (isSupportedSceneNode(node)) {
      const key = node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_KEY_NAME)
      if (key) {
        if (keyed.has(key)) {
          scopeError(`Canvas key "${key}" is duplicated inside the update scope.`)
        }
        keyed.set(key, node)
      }
    }
  }
  return keyed
}

function* walkNodes(roots: Iterable<BaseNode>, descendIntoInstances = true): Generator<BaseNode> {
  const stack = [...roots]
  while (stack.length) {
    const node = stack.pop()!
    yield node
    if ('children' in node && (descendIntoInstances || node.type !== 'INSTANCE')) {
      stack.push(...node.children)
    }
  }
}

function collectDesiredKeys(root: CanvasNodeSpec): Set<string> {
  const keys = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const spec = stack.pop()!
    keys.add(spec.key)
    stack.push(...(spec.children ?? []))
  }
  return keys
}

type CanvasNodeReference = { nodeId: string } | { canvasKey: string }

async function preflightNodeReference(
  reference: CanvasNodeReference,
  context: string,
  state: ApplyState,
  sceneOnly = false
): Promise<void> {
  if ('canvasKey' in reference) {
    if (!state.desiredKeys.has(reference.canvasKey) && !state.keyedNodes.has(reference.canvasKey)) {
      specError(
        `${context} canvas key "${reference.canvasKey}" does not exist in the desired result or update scope.`
      )
    }
    return
  }
  const node = await figma.getNodeByIdAsync(reference.nodeId)
  if (!node || (sceneOnly && !isSceneNode(node))) {
    specError(
      `${context} "${reference.nodeId}" does not exist${sceneOnly ? ' or is not a scene node' : ''}.`
    )
  }
  state.referencedNodeIds.add(node.id)
}

function resolveCanvasKey(key: string, state: ApplyState): SupportedCanvasNode {
  const nodeId = state.nodeIdsByKey[key]
  const node = (nodeId ? figma.getNodeById(nodeId) : state.keyedNodes.get(key)) ?? null
  if (!isSupportedSceneNode(node)) {
    specError(`Canvas key "${key}" did not resolve to a reconciled scene node.`)
  }
  state.referencedNodeIds.add(node.id)
  return node
}

function outermostNodes(nodes: SupportedCanvasNode[]): SupportedCanvasNode[] {
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

function validateRemovalOwnership(root: SupportedCanvasNode, state: ApplyState): void {
  for (const node of walkNodes([root], false)) {
    if (!isSupportedSceneNode(node)) {
      scopeError(`Removing "${root.id}" would also remove an unsupported canvas node.`)
    }
    const key = node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_KEY_NAME)
    if (!key || state.keyedNodes.get(key)?.id !== node.id) {
      scopeError(`Removing "${root.id}" would also remove a node not owned by apply_canvas.`)
    }
  }
}

function validateRemovalAncestors(node: SupportedCanvasNode): void {
  let ancestor = node.parent
  while (ancestor) {
    if ((ancestor.type === 'COMPONENT' || ancestor.type === 'COMPONENT_SET') && ancestor.remote) {
      scopeError(`Remote ${ancestor.type.toLowerCase()} "${ancestor.id}" is read-only.`)
    }
    ancestor = ancestor.parent
  }
}

function resolveRemovalNodes(
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
  for (const node of walkNodes(roots, false)) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      if (node.remote) {
        scopeError(`Remote ${node.type.toLowerCase()} "${node.id}" cannot be removed.`)
      }
      if (node.type === 'COMPONENT') components.push(node)
    }
  }
  return components
}

async function validateRemovalComponents(roots: SupportedCanvasNode[]): Promise<void> {
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
  componentKeys: Set<string>
  nodeIds: Set<string>
  shaders: Array<ShaderEffect | ShaderPaint>
}

function collectReferences(value: unknown, references: RemovalReferences): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, references))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.type === 'PATTERN' && typeof record.sourceNodeId === 'string') {
    references.nodeIds.add(record.sourceNodeId)
  } else if (record.type === 'NODE' && typeof record.value === 'string') {
    references.nodeIds.add(record.value)
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
      if (typeof value === 'string') references.nodeIds.add(value)
    }
    for (const preferred of property.preferredValues ?? []) {
      references.componentKeys.add(preferred.key)
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
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    collectComponentReferences(node.componentPropertyDefinitions, references)
  } else if (node.type === 'INSTANCE') {
    collectComponentReferences(node.componentProperties, references)
  }
  if (node.type !== 'TEXT') return
  collectReferences(node.hyperlink, references)
  try {
    collectReferences(node.getStyledTextSegments(['fills', 'hyperlink']), references)
  } catch {
    scopeError(`Rich text on node "${node.id}" could not be inspected before node removal.`)
  }
}

function collectRemovedIdentities(roots: SupportedCanvasNode[]): {
  componentKeys: Set<string>
  nodeIds: Set<string>
} {
  const componentKeys = new Set<string>()
  const nodeIds = new Set<string>()
  for (const node of walkNodes(roots, false)) {
    nodeIds.add(node.id)
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.key) {
      componentKeys.add(node.key)
    }
  }
  return { componentKeys, nodeIds }
}

async function validateRemovalReferences(
  roots: SupportedCanvasNode[],
  state: ApplyState
): Promise<void> {
  if (!roots.length) return
  const removed = collectRemovedIdentities(roots)
  const references: RemovalReferences = {
    componentKeys: new Set(),
    nodeIds: new Set(),
    shaders: []
  }
  for (const page of figma.root.children) {
    try {
      await page.loadAsync()
    } catch {
      scopeError(`Page "${page.id}" could not be inspected before node removal.`)
    }
    collectReferences(page.backgrounds, references)
    const pending = [...page.children]
    while (pending.length) {
      const node = pending.pop()!
      if (removed.nodeIds.has(node.id)) continue
      collectSceneReferences(node, references)
      if ('children' in node) pending.push(...node.children)
    }
  }
  const removedStyleIds = new Set(state.styles.removals.map(({ style }) => style.id))
  const [paintStyles, effectStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalEffectStylesAsync()
  ])
  for (const style of [...paintStyles, ...effectStyles]) {
    if (removedStyleIds.has(style.id)) continue
    collectReferences(style.type === 'PAINT' ? style.paints : style.effects, references)
  }
  for (const usage of references.shaders) {
    const definitions = (await resolveShader(usage.id, state)).propertyDefinitions ?? {}
    for (const [propertyId, value] of Object.entries(usage.properties ?? {})) {
      const type = definitions[propertyId]?.type
      if ((type === 'INSTANCE_SWAP' || type === 'SLOT') && typeof value === 'string') {
        references.nodeIds.add(value)
        references.componentKeys.add(value)
      }
    }
  }
  const nodeId = [...references.nodeIds].find((id) => removed.nodeIds.has(id))
  if (nodeId) scopeError(`Node "${nodeId}" is still referenced outside the removal scope.`)
  const componentKey = [...references.componentKeys].find((key) => removed.componentKeys.has(key))
  if (componentKey) {
    scopeError(`Component key "${componentKey}" is still referenced outside the removal scope.`)
  }
}

function validateRemovalResult(roots: SupportedCanvasNode[], state: ApplyState): void {
  for (const root of roots) {
    for (const node of walkNodes([root])) {
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

async function applyRemovals(
  removalNodes: SupportedCanvasNode[],
  state: ApplyState
): Promise<string[]> {
  const roots = outermostNodes(removalNodes.filter((node) => !node.removed))
  validateRemovalResult(roots, state)
  await validateRemovalComponents(roots)
  await validateRemovalReferences(roots, state)
  for (const root of roots) {
    root.remove()
    state.mutations.count += 1
  }
  return removalNodes.map((node) => node.id)
}

function markMutation(state: ApplyState, node: BaseNode): void {
  state.mutations.count += 1
  if (!state.createdNodeIds.has(node.id)) {
    state.updatedNodeIds.add(node.id)
  }
}

function setNodeKey(state: ApplyState, node: SupportedCanvasNode, key: string): void {
  const currentKey = node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_KEY_NAME)
  if (currentKey === key) return
  if (currentKey) {
    specError(`Node "${node.id}" is already owned by canvas key "${currentKey}".`)
  }
  node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_KEY_NAME, key)
  markMutation(state, node)
}

function componentPropertyOwner(node: BaseNode): ComponentPropertyOwner | null {
  let current = node.parent
  while (current) {
    if (current.type === 'COMPONENT_SET') return current
    if (current.type === 'COMPONENT') {
      return current.parent?.type === 'COMPONENT_SET' ? current.parent : current
    }
    current = current.parent
  }
  return null
}

function componentPropertyKeys(
  owner: ComponentPropertyOwner,
  state: ApplyState
): Record<string, string> {
  const cached = state.componentPropertyKeys.get(owner.id)
  if (cached) return cached
  const raw = owner.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_COMPONENT_PROPERTY_KEYS_NAME)
  let keys: Record<string, string> = Object.create(null) as Record<string, string>
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== 'string')
      ) {
        throw new Error()
      }
      keys = { ...(parsed as Record<string, string>) }
    } catch {
      scopeError(`Component property identity data on "${owner.id}" is invalid.`)
    }
  }
  state.componentPropertyKeys.set(owner.id, keys)
  return keys
}

function setComponentPropertyKey(
  owner: ComponentPropertyOwner,
  key: string,
  propertyName: string,
  state: ApplyState
): void {
  const keys = componentPropertyKeys(owner, state)
  if (keys[key] === propertyName) return
  keys[key] = propertyName
  owner.setSharedPluginData(
    CANVAS_KEY_NAMESPACE,
    CANVAS_COMPONENT_PROPERTY_KEYS_NAME,
    JSON.stringify(keys)
  )
  markMutation(state, owner)
}

function componentPropertyName(
  owner: ComponentPropertyOwner,
  key: string,
  state: ApplyState
): string | undefined {
  const mapped = componentPropertyKeys(owner, state)[key]
  if (mapped) return mapped
  return owner.componentPropertyDefinitions[key] ? key : undefined
}

function findExistingNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  forcedNode?: SupportedCanvasNode
): SupportedCanvasNode | null {
  if (forcedNode) return forcedNode
  if (spec.nodeId) {
    const node = figma.getNodeById(spec.nodeId)
    return isSupportedSceneNode(node) ? node : null
  }
  return state.keyedNodes.get(spec.key) ?? null
}

function resolveExistingNode(
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
    specError(
      `Canvas key "${spec.key}" expects ${spec.type}, but node "${node.id}" is ${node.type}.`
    )
  }
  if (state.claimedNodeIds.has(node.id)) {
    specError(`Node "${node.id}" is referenced more than once in the desired result.`)
  }
  state.claimedNodeIds.add(node.id)
  return node
}

async function resolveComponent(reference: CanvasDesignReference, state: ApplyState) {
  const cacheKey = designReferenceCacheKey(reference)
  const cached = state.componentCache.get(cacheKey)
  if (cached) return cached

  let component: ComponentNode | null = null
  if (reference.id !== undefined) {
    const node = figma.getNodeById(reference.id)
    if (node?.type === 'COMPONENT') {
      component = node
    } else if (node?.type === 'COMPONENT_SET') {
      component = node.defaultVariant
    }
  } else {
    component = await figma.importComponentByKeyAsync(reference.key)
  }

  if (!component) {
    specError('The requested component could not be resolved.')
  }
  state.componentCache.set(cacheKey, component)
  return component
}

async function resolveShader(id: string, state: ApplyState): Promise<Shader> {
  const cached = state.shaderCache.get(id)
  if (cached) return cached
  let shader: Shader
  try {
    shader = await figma.importShaderById(id)
  } catch {
    specError(`Shader "${id}" could not be imported.`)
  }
  state.shaderCache.set(id, shader)
  return shader
}

const STYLE_TYPES = {
  fill: 'PAINT',
  stroke: 'PAINT',
  text: 'TEXT',
  effect: 'EFFECT',
  grid: 'GRID'
} satisfies Record<keyof CanvasStyleBindings, StyleType>

function validateStyleType(field: keyof CanvasStyleBindings, style: BaseStyle, key: string): void {
  const expected = STYLE_TYPES[field]
  if (style.type !== expected) {
    specError(
      `Style "${style.id}" for ${field} on "${key}" is ${style.type}, expected ${expected}.`
    )
  }
}

function loadFont(font: FontName, state: ApplyState): Promise<void> {
  const key = `${font.family}\0${font.style}`
  const pending = state.fontLoads.get(key)
  if (pending) return pending
  const load = figma
    .loadFontAsync(font)
    .catch(() =>
      specError(`Font "${font.family} ${font.style}" is unavailable in the current Figma context.`)
    )
  state.fontLoads.set(key, load)
  return load
}

async function loadFonts(fonts: Iterable<FontName>, state: ApplyState): Promise<void> {
  const unique = new Map([...fonts].map((font) => [`${font.family}\0${font.style}`, font] as const))
  await Promise.all([...unique.values()].map((font) => loadFont(font, state)))
}

function currentTextFonts(node: TextNode, range?: { start: number; end: number }): FontName[] {
  if (range) return node.getRangeAllFontNames(range.start, range.end)
  return node.fontName === figma.mixed
    ? node.getRangeAllFontNames(0, node.characters.length)
    : [node.fontName]
}

function expectedVariableType(field: keyof CanvasVariableBindings): VariableResolvedDataType {
  if (field === 'fill' || field === 'stroke') return 'COLOR'
  if (field === 'characters' || field === 'fontFamily' || field === 'fontStyle') return 'STRING'
  if (field === 'visible') return 'BOOLEAN'
  return 'FLOAT'
}

function validateVariableType(
  field: keyof CanvasVariableBindings,
  variable: Variable,
  key: string
): void {
  const expected = expectedVariableType(field)
  if (variable.resolvedType !== expected) {
    specError(
      `Variable "${variable.id}" for ${field} on "${key}" is ${variable.resolvedType}, expected ${expected}.`
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isComponentPropertyVariable(
  value: unknown
): value is { variable: CanvasVariableReference } {
  return isRecord(value) && 'variable' in value
}

function isShaderVariable(
  value: CanvasFigmaShaderPropertyValue
): value is { variable: CanvasVariableReference } {
  return isRecord(value) && 'variable' in value
}

function collectShaderVariableReferences(
  value: CanvasFigmaShaderPropertyValue,
  references: CanvasVariableReference[]
): void {
  if (!isRecord(value)) return
  if (isShaderVariable(value)) {
    references.push(value.variable)
    return
  }
  if ('color' in value) {
    collectShaderVariableReferences(value.color as CanvasFigmaShaderPropertyValue, references)
  } else if ('stops' in value) {
    for (const stop of value.stops as Array<{ color: CanvasFigmaShaderPropertyValue }>) {
      collectShaderVariableReferences(stop.color, references)
    }
  }
}

function shaderPropertyMatches(
  type: ShaderPropertyDefinition['type'],
  value: CanvasFigmaShaderPropertyValue
): boolean {
  if (isShaderVariable(value)) return true
  switch (type) {
    case 'BOOLEAN':
      return typeof value === 'boolean'
    case 'TEXT':
    case 'IMAGE':
    case 'INSTANCE_SWAP':
    case 'SLOT':
      return typeof value === 'string'
    case 'NUMBER':
      return typeof value === 'number'
    case 'COLOR':
      return isRecord(value) && 'r' in value
    case 'POINT':
      return isRecord(value) && 'x' in value && Object.keys(value).length === 2
    case 'LINE':
      return isRecord(value) && 'x2' in value
    case 'CIRCLE':
      return isRecord(value) && 'radius' in value && !('angle' in value)
    case 'CIRCLE_POINT':
      return isRecord(value) && 'angle' in value
    case 'COLOR_POINT':
      return isRecord(value) && 'color' in value
    case 'GRADIENT':
      return isRecord(value) && 'stops' in value
  }
}

async function preflightEffects(
  effects: CanvasFigmaEffect[] | undefined,
  key: string,
  state: ApplyState
): Promise<void> {
  for (const [index, effect] of (effects ?? []).entries()) {
    if ('variables' in effect && effect.variables) {
      for (const [field, reference] of Object.entries(effect.variables)) {
        const variable = await resolveVariable(reference, state.variables)
        const expected = field === 'color' ? 'COLOR' : 'FLOAT'
        if (variable.resolvedType !== expected) {
          specError(
            `Variable "${variable.id}" for effect ${index} ${field} on "${key}" is ${variable.resolvedType}, expected ${expected}.`
          )
        }
      }
    }
    if (effect.type !== 'SHADER') continue
    await preflightShader(effect.id, effect.properties, 'effect', key, state)
  }
}

async function preflightShader(
  id: string,
  properties: Record<string, CanvasFigmaShaderPropertyValue> | undefined,
  type: Shader['type'],
  key: string,
  state: ApplyState
): Promise<void> {
  const shader = await resolveShader(id, state)
  if (shader.type !== type) {
    specError(`Shader "${id}" on "${key}" is a ${shader.type} shader, not a ${type} shader.`)
  }
  const definitions = shader.propertyDefinitions ?? {}
  for (const [propertyId, value] of Object.entries(properties ?? {})) {
    const definition = definitions[propertyId]
    if (!definition) {
      specError(`Shader "${id}" has no property "${propertyId}" on "${key}".`)
    }
    if (!shaderPropertyMatches(definition.type, value)) {
      specError(`Shader property "${propertyId}" on "${key}" expects ${definition.type}.`)
    }
    const references: CanvasVariableReference[] = []
    collectShaderVariableReferences(value, references)
    await Promise.all(references.map((reference) => resolveVariable(reference, state.variables)))
  }
}

async function preflightPaintVariable(
  reference: CanvasVariableReference,
  field: string,
  index: number,
  key: string,
  state: ApplyState
): Promise<void> {
  const variable = await resolveVariable(reference, state.variables)
  if (variable.resolvedType !== 'COLOR') {
    specError(
      `Variable "${variable.id}" for ${field} paint ${index} on "${key}" is ${variable.resolvedType}, expected COLOR.`
    )
  }
}

function hasCanvasKeyPattern(paints: CanvasFigmaPaint[] | undefined): boolean {
  return (
    paints?.some((paint) => paint.type === 'PATTERN' && paint.sourceCanvasKey !== undefined) ??
    false
  )
}

function hasCanvasKeyPaints(spec: CanvasNodeSpec): boolean {
  return hasCanvasKeyPattern(spec.figma?.fills) || hasCanvasKeyPattern(spec.figma?.strokes)
}

function hasCanvasKeyVectorPattern(spec: CanvasNodeSpec): boolean {
  return (
    spec.figma?.shape?.type === 'VECTOR' &&
    (spec.figma.shape.network?.regions?.some((region) => hasCanvasKeyPattern(region.fills)) ??
      false)
  )
}

function isCanvasKeyHyperlink(
  hyperlink: CanvasHyperlink | undefined
): hyperlink is { type: 'NODE'; value: { canvasKey: string } } {
  return hyperlink?.type === 'NODE' && typeof hyperlink.value !== 'string'
}

function hasDeferredTextRanges(spec: CanvasNodeSpec): boolean {
  const ranges = spec.figma?.text?.ranges
  return (
    ranges !== undefined &&
    (hasCanvasKeyPaints(spec) ||
      ranges.some(
        (range) => hasCanvasKeyPattern(range.fills) || isCanvasKeyHyperlink(range.hyperlink)
      ))
  )
}

async function preflightPaintStack(
  paints: CanvasFigmaPaint[] | undefined,
  field: string,
  key: string,
  state: ApplyState
): Promise<void> {
  for (const [index, paint] of (paints ?? []).entries()) {
    if (paint.type === 'SOLID' && paint.variables) {
      await preflightPaintVariable(paint.variables.color, field, index, key, state)
    } else if ('gradientStops' in paint) {
      for (const stop of paint.gradientStops) {
        if (stop.variables) {
          await preflightPaintVariable(stop.variables.color, field, index, key, state)
        }
      }
    }
    if (paint.type === 'IMAGE') {
      if (paint.imageUrl !== undefined) {
        state.imageUrls.add(paint.imageUrl)
      } else if (paint.assetKey !== undefined) {
        state.imageAssetKeys.add(paint.assetKey)
      } else if (paint.imageHash && !figma.getImageByHash(paint.imageHash)) {
        specError(
          `Image "${paint.imageHash}" for ${field} paint ${index} on "${key}" does not exist.`
        )
      }
    }
    if (paint.type === 'VIDEO' && paint.videoUrl !== undefined) {
      state.videoUrls.add(paint.videoUrl)
    }
    if (paint.type === 'PATTERN') {
      await preflightNodeReference(
        paint.sourceCanvasKey
          ? { canvasKey: paint.sourceCanvasKey }
          : { nodeId: paint.sourceNodeId! },
        `Pattern source for ${field} paint ${index} on "${key}"`,
        state,
        true
      )
    }
    if (paint.type === 'SHADER') {
      await preflightShader(paint.id, paint.properties, 'fill', key, state)
    }
  }
}

async function preflightPaints(spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  await preflightPaintStack(spec.figma?.fills, 'fill', spec.key, state)
  await preflightPaintStack(spec.figma?.strokes, 'stroke', spec.key, state)
}

async function preflightVector(spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  const shape = spec.figma?.shape
  if (shape?.type !== 'VECTOR') return
  if (shape.paths) {
    try {
      canonicalVectorPaths(shape.paths)
    } catch (error) {
      specError(
        `Vector path on "${spec.key}" is invalid: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  for (const [index, region] of (shape.network?.regions ?? []).entries()) {
    await preflightPaintStack(region.fills, `vector region ${index} fill`, spec.key, state)
    if (!region.fillStyle) continue
    const style = await resolveStyle(region.fillStyle, state.styles)
    validateStyleType('fill', style, spec.key)
  }
}

async function preflightTextRanges(spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  for (const [index, range] of (spec.figma?.text?.ranges ?? []).entries()) {
    const key = `${spec.key} text range ${index}`
    if (range.fontName) await loadFont(range.fontName, state)
    for (const [field, reference] of [
      ['text', range.textStyle],
      ['fill', range.fillStyle]
    ] as const) {
      if (!reference) continue
      const style = await resolveStyle(reference, state.styles)
      validateStyleType(field, style, key)
      if (style.type === 'TEXT') await loadFont(style.fontName, state)
    }
    for (const [field, reference] of Object.entries(range.variables ?? {}) as Array<
      [keyof CanvasVariableBindings, CanvasVariableReference | null]
    >) {
      if (!reference) continue
      validateVariableType(field, await resolveVariable(reference, state.variables), key)
    }
    if (range.hyperlink?.type === 'NODE') {
      await preflightNodeReference(
        typeof range.hyperlink.value === 'string'
          ? { nodeId: range.hyperlink.value }
          : { canvasKey: range.hyperlink.value.canvasKey },
        `Hyperlink target on "${key}"`,
        state
      )
    }
    await preflightPaintStack(range.fills, `text range ${index} fill`, spec.key, state)
    const decorationColor = range.textDecorationColor
    if (decorationColor && decorationColor.value !== 'AUTO') {
      await preflightPaintStack(
        [decorationColor.value],
        `text range ${index} decoration`,
        spec.key,
        state
      )
    }
  }
}

async function preflightLayoutGrids(
  grids: CanvasFigmaLayoutGrid[] | undefined,
  key: string,
  state: ApplyState
): Promise<void> {
  for (const [index, grid] of (grids ?? []).entries()) {
    for (const [field, reference] of Object.entries(grid.variables ?? {})) {
      const variable = await resolveVariable(reference, state.variables)
      if (variable.resolvedType !== 'FLOAT') {
        specError(
          `Variable "${variable.id}" for layout grid ${index} ${field} on "${key}" is ${variable.resolvedType}, expected FLOAT.`
        )
      }
    }
  }
}

const TEXT_STYLE_VALUE_FIELDS = [
  'fontName',
  'fontSize',
  'textDecoration',
  'letterSpacing',
  'lineHeight',
  'leadingTrim',
  'paragraphIndent',
  'paragraphSpacing',
  'listSpacing',
  'hangingPunctuation',
  'hangingList',
  'textCase'
] as const satisfies ReadonlyArray<keyof Extract<CanvasStyleResource, { type: 'TEXT' }>>

const TEXT_STYLE_VARIABLES_BY_VALUE = {
  fontName: ['fontFamily', 'fontStyle', 'fontWeight'],
  fontSize: ['fontSize'],
  textDecoration: [],
  letterSpacing: ['letterSpacing'],
  lineHeight: ['lineHeight'],
  leadingTrim: [],
  paragraphIndent: ['paragraphIndent'],
  paragraphSpacing: ['paragraphSpacing'],
  listSpacing: [],
  hangingPunctuation: [],
  hangingList: [],
  textCase: []
} satisfies Record<(typeof TEXT_STYLE_VALUE_FIELDS)[number], readonly VariableBindableTextField[]>

type TextStyleResource = Extract<CanvasStyleResource, { type: 'TEXT' }>

function textStyleVariableEntries(
  spec: TextStyleResource
): Array<[VariableBindableTextField, CanvasVariableReference | null]> {
  return Object.entries(spec.variables ?? {}) as Array<
    [VariableBindableTextField, CanvasVariableReference | null]
  >
}

async function preflightStyleResources(state: ApplyState): Promise<void> {
  for (const { key, spec } of state.styles.resources) {
    switch (spec.type) {
      case 'PAINT':
        for (const paint of spec.paints ?? []) {
          if (
            paint.type === 'PATTERN' &&
            paint.sourceCanvasKey !== undefined &&
            !state.keyedNodes.has(paint.sourceCanvasKey)
          ) {
            specError(
              `Pattern source "${paint.sourceCanvasKey}" on Paint style "${key}" must already exist in the update scope; use sourceNodeId when creating the source separately.`
            )
          }
        }
        await preflightPaintStack(spec.paints, 'style', key, state)
        break
      case 'TEXT':
        if (spec.fontName) await loadFont(spec.fontName, state)
        for (const [field, reference] of textStyleVariableEntries(spec)) {
          if (!reference) continue
          validateVariableType(
            field as keyof CanvasVariableBindings,
            await resolveVariable(reference, state.variables),
            key
          )
        }
        break
      case 'EFFECT':
        await preflightEffects(spec.effects, key, state)
        break
      case 'GRID':
        await preflightLayoutGrids(spec.layoutGrids, key, state)
        break
    }
  }
}

function componentPropertyDisplayName(propertyName: string): string {
  const suffix = propertyName.lastIndexOf('#')
  return suffix < 0 ? propertyName : propertyName.slice(0, suffix)
}

function nextComponentPropertyContext(
  spec: CanvasNodeSpec,
  existing: SupportedCanvasNode | undefined,
  inherited: ComponentPropertyContext | undefined
): ComponentPropertyContext | undefined {
  if (spec.type === 'COMPONENT_SET') {
    return {
      spec,
      ...(existing?.type === 'COMPONENT_SET' ? { existing } : {})
    }
  }
  if (spec.type === 'COMPONENT') {
    if (inherited?.spec?.type === 'COMPONENT_SET') return inherited
    if (existing?.type === 'COMPONENT' && existing.parent?.type === 'COMPONENT_SET') {
      return { existing: existing.parent }
    }
    return {
      spec,
      ...(existing?.type === 'COMPONENT' ? { existing } : {})
    }
  }
  if (inherited) return inherited
  const owner = existing ? componentPropertyOwner(existing) : null
  return owner ? { existing: owner } : undefined
}

function contextPropertyType(
  context: ComponentPropertyContext,
  key: string,
  state: ApplyState
): ComponentPropertyType | undefined {
  const desired = context.spec?.figma?.component?.properties?.[key]
  if (desired !== undefined) return desired?.type
  const owner = context.existing
  if (!owner) return undefined
  const name = componentPropertyName(owner, key, state)
  return name ? owner.componentPropertyDefinitions[name]?.type : undefined
}

function expectedComponentPropertyVariableType(
  type: CanvasFigmaComponentPropertyDefinition['type']
): VariableResolvedDataType {
  return type === 'BOOLEAN' ? 'BOOLEAN' : 'STRING'
}

async function preflightComponentPropertyDefinition(
  key: string,
  definition: CanvasFigmaComponentPropertyDefinition,
  state: ApplyState
): Promise<void> {
  if (isComponentPropertyVariable(definition.defaultValue)) {
    const variable = await resolveVariable(definition.defaultValue.variable, state.variables)
    const expected = expectedComponentPropertyVariableType(definition.type)
    if (variable.resolvedType !== expected) {
      specError(
        `Variable "${variable.id}" for component property "${key}" is ${variable.resolvedType}, expected ${expected}.`
      )
    }
  } else if (definition.type === 'INSTANCE_SWAP') {
    await resolveComponent(definition.defaultValue, state)
  }
}

async function preflightAuthoredComponentProperties(
  spec: CanvasNodeSpec,
  context: ComponentPropertyContext | undefined,
  state: ApplyState
): Promise<void> {
  const properties = spec.figma?.component?.properties
  if (!properties) return
  if (!context || context.spec !== spec) {
    specError(
      `Component property definitions on variant "${spec.key}" belong on its component set.`
    )
  }
  const owner = context.existing
  const keys = owner ? componentPropertyKeys(owner, state) : undefined
  for (const [key, desired] of Object.entries(properties)) {
    const propertyName = owner ? (keys?.[key] ?? key) : undefined
    const current = propertyName ? owner?.componentPropertyDefinitions[propertyName] : undefined
    if (desired === null) {
      if (!owner || (!keys?.[key] && !current)) {
        specError(`Component property "${key}" on "${spec.key}" does not exist.`)
      }
      if (current?.type === 'VARIANT' || current?.type === 'SLOT') {
        specError(
          `${current.type} property "${key}" on "${spec.key}" cannot be deleted through component properties.`
        )
      }
      continue
    }
    if (current && current.type !== desired.type) {
      specError(
        `Component property "${key}" on "${spec.key}" is ${current.type}, expected ${desired.type}.`
      )
    }
    await preflightComponentPropertyDefinition(key, desired, state)
  }
}

function expectedComponentPropertyReferenceType(
  field: ComponentPropertyReferenceField
): ComponentPropertyType {
  if (field === 'characters') return 'TEXT'
  if (field === 'mainComponent') return 'INSTANCE_SWAP'
  return 'BOOLEAN'
}

function preflightComponentPropertyReferences(
  spec: CanvasNodeSpec,
  existing: SupportedCanvasNode | undefined,
  context: ComponentPropertyContext | undefined,
  state: ApplyState
): void {
  const references = spec.figma?.componentPropertyReferences
  if (references) {
    if (!context) {
      specError(`Component property references on "${spec.key}" require a component sublayer.`)
    }
    for (const [field, key] of Object.entries(references) as Array<
      [ComponentPropertyReferenceField, string | null]
    >) {
      if (key === null) continue
      const actual = contextPropertyType(context, key, state)
      const expected = expectedComponentPropertyReferenceType(field)
      if (actual !== expected) {
        specError(
          `Component property reference "${key}" for ${field} on "${spec.key}" is ${actual ?? 'missing'}, expected ${expected}.`
        )
      }
    }
  }
  const effective = (field: ComponentPropertyReferenceField) =>
    references?.[field] === undefined
      ? existing?.componentPropertyReferences?.[field]
      : references[field]
  if (effective('characters') && (spec.variables?.characters || spec.figma?.text?.ranges)) {
    specError(
      `A characters property reference on "${spec.key}" cannot be combined with a characters variable or rich-text ranges.`
    )
  }
  if (effective('visible') && spec.variables?.visible) {
    specError(
      `A visible property reference on "${spec.key}" cannot be combined with a visibility variable.`
    )
  }
  if (effective('mainComponent') && spec.figma?.instance?.preserveOverrides !== undefined) {
    specError(
      `Instance override preservation on "${spec.key}" cannot be combined with a mainComponent property reference.`
    )
  }
}

function slotPropertyName(
  owner: ComponentPropertyOwner,
  spec: CanvasNodeSpec,
  state: ApplyState
): string | undefined {
  const direct = componentPropertyName(owner, spec.key, state)
  if (direct && owner.componentPropertyDefinitions[direct]?.type === 'SLOT') return direct
  const desiredName = spec.figma?.slot?.property?.name
  if (!desiredName) return undefined
  const matches = Object.entries(owner.componentPropertyDefinitions)
    .filter(
      ([name, definition]) =>
        definition.type === 'SLOT' && componentPropertyDisplayName(name) === desiredName
    )
    .map(([name]) => name)
  if (matches.length > 1) {
    specError(`Slot property "${desiredName}" on "${spec.key}" is ambiguous.`)
  }
  return matches[0]
}

function preflightSlot(
  spec: CanvasNodeSpec,
  existing: SupportedCanvasNode | undefined,
  context: ComponentPropertyContext | undefined,
  state: ApplyState
): void {
  if (spec.type !== 'SLOT') return
  if (!existing) {
    if (!spec.figma?.slot?.property) {
      specError(`New slot "${spec.key}" requires property metadata.`)
    }
    if (!context) {
      specError(`New slot "${spec.key}" must be nested inside an authored component.`)
    }
    return
  }
  if (existing.type !== 'SLOT' || !spec.figma?.slot?.property) return
  const owner = componentPropertyOwner(existing)
  const propertyName = owner ? slotPropertyName(owner, spec, state) : undefined
  if (!owner || !propertyName) {
    specError(`Slot property for "${spec.key}" could not be resolved.`)
  }
  const current = owner.componentPropertyDefinitions[propertyName]
  const settings = spec.figma.slot.property.settings
  if (settings) {
    const merged = { ...current?.slotSettings, ...settings }
    if (
      merged.minChildren != null &&
      merged.maxChildren != null &&
      merged.minChildren > merged.maxChildren
    ) {
      specError(`Slot minChildren on "${spec.key}" cannot exceed maxChildren.`)
    }
  }
}

async function preflightComponentProperties(
  spec: CanvasNodeSpec,
  component: ComponentNode,
  state: ApplyState
): Promise<void> {
  const definitions =
    component.parent?.type === 'COMPONENT_SET'
      ? component.parent.componentPropertyDefinitions
      : component.componentPropertyDefinitions
  for (const [name, value] of Object.entries(spec.componentProperties ?? {})) {
    const definition = definitions[name]
    if (!definition) {
      specError(`Component "${component.id}" has no property "${name}" for "${spec.key}".`)
    }
    if (definition.type === 'SLOT') {
      specError(`Slot property "${name}" on "${spec.key}" cannot be set with componentProperties.`)
    }
    if (isComponentPropertyVariable(value)) {
      await resolveVariable(value.variable, state.variables)
      continue
    }
    const expected = definition.type === 'BOOLEAN' ? 'boolean' : 'string'
    if (typeof value !== expected) {
      specError(`Component property "${name}" on "${spec.key}" expects ${expected}.`)
    }
    if (
      definition.type === 'VARIANT' &&
      definition.variantOptions &&
      !definition.variantOptions.includes(value as string)
    ) {
      specError(`Component property "${name}" on "${spec.key}" has no variant "${value}".`)
    }
    if (definition.type !== 'INSTANCE_SWAP') continue
    const replacement = await figma.getNodeByIdAsync(value as string)
    if (replacement?.type !== 'COMPONENT' && replacement?.type !== 'COMPONENT_SET') {
      specError(
        `Instance-swap property "${name}" on "${spec.key}" must reference a component node.`
      )
    }
  }
}

function isPrimaryNestedInstance(node: InstanceNode): boolean {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'INSTANCE') return false
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return true
    parent = parent.parent
  }
  return false
}

async function preflightVariableModes(
  modes: CanvasNodeSpec['variableModes'],
  state: ApplyState
): Promise<void> {
  for (const [collectionId, modeId] of Object.entries(modes ?? {})) {
    const collection = await resolveCollection(collectionId, state.variables)
    if (modeId !== null) await resolveModeId(collection, modeId, state.variables)
  }
}

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

function preflightMasks(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing: SupportedCanvasNode | null = null,
  isRoot = true
): void {
  if (isRoot && spec.figma?.mask != null) {
    specError('The canvas root cannot be a mask because its scope would escape the desired tree.')
  }

  const children = spec.children ?? []
  const hasMask = children.some((child) => child.figma?.mask != null)
  const lastChild = children.at(-1)
  if (lastChild?.figma?.mask != null) {
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

function preflightContainers(
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

async function preflightResources(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing?: SupportedCanvasNode,
  inheritedComponent?: ComponentPropertyContext
): Promise<void> {
  const component = nextComponentPropertyContext(spec, existing, inheritedComponent)
  if (component?.existing?.remote) {
    specError(`Remote ${component.existing.type} containing "${spec.key}" is read-only.`)
  }
  await preflightAuthoredComponentProperties(spec, component, state)
  preflightComponentPropertyReferences(spec, existing, component, state)
  preflightSlot(spec, existing, component, state)
  if (spec.component) {
    const instanceComponent = await resolveComponent(spec.component, state)
    await preflightComponentProperties(spec, instanceComponent, state)
  }
  if (spec.figma?.instance?.exposed !== undefined) {
    const instance = existing ?? findExistingNode(spec, state)
    if (instance?.type !== 'INSTANCE' || !isPrimaryNestedInstance(instance)) {
      specError(
        `Instance exposure on "${spec.key}" requires an existing primary instance inside a component.`
      )
    }
  }
  if (spec.variables) {
    for (const field of Object.keys(spec.variables) as Array<keyof CanvasVariableBindings>) {
      const reference = spec.variables[field]
      if (!reference) continue
      const variable = await resolveVariable(reference, state.variables)
      validateVariableType(field, variable, spec.key)
    }
  }
  await preflightVariableModes(spec.variableModes, state)
  if (spec.styles) {
    for (const field of Object.keys(spec.styles) as Array<keyof CanvasStyleBindings>) {
      const reference = spec.styles[field]
      if (!reference) continue
      const style = await resolveStyle(reference, state.styles)
      validateStyleType(field, style, spec.key)
      if (style.type === 'TEXT') await loadFont(style.fontName, state)
    }
  }
  const hyperlink = spec.figma?.text?.hyperlink
  if (hyperlink?.type === 'NODE') {
    await preflightNodeReference(
      typeof hyperlink.value === 'string'
        ? { nodeId: hyperlink.value }
        : { canvasKey: hyperlink.value.canvasKey },
      `Hyperlink target on "${spec.key}"`,
      state
    )
  }
  await preflightPaints(spec, state)
  await preflightVector(spec, state)
  await preflightTextRanges(spec, state)
  await preflightEffects(spec.figma?.effects, spec.key, state)
  await preflightLayoutGrids(spec.figma?.layoutGrids, spec.key, state)
  for (const child of spec.children ?? []) {
    await preflightResources(child, state, findExistingNode(child, state) ?? undefined, component)
  }
}

async function resolveImageUrls(state: ApplyState): Promise<void> {
  for (const url of state.imageUrls) {
    try {
      state.imageHashes.set(url, (await figma.createImageAsync(url)).hash)
    } catch {
      specError('An image URL could not be loaded as a PNG, JPEG, or GIF up to 4096 by 4096 px.')
    }
  }
}

function resolveImageAssets(state: ApplyState): void {
  for (const key of state.imageAssetKeys) {
    const asset = resolvedImageAsset(state.assets, key)
    if (!asset) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
        `Image asset "${key}" was not resolved.`
      )
    }
    try {
      const cachedHash = importedImageHashes.get(asset.hash)
      if (cachedHash) importedImageHashes.delete(asset.hash)
      const imageHash =
        cachedHash && figma.getImageByHash(cachedHash)
          ? cachedHash
          : figma.createImage(asset.bytes).hash
      importedImageHashes.set(asset.hash, imageHash)
      while (importedImageHashes.size > MAX_IMPORTED_IMAGE_HASHES) {
        importedImageHashes.delete(importedImageHashes.keys().next().value!)
      }
      state.imageHashes.set(`asset:${key}`, imageHash)
    } catch {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.IMAGE_IMPORT_FAILED,
        `Image asset "${key}" could not be imported as a PNG, JPEG, or GIF up to 4096 by 4096 px.`
      )
    }
  }
}

async function readVideoBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return readBoundedResponseBytes(
    response,
    MAX_VIDEO_BYTES,
    () => new Error('Video exceeds 100MB.')
  )
}

async function resolveVideoUrls(state: ApplyState): Promise<void> {
  for (const url of state.videoUrls) {
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        signal: AbortSignal.timeout(60_000)
      })
      const video = await figma.createVideoAsync(await readVideoBytes(response))
      state.videoHashes.set(url, video.hash)
    } catch {
      specError(
        'A video URL could not be imported as an MP4, MOV, or WebM up to 100MB. Figma video uploads require a paid team file.'
      )
    }
  }
}

function recordCreatedNode(node: SupportedCanvasNode, state: ApplyState, claimed = true): void {
  state.mutations.count += 1
  state.createdNodeIds.add(node.id)
  if (claimed) state.claimedNodeIds.add(node.id)
}

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
  const owner: ComponentPropertyOwner =
    component.parent?.type === 'COMPONENT_SET' ? component.parent : component
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
  return node
}

function moveIntoParent(
  node: SupportedCanvasNode,
  parent: CanvasParentNode,
  index: number,
  state: ApplyState
): void {
  if (node.parent?.id === parent.id && parent.children.indexOf(node) === index) return
  parent.insertChild(index, node)
  markMutation(state, node)
}

function setValue<T>(
  node: BaseNode,
  current: unknown,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || Object.is(current, desired)) return
  apply(desired)
  markMutation(state, node)
}

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
      node.counterAxisSpacing,
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

function applyLayout(
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

const SIZE_BOUND_FIELDS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const

function applySizingModes(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  if (isIntrinsicNode(node) || !('layoutSizingHorizontal' in node)) return
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
  if (node.layoutMode === 'HORIZONTAL') {
    setValue(
      node,
      node.primaryAxisSizingMode,
      horizontalMode,
      (value) => (node.primaryAxisSizingMode = value),
      state
    )
    setValue(
      node,
      node.counterAxisSizingMode,
      verticalMode,
      (value) => (node.counterAxisSizingMode = value),
      state
    )
  } else {
    setValue(
      node,
      node.primaryAxisSizingMode,
      verticalMode,
      (value) => (node.primaryAxisSizingMode = value),
      state
    )
    setValue(
      node,
      node.counterAxisSizingMode,
      horizontalMode,
      (value) => (node.counterAxisSizingMode = value),
      state
    )
  }
}

type CrossAxisFill = {
  axis: 'horizontal' | 'vertical'
  size: number
}

function clampSize(value: number, min: number | null, max: number | null): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 0, value))
}

function expectedCrossAxisFill(
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
      size: clampSize(
        Math.max(0, parent.width - parent.paddingLeft - parent.paddingRight),
        node.minWidth,
        node.maxWidth
      )
    }
  }
  if (parent.layoutMode === 'HORIZONTAL' && spec.size.vertical === 'FILL') {
    return {
      axis: 'vertical',
      size: clampSize(
        Math.max(0, parent.height - parent.paddingTop - parent.paddingBottom),
        node.minHeight,
        node.maxHeight
      )
    }
  }
  return null
}

function stabilizeCrossAxisFill(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  parent: CanvasParentNode | undefined,
  state: ApplyState
): void {
  if (!('layoutSizingHorizontal' in node)) return
  const expected = expectedCrossAxisFill(node, spec, parent)
  if (!expected) return
  const current = expected.axis === 'horizontal' ? node.width : node.height
  if (Math.abs(current - expected.size) <= GEOMETRY_TOLERANCE) return

  if (expected.axis === 'horizontal') {
    node.layoutSizingHorizontal = 'FIXED'
    node.resize(expected.size, node.height)
    node.layoutSizingHorizontal = 'FILL'
  } else {
    node.layoutSizingVertical = 'FIXED'
    node.resize(node.width, expected.size)
    node.layoutSizingVertical = 'FILL'
  }
  markMutation(state, node)
}

function applySize(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
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
  applySizingModes(node, spec, state)
}

function applyPosition(
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
  setValue(node, node.x, spec.position.x, (value) => (node.x = value), state)
  setValue(node, node.y, spec.position.y, (value) => (node.y = value), state)
}

function transformsMatch(current: Transform, desired: Transform): boolean {
  return current.every((row, rowIndex) =>
    row.every((value, columnIndex) => Math.abs(value - desired[rowIndex]![columnIndex]!) <= 1e-6)
  )
}

function applyRelativeTransform(
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

function applyPaint(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  field: 'fill' | 'stroke',
  state: ApplyState
): void {
  if (!('fills' in node)) {
    specError(`${field} paints are not supported on ${node.type} node "${spec.key}".`)
  }
  const color = spec.appearance?.[field]
  if (color === undefined) return

  const property = field === 'fill' ? 'fills' : 'strokes'
  const styleProperty = field === 'fill' ? 'fillStyleId' : 'strokeStyleId'
  if (spec.styles?.[field] || (node[styleProperty] && !spec.variables?.[field])) return
  const paints = node[property]
  const desired = color === null ? [] : [figma.util.solidPaint(color)]
  const binding = spec.variables?.[field]
  const currentVariable = node.boundVariables?.[property]?.[0]
  if (!binding && currentVariable) return
  if (binding) {
    if (color === null) {
      const label = field === 'fill' ? 'Fill' : 'Stroke'
      specError(`${label} variable binding on "${spec.key}" requires a solid fallback paint.`)
    }
    const variable = state.variables.variableCache.get(variableReferenceCacheKey(binding))
    if (variable && currentVariable?.id === variable.id) return
  }
  if (paints !== figma.mixed && paintStacksEqual(paints, desired)) {
    return
  }

  node[property] = desired
  markMutation(state, node)
}

const STROKE_WEIGHT_FIELDS = [
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight'
] as const satisfies ReadonlyArray<VariableBindableNodeField>
const CORNER_RADIUS_FIELDS = [
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius'
] as const satisfies ReadonlyArray<VariableBindableNodeField>

function hasDesiredVariable(
  spec: CanvasNodeSpec,
  fields: ReadonlyArray<keyof CanvasVariableBindings>
): boolean {
  return fields.some((field) => spec.variables?.[field] !== undefined)
}

function hasCurrentVariable(
  node: SupportedCanvasNode,
  fields: ReadonlyArray<VariableBindableNodeField>
): boolean {
  return fields.some((field) => currentBoundVariableId(node, field) !== undefined)
}

function applyIndividualValue(
  node: SupportedCanvasNode,
  current: number,
  desired: number | undefined,
  field: VariableBindableNodeField,
  uniformField: VariableBindableNodeField,
  spec: CanvasNodeSpec,
  apply: (value: number) => void,
  state: ApplyState
): void {
  if (spec.variables?.[uniformField as keyof CanvasVariableBindings]) return
  if (currentBoundVariableId(node, uniformField)) return
  if (spec.variables?.[field as keyof CanvasVariableBindings]) return
  if (currentBoundVariableId(node, field)) return
  setValue(node, current, desired, apply, state)
}

function numbersEqual(current: readonly number[], desired: readonly number[]): boolean {
  return (
    current.length === desired.length && current.every((value, index) => value === desired[index])
  )
}

function applyAppearance(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const appearance = spec.appearance
  if (!appearance) return

  if ('fills' in node) {
    applyPaint(node, spec, 'fill', state)
    applyPaint(node, spec, 'stroke', state)
  }
  if ('strokeWeight' in node && (!node.strokeStyleId || spec.styles?.stroke)) {
    setValue(
      node,
      node.strokeWeight,
      appearance.strokeTopWeight !== undefined ||
        spec.variables?.strokeWeight ||
        hasDesiredVariable(spec, STROKE_WEIGHT_FIELDS) ||
        currentBoundVariableId(node, 'strokeWeight') ||
        hasCurrentVariable(node, STROKE_WEIGHT_FIELDS)
        ? undefined
        : appearance.strokeWeight,
      (value) => (node.strokeWeight = value),
      state
    )
    if ('strokeTopWeight' in node) {
      applyIndividualValue(
        node,
        node.strokeTopWeight,
        appearance.strokeTopWeight,
        'strokeTopWeight',
        'strokeWeight',
        spec,
        (value) => (node.strokeTopWeight = value),
        state
      )
      applyIndividualValue(
        node,
        node.strokeRightWeight,
        appearance.strokeRightWeight,
        'strokeRightWeight',
        'strokeWeight',
        spec,
        (value) => (node.strokeRightWeight = value),
        state
      )
      applyIndividualValue(
        node,
        node.strokeBottomWeight,
        appearance.strokeBottomWeight,
        'strokeBottomWeight',
        'strokeWeight',
        spec,
        (value) => (node.strokeBottomWeight = value),
        state
      )
      applyIndividualValue(
        node,
        node.strokeLeftWeight,
        appearance.strokeLeftWeight,
        'strokeLeftWeight',
        'strokeWeight',
        spec,
        (value) => (node.strokeLeftWeight = value),
        state
      )
    }
  }
  if ('cornerRadius' in node) {
    setValue(
      node,
      node.cornerRadius,
      appearance.topLeftRadius !== undefined ||
        spec.variables?.cornerRadius ||
        hasDesiredVariable(spec, CORNER_RADIUS_FIELDS) ||
        currentBoundVariableId(node, 'cornerRadius') ||
        hasCurrentVariable(node, CORNER_RADIUS_FIELDS)
        ? undefined
        : appearance.cornerRadius,
      (value) => (node.cornerRadius = value),
      state
    )
    if ('topLeftRadius' in node) {
      applyIndividualValue(
        node,
        node.topLeftRadius,
        appearance.topLeftRadius,
        'topLeftRadius',
        'cornerRadius',
        spec,
        (value) => (node.topLeftRadius = value),
        state
      )
      applyIndividualValue(
        node,
        node.topRightRadius,
        appearance.topRightRadius,
        'topRightRadius',
        'cornerRadius',
        spec,
        (value) => (node.topRightRadius = value),
        state
      )
      applyIndividualValue(
        node,
        node.bottomRightRadius,
        appearance.bottomRightRadius,
        'bottomRightRadius',
        'cornerRadius',
        spec,
        (value) => (node.bottomRightRadius = value),
        state
      )
      applyIndividualValue(
        node,
        node.bottomLeftRadius,
        appearance.bottomLeftRadius,
        'bottomLeftRadius',
        'cornerRadius',
        spec,
        (value) => (node.bottomLeftRadius = value),
        state
      )
    }
  }
  if ('clipsContent' in node) {
    setValue(
      node,
      node.clipsContent,
      appearance.clipsContent,
      (value) => (node.clipsContent = value),
      state
    )
  }
  if ('opacity' in node) {
    setValue(
      node,
      node.opacity,
      spec.variables?.opacity || currentBoundVariableId(node, 'opacity')
        ? undefined
        : appearance.opacity,
      (value) => (node.opacity = value),
      state
    )
  }

  const stroke = spec.figma?.stroke
  if (stroke) {
    if (!('strokeAlign' in node)) {
      specError(`Stroke geometry is not supported on ${node.type} node "${spec.key}".`)
    }
    setValue(node, node.strokeAlign, stroke.align, (value) => (node.strokeAlign = value), state)
    if ('strokeCap' in node) {
      setValue(node, node.strokeCap, stroke.cap, (value) => (node.strokeCap = value), state)
    }
    setValue(node, node.strokeJoin, stroke.join, (value) => (node.strokeJoin = value), state)
    if ('strokeMiterLimit' in node) {
      setValue(
        node,
        node.strokeMiterLimit,
        stroke.miterLimit,
        (value) => (node.strokeMiterLimit = value),
        state
      )
    }
    if (stroke.dashPattern !== undefined && !numbersEqual(node.dashPattern, stroke.dashPattern)) {
      node.dashPattern = stroke.dashPattern
      markMutation(state, node)
    }
  }
  if ('cornerSmoothing' in node) {
    setValue(
      node,
      node.cornerSmoothing,
      spec.figma?.corners?.smoothing,
      (value) => (node.cornerSmoothing = value),
      state
    )
  }
}

function resolvedComponent(reference: CanvasDesignReference, state: ApplyState): ComponentNode {
  const component = state.componentCache.get(designReferenceCacheKey(reference))
  if (!component) specError('A preflighted component could not be resolved.')
  return component
}

function nativeShaderValue(
  value: CanvasFigmaShaderPropertyValue,
  state: ApplyState
): ShaderPropertyValue {
  if (!isRecord(value)) return value
  if (isShaderVariable(value)) {
    return figma.variables.createVariableAlias(resolvedVariable(value.variable, state.variables))
  }
  if ('color' in value) {
    return {
      ...value,
      color: nativeShaderValue(value.color as CanvasFigmaShaderPropertyValue, state) as
        | RGB
        | RGBA
        | VariableAlias
    }
  }
  if ('stops' in value) {
    return {
      stops: (
        value.stops as Array<{
          position: number
          color: CanvasFigmaShaderPropertyValue
        }>
      ).map((stop) => ({
        position: stop.position,
        color: nativeShaderValue(stop.color, state) as RGB | RGBA | VariableAlias
      }))
    }
  }
  return value
}

function nativeShaderProperties(
  id: string,
  values: Record<string, CanvasFigmaShaderPropertyValue> | undefined,
  state: ApplyState
): Record<string, ShaderPropertyValue> | undefined {
  const shader = state.shaderCache.get(id)
  if (!shader) specError(`Shader "${id}" was not preflighted.`)
  const properties = Object.fromEntries(
    Object.entries(shader.propertyDefinitions ?? {})
      .filter(([, definition]) => definition.defaultValue !== undefined)
      .map(([propertyId, definition]) => [propertyId, definition.defaultValue!])
  ) as Record<string, ShaderPropertyValue>
  for (const [propertyId, value] of Object.entries(values ?? {})) {
    properties[propertyId] = nativeShaderValue(value, state)
  }
  return Object.keys(properties).length ? properties : undefined
}

function paintDefaults(paint: { visible?: boolean; opacity?: number; blendMode?: BlendMode }) {
  return {
    visible: paint.visible ?? true,
    opacity: paint.opacity ?? 1,
    blendMode: paint.blendMode ?? 'NORMAL'
  } as const
}

function nativePaint(paint: CanvasFigmaPaint, state: ApplyState): Paint {
  switch (paint.type) {
    case 'SOLID': {
      const { variables, ...fields } = paint
      const value: SolidPaint = {
        ...fields,
        ...paintDefaults(fields)
      }
      return variables
        ? figma.variables.setBoundVariableForPaint(
            value,
            'color',
            resolvedVariable(variables.color, state.variables)
          )
        : value
    }
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return {
        ...paint,
        gradientStops: paint.gradientStops.map(({ variables, ...stop }) => ({
          ...stop,
          ...(variables
            ? {
                boundVariables: {
                  color: figma.variables.createVariableAlias(
                    resolvedVariable(variables.color, state.variables)
                  )
                }
              }
            : {})
        })),
        ...paintDefaults(paint)
      }
    case 'IMAGE': {
      const { assetKey, imageUrl, ...fields } = paint
      return {
        ...fields,
        imageHash:
          assetKey !== undefined
            ? state.imageHashes.get(`asset:${assetKey}`)!
            : imageUrl === undefined
              ? (fields.imageHash ?? null)
              : state.imageHashes.get(imageUrl)!,
        ...paintDefaults(paint)
      }
    }
    case 'VIDEO': {
      const { videoUrl, ...fields } = paint
      return {
        ...fields,
        videoHash:
          videoUrl === undefined ? (fields.videoHash ?? null) : state.videoHashes.get(videoUrl)!,
        ...paintDefaults(paint)
      }
    }
    case 'PATTERN': {
      const { sourceCanvasKey, ...fields } = paint
      return {
        ...fields,
        sourceNodeId:
          sourceCanvasKey === undefined
            ? fields.sourceNodeId!
            : resolveCanvasKey(sourceCanvasKey, state).id,
        ...paintDefaults(paint)
      }
    }
    case 'SHADER': {
      const { properties: values, ...fields } = paint
      const properties = nativeShaderProperties(paint.id, values, state)
      return {
        ...fields,
        ...paintDefaults(paint),
        ...(properties ? { properties } : {})
      }
    }
  }
}

function bindEffectVariables(
  effect: Effect,
  bindings:
    | NonNullable<Extract<CanvasFigmaEffect, { type: 'DROP_SHADOW' }>['variables']>
    | undefined,
  state: ApplyState
): Effect {
  let bound = effect
  for (const [field, reference] of Object.entries(bindings ?? {})) {
    bound = figma.variables.setBoundVariableForEffect(
      bound,
      field as VariableBindableEffectField,
      resolvedVariable(reference, state.variables)
    )
  }
  return bound
}

function nativeEffect(effect: CanvasFigmaEffect, state: ApplyState): Effect {
  switch (effect.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW': {
      const { variables, ...fields } = effect
      return bindEffectVariables(
        {
          ...fields,
          ...(variables?.spread !== undefined && fields.spread === undefined ? { spread: 0 } : {}),
          visible: fields.visible ?? true,
          blendMode: fields.blendMode ?? 'NORMAL'
        },
        variables,
        state
      )
    }
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR': {
      const { variables, ...fields } = effect
      return bindEffectVariables({ ...fields, visible: fields.visible ?? true }, variables, state)
    }
    case 'NOISE':
      return {
        ...effect,
        visible: effect.visible ?? true,
        blendMode: effect.blendMode ?? 'NORMAL'
      }
    case 'TEXTURE':
    case 'GLASS':
      return { ...effect, visible: effect.visible ?? true }
    case 'SHADER': {
      const properties = nativeShaderProperties(effect.id, effect.properties, state)
      return {
        type: 'SHADER',
        id: effect.id,
        visible: effect.visible ?? true,
        ...(properties ? { properties } : {})
      }
    }
  }
}

function comparableEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).filter(
    ([key, field]) =>
      !(
        (key === 'boundVariables' || key === 'properties') &&
        isRecord(field) &&
        !Object.keys(field).length
      )
  )
}

function nativeValueEqual(current: unknown, desired: unknown): boolean {
  if (Object.is(current, desired)) return true
  if (Array.isArray(current) || Array.isArray(desired)) {
    return (
      Array.isArray(current) &&
      Array.isArray(desired) &&
      current.length === desired.length &&
      current.every((value, index) => nativeValueEqual(value, desired[index]))
    )
  }
  if (!isRecord(current) || !isRecord(desired)) return false
  const currentEntries = comparableEntries(current)
  const desiredEntries = comparableEntries(desired)
  return (
    currentEntries.length === desiredEntries.length &&
    currentEntries.every(([key, value]) => nativeValueEqual(value, desired[key]))
  )
}

function nativeLayoutGrid(grid: CanvasFigmaLayoutGrid, state: ApplyState): LayoutGrid {
  const { variables, ...fields } = grid
  let native: LayoutGrid =
    fields.pattern === 'GRID'
      ? fields
      : {
          ...fields,
          count: fields.count === 'AUTO' ? Infinity : fields.count
        }
  for (const [field, reference] of Object.entries(variables ?? {}) as Array<
    [VariableBindableLayoutGridField, CanvasVariableReference]
  >) {
    native = figma.variables.setBoundVariableForLayoutGrid(
      native,
      field,
      resolvedVariable(reference, state.variables)
    )
  }
  return native
}

function comparableLayoutGrid(grid: LayoutGrid): LayoutGrid {
  return {
    ...grid,
    visible: grid.visible ?? true
  }
}

function layoutGridsEqual(current: readonly LayoutGrid[], desired: readonly LayoutGrid[]): boolean {
  return (
    current.length === desired.length &&
    current.every((grid, index) =>
      nativeValueEqual(comparableLayoutGrid(grid), comparableLayoutGrid(desired[index]!))
    )
  )
}

const IMAGE_FILTER_FIELDS = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows'
] as const satisfies ReadonlyArray<keyof ImageFilters>

function comparablePaint(paint: Paint): Paint {
  if (paint.type === 'IMAGE' || paint.type === 'VIDEO') {
    return {
      ...paint,
      ...paintDefaults(paint),
      filters: Object.fromEntries(
        IMAGE_FILTER_FIELDS.map((field) => [field, paint.filters?.[field] ?? 0])
      )
    }
  }
  return {
    ...paint,
    ...paintDefaults(paint)
  }
}

function paintStacksEqual(current: readonly Paint[], desired: readonly Paint[]): boolean {
  return (
    current.length === desired.length &&
    current.every((paint, index) => {
      const expected = desired[index]!
      return (
        paint.type === expected.type &&
        nativeValueEqual(comparablePaint(paint), comparablePaint(expected))
      )
    })
  )
}

function isShadowEffect(effect: Effect): effect is DropShadowEffect | InnerShadowEffect {
  return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
}

function comparableShadow(effect: DropShadowEffect | InnerShadowEffect): Effect {
  return {
    ...effect,
    spread: effect.spread ?? 0,
    ...(effect.type === 'DROP_SHADOW'
      ? { showShadowBehindNode: effect.showShadowBehindNode ?? false }
      : {})
  }
}

function effectsEqual(current: readonly Effect[], desired: readonly Effect[]): boolean {
  if (current.length !== desired.length) return false
  return current.every((effect, index) => {
    const expected = desired[index]!
    if (effect.type !== expected.type) return false
    if (isShadowEffect(effect) && isShadowEffect(expected)) {
      return nativeValueEqual(comparableShadow(effect), comparableShadow(expected))
    }
    return nativeValueEqual(effect, expected)
  })
}

function setStyleValue<T>(
  current: T,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState,
  equal: (left: T, right: T) => boolean = nativeValueEqual
): void {
  if (desired === undefined || equal(current, desired)) return
  apply(desired)
  state.mutations.count += 1
}

function applyStyleMetadata(style: BaseStyle, spec: CanvasStyleResource, state: ApplyState): void {
  setStyleValue(style.name, spec.name, (value) => (style.name = value), state)
  setStyleValue(
    style.descriptionMarkdown,
    spec.descriptionMarkdown,
    (value) => (style.descriptionMarkdown = value),
    state
  )
  if (spec.documentationLink === undefined) return
  const links = spec.documentationLink === null ? [] : [{ uri: spec.documentationLink }]
  setStyleValue(
    style.documentationLinks,
    links,
    (value) => (style.documentationLinks = value),
    state
  )
}

function applyTextStyle(style: TextStyle, spec: TextStyleResource, state: ApplyState): void {
  for (const [field, reference] of textStyleVariableEntries(spec)) {
    if (reference !== null || !style.boundVariables?.[field]) continue
    style.setBoundVariable(field, null)
    state.mutations.count += 1
  }
  for (const field of TEXT_STYLE_VALUE_FIELDS) {
    const desired = spec[field]
    if (
      desired === undefined ||
      TEXT_STYLE_VARIABLES_BY_VALUE[field].some(
        (variableField) => style.boundVariables?.[variableField]
      ) ||
      nativeValueEqual(style[field], desired)
    ) {
      continue
    }
    Object.assign(style, { [field]: desired })
    state.mutations.count += 1
  }
  for (const [field, reference] of textStyleVariableEntries(spec)) {
    if (!reference) continue
    const variable = resolvedVariable(reference, state.variables)
    if (style.boundVariables?.[field]?.id === variable.id) continue
    style.setBoundVariable(field, variable)
    state.mutations.count += 1
  }
}

function applyStyleResources(state: ApplyState): void {
  for (const { spec, style } of state.styles.resources) {
    applyStyleMetadata(style, spec, state)
    switch (spec.type) {
      case 'PAINT': {
        if (spec.paints === undefined) break
        const desired = spec.paints.map((paint) => nativePaint(paint, state))
        setStyleValue(
          (style as PaintStyle).paints,
          desired,
          (value) => ((style as PaintStyle).paints = value),
          state,
          paintStacksEqual
        )
        break
      }
      case 'TEXT':
        applyTextStyle(style as TextStyle, spec, state)
        break
      case 'EFFECT': {
        if (spec.effects === undefined) break
        const desired = spec.effects.map((effect) => nativeEffect(effect, state))
        setStyleValue(
          (style as EffectStyle).effects,
          desired,
          (value) => ((style as EffectStyle).effects = value),
          state,
          effectsEqual
        )
        break
      }
      case 'GRID': {
        if (spec.layoutGrids === undefined) break
        const desired = spec.layoutGrids.map((grid) => nativeLayoutGrid(grid, state))
        setStyleValue(
          (style as GridStyle).layoutGrids,
          desired,
          (value) => ((style as GridStyle).layoutGrids = value),
          state,
          layoutGridsEqual
        )
        break
      }
    }
  }
}

function applyPaintStacks(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  for (const [property, styleProperty] of [
    ['fills', 'fillStyleId'],
    ['strokes', 'strokeStyleId']
  ] as const) {
    const paints = spec.figma?.[property]
    if (paints === undefined) continue
    if (!('fills' in node)) {
      specError(`Direct paints are not supported on ${node.type} node "${spec.key}".`)
    }
    const desired = paints.map((paint) => nativePaint(paint, state))
    const current = node[property]
    if (current !== figma.mixed && !node[styleProperty] && paintStacksEqual(current, desired)) {
      continue
    }
    node[property] = desired
    markMutation(state, node)
  }
}

function validateShadowSpread(node: SupportedCanvasNode, spec: CanvasNodeSpec): void {
  const hasSpread = spec.figma?.effects?.some(
    (effect) =>
      (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') &&
      (effect.spread !== undefined || effect.variables?.spread !== undefined)
  )
  if (!hasSpread || node.type === 'RECTANGLE' || node.type === 'ELLIPSE') return
  if (
    (isFrameContainer(node) || node.type === 'INSTANCE') &&
    node.clipsContent &&
    node.fills !== figma.mixed &&
    node.fills.some((paint) => paint.visible ?? true)
  ) {
    return
  }
  specError(
    `Shadow spread on "${spec.key}" requires a rectangle, ellipse, or a clipped frame/instance with a visible fill; authored components and component sets count as frames.`
  )
}

function applyEffects(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const effects = spec.figma?.effects
  if (effects === undefined) return
  if (!('effects' in node)) {
    specError(`Effects are not supported on ${node.type} node "${spec.key}".`)
  }
  validateShadowSpread(node, spec)
  const desired = effects.map((effect) => nativeEffect(effect, state))
  if (!node.effectStyleId && effectsEqual(node.effects, desired)) return
  node.effects = desired
  markMutation(state, node)
}

function applyLayoutAids(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  if (!isFrameContainer(node) && node.type !== 'INSTANCE') return
  const layoutGrids = spec.figma?.layoutGrids
  if (layoutGrids !== undefined) {
    const desired = layoutGrids.map((grid) => nativeLayoutGrid(grid, state))
    if (node.gridStyleId || !layoutGridsEqual(node.layoutGrids, desired)) {
      node.layoutGrids = desired
      markMutation(state, node)
    }
  }
  applyGuides(node, spec.figma?.guides, state)
}

function applyGuides(
  node: CanvasFrameContainerNode | InstanceNode | PageNode,
  guides: CanvasPageProperties['guides'],
  state: ApplyState
): void {
  if (guides === undefined || nativeValueEqual(node.guides, guides)) return
  node.guides = guides
  markMutation(state, node)
}

async function nativeVectorNetwork(
  network: CanvasFigmaVectorNetwork,
  state: ApplyState
): Promise<VectorNetwork> {
  const { regions, ...geometry } = network
  if (!regions) return geometry

  return {
    ...geometry,
    regions: await Promise.all(
      regions.map(async ({ fills, fillStyle, ...region }) => ({
        ...region,
        ...(fills === undefined ? {} : { fills: fills.map((paint) => nativePaint(paint, state)) }),
        ...(fillStyle ? { fillStyleId: (await resolveStyle(fillStyle, state.styles)).id } : {})
      }))
    )
  }
}

function comparableVectorNetwork(network: VectorNetwork): unknown {
  return {
    vertices: network.vertices,
    segments: network.segments.map((segment) => ({
      ...segment,
      tangentStart: segment.tangentStart ?? { x: 0, y: 0 },
      tangentEnd: segment.tangentEnd ?? { x: 0, y: 0 }
    })),
    regions: (network.regions ?? []).map(({ fills, fillStyleId, ...region }) => ({
      ...region,
      ...(fillStyleId
        ? { fillStyleId }
        : fills === undefined
          ? {}
          : { fills: fills.map(comparablePaint) })
    }))
  }
}

function vectorNetworksEqual(current: VectorNetwork, desired: VectorNetwork): boolean {
  return nativeValueEqual(comparableVectorNetwork(current), comparableVectorNetwork(desired))
}

async function applyShape(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState,
  resolveCanvasReferences = false
): Promise<void> {
  const shape = spec.figma?.shape
  if (!shape) return

  switch (shape.type) {
    case 'RECTANGLE':
    case 'LINE':
      return
    case 'ELLIPSE': {
      if (!shape.arc) return
      if (node.type !== 'ELLIPSE') specError(`Native shape "${spec.key}" is not an ellipse.`)
      const desired = {
        startingAngle: (shape.arc.startAngle * Math.PI) / 180,
        endingAngle: (shape.arc.endAngle * Math.PI) / 180,
        innerRadius: shape.arc.innerRadius
      }
      const current = node.arcData
      if (
        Math.abs(current.startingAngle - desired.startingAngle) <= 1e-6 &&
        Math.abs(current.endingAngle - desired.endingAngle) <= 1e-6 &&
        Math.abs(current.innerRadius - desired.innerRadius) <= 1e-6
      ) {
        return
      }
      node.arcData = desired
      markMutation(state, node)
      return
    }
    case 'POLYGON':
      if (shape.pointCount === undefined) return
      if (node.type !== 'POLYGON') specError(`Native shape "${spec.key}" is not a polygon.`)
      setValue(node, node.pointCount, shape.pointCount, (value) => (node.pointCount = value), state)
      return
    case 'STAR':
      if (node.type !== 'STAR') specError(`Native shape "${spec.key}" is not a star.`)
      setValue(node, node.pointCount, shape.pointCount, (value) => (node.pointCount = value), state)
      setValue(
        node,
        node.innerRadius,
        shape.innerRadius,
        (value) => (node.innerRadius = value),
        state
      )
      return
    case 'VECTOR': {
      if (node.type !== 'VECTOR') specError(`Native shape "${spec.key}" is not a vector.`)
      setValue(
        node,
        node.handleMirroring,
        shape.handleMirroring,
        (value) => (node.handleMirroring = value),
        state
      )
      if (shape.paths !== undefined) {
        if (vectorPathsEqual(node.vectorPaths, shape.paths)) return
        node.vectorPaths = canonicalVectorPaths(shape.paths)
        markMutation(state, node)
        return
      }
      if (shape.network !== undefined) {
        if (!resolveCanvasReferences && hasCanvasKeyVectorPattern(spec)) return
        const network = await nativeVectorNetwork(shape.network, state)
        if (vectorNetworksEqual(node.vectorNetwork, network)) return
        await node.setVectorNetworkAsync(network)
        markMutation(state, node)
      }
    }
  }
}

async function loadTextFonts(
  node: TextNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<FontName | null> {
  const text = spec.text
  const currentFont = node.fontName
  const hasTextStyle = !!(spec.styles?.text || node.textStyleId)
  const fontFamily =
    hasTextStyle || spec.variables?.fontFamily || currentBoundVariableId(node, 'fontFamily')
      ? undefined
      : text?.fontFamily
  const fontStyle =
    hasTextStyle || spec.variables?.fontStyle || currentBoundVariableId(node, 'fontStyle')
      ? undefined
      : text?.fontStyle
  const hasExplicitFont = fontFamily !== undefined || fontStyle !== undefined
  if (currentFont === figma.mixed && hasExplicitFont && (!fontFamily || !fontStyle)) {
    specError(
      `TEXT "${spec.key}" has mixed fonts; provide both fontFamily and fontStyle to replace them.`
    )
  }

  const desiredFont: FontName | null = hasExplicitFont
    ? {
        family: fontFamily ?? (currentFont === figma.mixed ? '' : currentFont.family),
        style: fontStyle ?? (currentFont === figma.mixed ? '' : currentFont.style)
      }
    : null
  const fonts = desiredFont
    ? [desiredFont]
    : currentFont === figma.mixed
      ? node.getRangeAllFontNames(0, node.characters.length)
      : [currentFont]
  await loadFonts(fonts, state)
  return desiredFont
}

function preservesComponentPropertyReference(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  field: ComponentPropertyReferenceField
): boolean {
  const desired = spec.figma?.componentPropertyReferences?.[field]
  return desired === undefined
    ? node.componentPropertyReferences?.[field] !== undefined
    : desired !== null
}

async function applyText(node: TextNode, spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  const text = spec.text
  if (!text) return
  const native = spec.figma?.text
  const desiredFont = await loadTextFonts(node, spec, state)
  const hasTextStyle = !!(spec.styles?.text || node.textStyleId)
  if (
    desiredFont &&
    (node.fontName === figma.mixed ||
      node.fontName.family !== desiredFont.family ||
      node.fontName.style !== desiredFont.style)
  ) {
    node.fontName = desiredFont
    markMutation(state, node)
  }
  setValue(
    node,
    node.textAutoResize,
    text.autoResize,
    (value) => (node.textAutoResize = value),
    state
  )
  setValue(node, node.autoRename, native?.autoRename, (value) => (node.autoRename = value), state)
  setValue(
    node,
    node.characters,
    preservesComponentPropertyReference(node, spec, 'characters') ||
      spec.variables?.characters ||
      currentBoundVariableId(node, 'characters')
      ? undefined
      : text.characters,
    (value) => (node.characters = value),
    state
  )
  setValue(
    node,
    node.fontSize,
    hasTextStyle || spec.variables?.fontSize || currentBoundVariableId(node, 'fontSize')
      ? undefined
      : text.fontSize,
    (value) => (node.fontSize = value),
    state
  )
  setTextMeasure(
    node,
    node.lineHeight,
    hasTextStyle || spec.variables?.lineHeight || currentBoundVariableId(node, 'lineHeight')
      ? undefined
      : text.lineHeight,
    (value) => (node.lineHeight = value),
    state
  )
  setTextMeasure(
    node,
    node.letterSpacing,
    hasTextStyle || spec.variables?.letterSpacing || currentBoundVariableId(node, 'letterSpacing')
      ? undefined
      : text.letterSpacing,
    (value) => (node.letterSpacing = value),
    state
  )
  setValue(
    node,
    node.textAlignHorizontal,
    text.alignHorizontal,
    (value) => (node.textAlignHorizontal = value),
    state
  )
  setValue(
    node,
    node.textAlignVertical,
    text.alignVertical,
    (value) => (node.textAlignVertical = value),
    state
  )
  setValue(
    node,
    node.textCase,
    native?.case ?? (hasTextStyle ? undefined : text.textCase),
    (value) => (node.textCase = value),
    state
  )
  setValue(
    node,
    node.textDecoration,
    hasTextStyle ? undefined : text.textDecoration,
    (value) => (node.textDecoration = value),
    state
  )
  setValue(
    node,
    node.textTruncation,
    text.textTruncation,
    (value) => (node.textTruncation = value),
    state
  )
  setValue(node, node.maxLines, text.maxLines, (value) => (node.maxLines = value), state)
  setValue(
    node,
    node.paragraphIndent,
    spec.variables?.paragraphIndent || currentBoundVariableId(node, 'paragraphIndent')
      ? undefined
      : native?.paragraphIndent,
    (value) => (node.paragraphIndent = value),
    state
  )
  setValue(
    node,
    node.paragraphSpacing,
    spec.variables?.paragraphSpacing || currentBoundVariableId(node, 'paragraphSpacing')
      ? undefined
      : native?.paragraphSpacing,
    (value) => (node.paragraphSpacing = value),
    state
  )
  setValue(
    node,
    node.listSpacing,
    native?.listSpacing,
    (value) => (node.listSpacing = value),
    state
  )
  setValue(
    node,
    node.hangingPunctuation,
    native?.hangingPunctuation,
    (value) => (node.hangingPunctuation = value),
    state
  )
  setValue(
    node,
    node.hangingList,
    native?.hangingList,
    (value) => (node.hangingList = value),
    state
  )
  setValue(
    node,
    node.leadingTrim,
    native?.leadingTrim,
    (value) => (node.leadingTrim = value),
    state
  )
  if (!isCanvasKeyHyperlink(native?.hyperlink)) {
    applyTextHyperlink(node, native?.hyperlink, state)
  }
}

function textMeasuresEqual(
  current: LineHeight | LetterSpacing | typeof figma.mixed,
  desired: LineHeight | LetterSpacing
): boolean {
  return (
    current !== figma.mixed &&
    current.unit === desired.unit &&
    (current.unit === 'AUTO' || (desired.unit !== 'AUTO' && current.value === desired.value))
  )
}

function setTextMeasure<T extends LineHeight | LetterSpacing>(
  node: TextNode,
  current: T | typeof figma.mixed,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || textMeasuresEqual(current, desired)) return
  apply(desired)
  markMutation(state, node)
}

function hyperlinksEqual(
  current: HyperlinkTarget | null | typeof figma.mixed,
  desired: HyperlinkTarget | null
): boolean {
  return (
    current !== figma.mixed &&
    (current === desired ||
      (!!current && !!desired && current.type === desired.type && current.value === desired.value))
  )
}

function nativeHyperlink(
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

function applyTextHyperlink(
  node: TextNode,
  hyperlink: CanvasHyperlink | undefined,
  state: ApplyState
): void {
  const desired = nativeHyperlink(hyperlink, state)
  if (desired === undefined || hyperlinksEqual(node.hyperlink, desired)) return
  node.hyperlink = desired
  markMutation(state, node)
}

function applyTextRangeValue<T>(
  node: TextNode,
  current: T | typeof figma.mixed | null,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || nativeValueEqual(current, desired)) return
  apply(desired)
  markMutation(state, node)
}

async function applyTextRangeStyle(
  node: TextNode,
  reference: CanvasStyleReference | null | undefined,
  current: () => string | typeof figma.mixed,
  apply: (id: string) => Promise<void>,
  state: ApplyState
): Promise<void> {
  if (reference === undefined) return
  const styleId = reference ? (await resolveStyle(reference, state.styles)).id : ''
  if (current() === styleId) return
  await apply(styleId)
  markMutation(state, node)
}

function applyTextRangeFills(node: TextNode, range: CanvasFigmaTextRange, state: ApplyState): void {
  if (range.fills === undefined) return
  const desired = range.fills.map((paint) => nativePaint(paint, state))
  const current = node.getRangeFills(range.start, range.end)
  const style = node.getRangeFillStyleId(range.start, range.end)
  if (current !== figma.mixed && !style && paintStacksEqual(current, desired)) return
  node.setRangeFills(range.start, range.end, desired)
  markMutation(state, node)
}

function nativeTextDecorationColor(
  range: CanvasFigmaTextRange,
  state: ApplyState
): TextDecorationColor | undefined {
  const color = range.textDecorationColor
  if (!color || color.value === 'AUTO') return color
  return { value: nativePaint(color.value, state) as SolidPaint }
}

type FontVariableBindings = Pick<CanvasVariableBindings, 'fontFamily' | 'fontStyle'>

function resolvedFontVariableValue(
  node: TextNode,
  reference: CanvasVariableReference,
  state: ApplyState
): string {
  const value = resolvedVariable(reference, state.variables).resolveForConsumer(node).value
  if (typeof value !== 'string') {
    specError('A preflighted font variable did not resolve to a string.')
  }
  return value
}

async function loadVariableFonts(
  node: TextNode,
  bindings: FontVariableBindings | undefined,
  state: ApplyState,
  range?: Pick<CanvasFigmaTextRange, 'start' | 'end'>
): Promise<void> {
  const familyReference = bindings?.fontFamily
  const styleReference = bindings?.fontStyle
  if (!familyReference && !styleReference) return

  const currentFonts = !familyReference || !styleReference ? currentTextFonts(node, range) : []
  const families = familyReference
    ? [resolvedFontVariableValue(node, familyReference, state)]
    : currentFonts.map((font) => font.family)
  const styles = styleReference
    ? [resolvedFontVariableValue(node, styleReference, state)]
    : currentFonts.map((font) => font.style)
  const fonts: FontName[] = []
  for (const family of families) {
    for (const style of styles) {
      fonts.push({ family, style })
    }
  }
  await loadFonts(fonts, state)
}

async function applyTextRangeVariables(
  node: TextNode,
  range: CanvasFigmaTextRange,
  state: ApplyState
): Promise<void> {
  await loadVariableFonts(node, range.variables, state, range)
  for (const [field, reference] of Object.entries(range.variables ?? {}) as Array<
    [VariableBindableTextField, CanvasVariableReference | null]
  >) {
    const variable = reference ? resolvedVariable(reference, state.variables) : null
    const current = node.getRangeBoundVariable(range.start, range.end, field)
    if (current !== figma.mixed && current?.id === variable?.id) continue
    node.setRangeBoundVariable(range.start, range.end, field, variable)
    markMutation(state, node)
  }
}

async function applyTextRanges(
  node: TextNode,
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState
): Promise<void> {
  for (const range of ranges ?? []) {
    if (range.end > node.characters.length) {
      specError(
        `Text range ${range.start}:${range.end} exceeds TEXT node "${node.id}" with ${node.characters.length} UTF-16 code units.`
      )
    }
    await applyTextRangeStyle(
      node,
      range.textStyle,
      () => node.getRangeTextStyleId(range.start, range.end),
      (id) => node.setRangeTextStyleIdAsync(range.start, range.end, id),
      state
    )
    await applyTextRangeStyle(
      node,
      range.fillStyle,
      () => node.getRangeFillStyleId(range.start, range.end),
      (id) => node.setRangeFillStyleIdAsync(range.start, range.end, id),
      state
    )
    applyTextRangeFills(node, range, state)
    applyTextRangeValue(
      node,
      node.getRangeFontName(range.start, range.end),
      range.fontName,
      (value) => node.setRangeFontName(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeFontSize(range.start, range.end),
      range.fontSize,
      (value) => node.setRangeFontSize(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextCase(range.start, range.end),
      range.textCase,
      (value) => node.setRangeTextCase(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeLetterSpacing(range.start, range.end),
      range.letterSpacing,
      (value) => node.setRangeLetterSpacing(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeLineHeight(range.start, range.end),
      range.lineHeight,
      (value) => node.setRangeLineHeight(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecoration(range.start, range.end),
      range.textDecoration,
      (value) => node.setRangeTextDecoration(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationStyle(range.start, range.end),
      range.textDecorationStyle,
      (value) => node.setRangeTextDecorationStyle(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationOffset(range.start, range.end),
      range.textDecorationOffset,
      (value) => node.setRangeTextDecorationOffset(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationThickness(range.start, range.end),
      range.textDecorationThickness,
      (value) => node.setRangeTextDecorationThickness(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationColor(range.start, range.end),
      nativeTextDecorationColor(range, state),
      (value) => node.setRangeTextDecorationColor(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationSkipInk(range.start, range.end),
      range.textDecorationSkipInk,
      (value) => node.setRangeTextDecorationSkipInk(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeListOptions(range.start, range.end),
      range.listOptions,
      (value) => node.setRangeListOptions(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeListSpacing(range.start, range.end),
      range.listSpacing,
      (value) => node.setRangeListSpacing(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeIndentation(range.start, range.end),
      range.indentation,
      (value) => node.setRangeIndentation(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeParagraphIndent(range.start, range.end),
      range.paragraphIndent,
      (value) => node.setRangeParagraphIndent(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeParagraphSpacing(range.start, range.end),
      range.paragraphSpacing,
      (value) => node.setRangeParagraphSpacing(range.start, range.end, value),
      state
    )
    const hyperlink = nativeHyperlink(range.hyperlink, state)
    if (
      hyperlink !== undefined &&
      !hyperlinksEqual(node.getRangeHyperlink(range.start, range.end), hyperlink)
    ) {
      node.setRangeHyperlink(range.start, range.end, hyperlink)
      markMutation(state, node)
    }
    await applyTextRangeVariables(node, range, state)
  }
}

async function applyComponent(
  node: InstanceNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const instance = spec.figma?.instance
  if (!preservesComponentPropertyReference(node, spec, 'mainComponent')) {
    const component = await resolveComponent(spec.component!, state)
    const currentComponent = await node.getMainComponentAsync()
    if (currentComponent?.id !== component.id) {
      if (instance?.preserveOverrides === false) node.mainComponent = component
      else node.swapComponent(component)
      markMutation(state, node)
    }
  }

  setValue(
    node,
    node.scaleFactor,
    instance?.scaleFactor,
    (value) => (node.scaleFactor = value),
    state
  )
  setValue(
    node,
    node.isExposedInstance,
    instance?.exposed,
    (value) => (node.isExposedInstance = value),
    state
  )

  const changedProperties = Object.entries(spec.componentProperties ?? {}).filter(
    ([name, value]) => {
      const current = node.componentProperties[name]
      return isComponentPropertyVariable(value)
        ? current?.boundVariables?.value?.id !==
            resolvedVariable(value.variable, state.variables).id
        : current?.value !== value || current?.boundVariables?.value !== undefined
    }
  )
  if (changedProperties.length) {
    node.setProperties(
      Object.fromEntries(
        changedProperties.map(([name, value]) => [
          name,
          isComponentPropertyVariable(value)
            ? figma.variables.createVariableAlias(resolvedVariable(value.variable, state.variables))
            : value
        ])
      )
    )
    markMutation(state, node)
  }
}

const STYLE_FIELDS = ['fill', 'stroke', 'text', 'effect', 'grid'] as const

type StyleField = (typeof STYLE_FIELDS)[number]

function styleTarget(
  node: SupportedCanvasNode,
  field: StyleField
): {
  apply: (id: string) => Promise<void>
  current: string | symbol
  text?: TextNode
} {
  switch (field) {
    case 'fill':
      if (!('fillStyleId' in node)) {
        specError(`Fill styles are not supported on ${node.type} nodes.`)
      }
      return {
        current: node.fillStyleId,
        apply: (id) => node.setFillStyleIdAsync(id)
      }
    case 'stroke':
      if (!('strokeStyleId' in node)) {
        specError(`Stroke styles are not supported on ${node.type} nodes.`)
      }
      return {
        current: node.strokeStyleId,
        apply: (id) => node.setStrokeStyleIdAsync(id)
      }
    case 'text':
      if (node.type !== 'TEXT') specError(`Text styles require a TEXT node, not ${node.type}.`)
      return {
        current: node.textStyleId,
        apply: (id) => node.setTextStyleIdAsync(id),
        text: node
      }
    case 'effect':
      if (!('effectStyleId' in node)) {
        specError(`Effect styles are not supported on ${node.type} nodes.`)
      }
      return {
        current: node.effectStyleId,
        apply: (id) => node.setEffectStyleIdAsync(id)
      }
    case 'grid':
      if (!isFrameContainer(node) && node.type !== 'INSTANCE') {
        specError('Grid styles require a frame container or instance node.')
      }
      return {
        current: node.gridStyleId,
        apply: (id) => node.setGridStyleIdAsync(id)
      }
  }
}

async function setStyleLink(
  node: SupportedCanvasNode,
  field: StyleField,
  id: string,
  state: ApplyState
): Promise<void> {
  const target = styleTarget(node, field)
  if (target.current === id) return
  if (!id && target.text) await loadFonts(currentTextFonts(target.text), state)
  await target.apply(id)
  markMutation(state, node)
}

async function unlinkStyles(
  node: SupportedCanvasNode,
  bindings: CanvasStyleBindings | undefined,
  state: ApplyState
): Promise<void> {
  for (const field of STYLE_FIELDS) {
    if (bindings?.[field] !== null) continue
    await setStyleLink(node, field, '', state)
  }
}

async function applyStyles(
  node: SupportedCanvasNode,
  bindings: CanvasStyleBindings | undefined,
  state: ApplyState
): Promise<void> {
  if (!bindings) return
  for (const field of STYLE_FIELDS) {
    const reference = bindings[field]
    if (!reference) continue
    const style = await resolveStyle(reference, state.styles)
    await setStyleLink(node, field, style.id, state)
  }
}

type DirectVariableField = Exclude<keyof CanvasVariableBindings, 'fill' | 'stroke'>

const DIRECT_VARIABLE_FIELDS: Record<
  DirectVariableField,
  VariableBindableNodeField | VariableBindableTextField
> = {
  characters: 'characters',
  visible: 'visible',
  width: 'width',
  height: 'height',
  minWidth: 'minWidth',
  maxWidth: 'maxWidth',
  minHeight: 'minHeight',
  maxHeight: 'maxHeight',
  gap: 'itemSpacing',
  counterAxisSpacing: 'counterAxisSpacing',
  gridRowGap: 'gridRowGap',
  gridColumnGap: 'gridColumnGap',
  paddingTop: 'paddingTop',
  paddingRight: 'paddingRight',
  paddingBottom: 'paddingBottom',
  paddingLeft: 'paddingLeft',
  cornerRadius: 'cornerRadius',
  topLeftRadius: 'topLeftRadius',
  topRightRadius: 'topRightRadius',
  bottomRightRadius: 'bottomRightRadius',
  bottomLeftRadius: 'bottomLeftRadius',
  strokeWeight: 'strokeWeight',
  strokeTopWeight: 'strokeTopWeight',
  strokeRightWeight: 'strokeRightWeight',
  strokeBottomWeight: 'strokeBottomWeight',
  strokeLeftWeight: 'strokeLeftWeight',
  opacity: 'opacity',
  fontFamily: 'fontFamily',
  fontStyle: 'fontStyle',
  fontWeight: 'fontWeight',
  fontSize: 'fontSize',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  paragraphIndent: 'paragraphIndent',
  paragraphSpacing: 'paragraphSpacing'
}

function currentBoundVariableId(
  node: SupportedCanvasNode,
  field: VariableBindableNodeField | VariableBindableTextField
): string | undefined {
  const value = node.boundVariables?.[field]
  const directId = Array.isArray(value) ? value[0]?.id : value?.id
  if (directId || field !== 'cornerRadius') return directId

  const aliases = [
    node.boundVariables?.topLeftRadius,
    node.boundVariables?.topRightRadius,
    node.boundVariables?.bottomLeftRadius,
    node.boundVariables?.bottomRightRadius
  ]
  const radiusId = aliases[0]?.id
  return radiusId && aliases.every((alias) => alias?.id === radiusId) ? radiusId : undefined
}

function applyPaintVariable(
  node: SupportedCanvasNode,
  field: 'fill' | 'stroke',
  variable: Variable | null,
  state: ApplyState
): void {
  if (!('fills' in node)) {
    specError(`${field} variables are not supported on ${node.type} node "${node.id}".`)
  }
  const property = field === 'fill' ? 'fills' : 'strokes'
  const currentVariable = node.boundVariables?.[property]?.[0]
  if (currentVariable?.id === variable?.id || (!currentVariable && !variable)) return
  const styleId = field === 'fill' ? node.fillStyleId : node.strokeStyleId
  if (!variable && styleId) {
    specError(
      `${field} variable bindings cannot be cleared without replacing the existing Paint style on node "${node.id}".`
    )
  }

  const currentPaints = node[property]
  if (currentPaints === figma.mixed) {
    specError(`${field} variable bindings cannot target mixed paints on node "${node.id}".`)
  }
  const paints = [...currentPaints]
  if (paints.length !== 1 || paints[0]?.type !== 'SOLID') {
    specError(`${field} variable bindings require exactly one solid paint on node "${node.id}".`)
  }
  paints[0] = figma.variables.setBoundVariableForPaint(paints[0], 'color', variable)
  node[property] = paints
  markMutation(state, node)
}

function clearVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState
): void {
  if (!bindings) return
  for (const field of Object.keys(bindings) as Array<keyof CanvasVariableBindings>) {
    if (bindings[field] !== null) continue
    if (field === 'fill' || field === 'stroke') {
      applyPaintVariable(node, field, null, state)
      continue
    }
    const figmaField = DIRECT_VARIABLE_FIELDS[field]
    if (!currentBoundVariableId(node, figmaField)) continue
    node.setBoundVariable(figmaField, null)
    markMutation(state, node)
  }
}

async function applyVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState
): Promise<void> {
  if (!bindings) return
  if (node.type === 'TEXT') await loadVariableFonts(node, bindings, state)
  for (const field of Object.keys(bindings) as Array<keyof CanvasVariableBindings>) {
    const reference = bindings[field]
    if (!reference) continue
    const variable = await resolveVariable(reference, state.variables)
    if (field === 'fill' || field === 'stroke') {
      applyPaintVariable(node, field, variable, state)
      continue
    }
    const figmaField = DIRECT_VARIABLE_FIELDS[field]
    if (currentBoundVariableId(node, figmaField) === variable.id) continue
    node.setBoundVariable(figmaField, variable)
    markMutation(state, node)
  }
}

function applyVariableModes(
  node: SupportedCanvasNode | PageNode,
  modes: CanvasNodeSpec['variableModes'],
  state: ApplyState
): void {
  for (const [collectionReference, modeReference] of Object.entries(modes ?? {})) {
    const collection = resolvedCollection(collectionReference, state.variables)
    const current = node.explicitVariableModes[collection.id]
    if (modeReference === null) {
      if (current === undefined) continue
      node.clearExplicitVariableModeForCollection(collection)
    } else {
      const modeId = resolvedModeId(collection, modeReference, state.variables)
      if (current === modeId) continue
      node.setExplicitVariableModeForCollection(collection, modeId)
    }
    markMutation(state, node)
  }
}

function applyPage(page: PageNode, properties: CanvasPageProperties, state: ApplyState): void {
  if (properties.index !== undefined) {
    const current = figma.root.children.indexOf(page)
    if (current !== properties.index) {
      figma.root.insertChild(properties.index, page)
      markMutation(state, page)
    }
  }
  setValue(page, page.name, properties.name, (value) => (page.name = value), state)
  if (properties.background) {
    const { a: opacity, ...color } = properties.background
    const background: SolidPaint[] = [{ type: 'SOLID', color, opacity }]
    if (!paintStacksEqual(page.backgrounds, background)) {
      page.backgrounds = background
      markMutation(state, page)
    }
  }
  applyGuides(page, properties.guides, state)
  applyVariableModes(page, properties.variableModes, state)
}

function nativeComponentPropertyDefault(
  definition: CanvasFigmaComponentPropertyDefinition,
  state: ApplyState
): string | boolean | VariableAlias {
  const value = definition.defaultValue
  if (isComponentPropertyVariable(value)) {
    return figma.variables.createVariableAlias(resolvedVariable(value.variable, state.variables))
  }
  return definition.type === 'INSTANCE_SWAP'
    ? resolvedComponent(value as CanvasDesignReference, state).id
    : (value as string | boolean)
}

function componentPropertyDefaultMatches(
  current: ComponentPropertyDefinitions[string],
  desired: string | boolean | VariableAlias
): boolean {
  return isRecord(desired)
    ? current.boundVariables?.defaultValue?.id === desired.id
    : current.boundVariables?.defaultValue === undefined && current.defaultValue === desired
}

function componentPropertyOptions(
  definition: CanvasFigmaComponentPropertyDefinition
): ComponentPropertyOptions | undefined {
  return definition.type === 'INSTANCE_SWAP' && definition.preferredValues !== undefined
    ? { preferredValues: definition.preferredValues }
    : undefined
}

function applyAuthoredComponentProperties(
  owner: ComponentPropertyOwner,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const properties = spec.figma?.component?.properties
  if (!properties) return
  const keys = componentPropertyKeys(owner, state)
  for (const [key, desired] of Object.entries(properties)) {
    const propertyName = keys[key] ?? key
    const current = owner.componentPropertyDefinitions[propertyName]
    if (desired === null) {
      if (!current) continue
      if (!keys[key]) setComponentPropertyKey(owner, key, propertyName, state)
      owner.deleteComponentProperty(propertyName)
      markMutation(state, owner)
      continue
    }

    const defaultValue = nativeComponentPropertyDefault(desired, state)
    if (!current) {
      const createdName = owner.addComponentProperty(
        desired.name,
        desired.type,
        defaultValue,
        componentPropertyOptions(desired)
      )
      markMutation(state, owner)
      setComponentPropertyKey(owner, key, createdName, state)
      continue
    }

    const edit: {
      name?: string
      defaultValue?: string | boolean | VariableAlias
      preferredValues?: InstanceSwapPreferredValue[]
    } = {}
    if (componentPropertyDisplayName(propertyName) !== desired.name) {
      edit.name = desired.name
    }
    if (!componentPropertyDefaultMatches(current, defaultValue)) {
      edit.defaultValue = defaultValue
    }
    if (
      desired.type === 'INSTANCE_SWAP' &&
      desired.preferredValues !== undefined &&
      !nativeValueEqual(current.preferredValues ?? [], desired.preferredValues)
    ) {
      edit.preferredValues = desired.preferredValues
    }
    if (!Object.keys(edit).length) continue
    const editedName = owner.editComponentProperty(propertyName, edit)
    markMutation(state, owner)
    setComponentPropertyKey(owner, key, editedName, state)
  }
}

function slotSettingsChanged(
  current: SlotSettings | undefined,
  desired: NonNullable<CanvasFigmaSlotProperty['settings']>
): boolean {
  return Object.entries(desired).some(
    ([field, value]) => current?.[field as keyof SlotSettings] !== value
  )
}

function applySlotProperty(node: SlotNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const desired = spec.figma?.slot?.property
  if (!desired) return
  const owner = componentPropertyOwner(node)
  if (!owner) specError(`Slot "${spec.key}" has no authored component owner.`)
  const propertyName = slotPropertyName(owner, spec, state)
  if (!propertyName) specError(`Slot property for "${spec.key}" could not be resolved.`)
  const current = owner.componentPropertyDefinitions[propertyName]
  if (!current || current.type !== 'SLOT') {
    specError(`Component property "${propertyName}" for "${spec.key}" is not a slot.`)
  }
  const edit: {
    name?: string
    preferredValues?: InstanceSwapPreferredValue[]
    description?: string
    slotSettings?: SlotSettings
  } = {}
  if (componentPropertyDisplayName(propertyName) !== desired.name) {
    edit.name = desired.name
  }
  if (
    desired.preferredValues !== undefined &&
    !nativeValueEqual(current.preferredValues ?? [], desired.preferredValues)
  ) {
    edit.preferredValues = desired.preferredValues
  }
  if (desired.description !== undefined && current.description !== desired.description) {
    edit.description = desired.description
  }
  if (desired.settings && slotSettingsChanged(current.slotSettings, desired.settings)) {
    edit.slotSettings = { ...current.slotSettings, ...desired.settings }
  }
  if (!Object.keys(edit).length) return
  const editedName = owner.editComponentProperty(propertyName, edit)
  markMutation(state, owner)
  setComponentPropertyKey(owner, spec.key, editedName, state)
}

function applyComponentPropertyReferences(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const desired = spec.figma?.componentPropertyReferences
  if (!desired) return
  const owner = componentPropertyOwner(node)
  if (!owner) {
    specError(`Component property references on "${spec.key}" require a component sublayer.`)
  }
  const next = { ...(node.componentPropertyReferences ?? {}) }
  for (const [field, key] of Object.entries(desired) as Array<
    [ComponentPropertyReferenceField, string | null]
  >) {
    if (key === null) {
      delete next[field]
      continue
    }
    const propertyName = componentPropertyName(owner, key, state)
    if (!propertyName || !owner.componentPropertyDefinitions[propertyName]) {
      specError(`Component property reference "${key}" on "${spec.key}" could not be resolved.`)
    }
    next[field] = propertyName
  }
  const references = Object.keys(next).length ? next : null
  if (nativeValueEqual(node.componentPropertyReferences, references)) return
  node.componentPropertyReferences = references
  markMutation(state, node)
}

function applyComponentMetadata(
  node: ComponentNode | ComponentSetNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const metadata = spec.figma!.component!
  setValue(
    node,
    node.descriptionMarkdown,
    metadata.descriptionMarkdown,
    (value) => (node.descriptionMarkdown = value),
    state
  )
  if (metadata.documentationLink === undefined) return
  const links = metadata.documentationLink === null ? [] : [{ uri: metadata.documentationLink }]
  if (nativeValueEqual(node.documentationLinks, links)) return
  node.documentationLinks = links
  markMutation(state, node)
}

function isOwnedSvgChild(node: SceneNode): node is FrameNode {
  return (
    node.type === 'FRAME' &&
    node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_CHILD_NAME) === 'true'
  )
}

function countSceneNodes(node: SceneNode): number {
  return (
    1 +
    ('children' in node
      ? node.children.reduce((count, child) => count + countSceneNodes(child), 0)
      : 0)
  )
}

function placeSvgChild(child: FrameNode, wrapper: FrameNode, state: ApplyState): void {
  if (
    ![child.width, child.height, wrapper.width, wrapper.height].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_IMPORT_FAILED,
      'SVG import produced invalid geometry.'
    )
  }
  const scale = Math.min(wrapper.width / child.width, wrapper.height / child.height)
  let changed = false
  if (Math.abs(scale - 1) > 0.0001) {
    child.rescale(scale)
    changed = true
  }
  const x = (wrapper.width - child.width) / 2
  const y = (wrapper.height - child.height) / 2
  if (Math.abs(child.x - x) > 0.001 || Math.abs(child.y - y) > 0.001) {
    child.x = x
    child.y = y
    changed = true
  }
  if (changed) state.mutations.count += 1
}

function setSvgMetadata(
  wrapper: FrameNode,
  digest: string,
  color: string | undefined,
  state: ApplyState
): void {
  let changed = false
  for (const [name, value] of [
    [CANVAS_SVG_DIGEST_NAME, digest],
    [CANVAS_SVG_COLOR_NAME, color?.toUpperCase() ?? ''],
    [CANVAS_SVG_POLICY_NAME, SVG_POLICY_VERSION]
  ] as const) {
    if (wrapper.getSharedPluginData(CANVAS_KEY_NAMESPACE, name) === value) continue
    wrapper.setSharedPluginData(CANVAS_KEY_NAMESPACE, name, value)
    changed = true
  }
  if (changed) markMutation(state, wrapper)
}

async function applySvg(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const placement = spec.figma?.svg
  if (!placement) return
  if (node.type !== 'FRAME') {
    specError(`SVG binding "${spec.key}" requires a frame wrapper.`)
  }
  const asset = resolvedSvgAsset(state.assets, placement.assetKey, placement.color)
  if (!asset) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
      `SVG asset "${placement.assetKey}" was not resolved.`
    )
  }
  const owned = node.children.filter(isOwnedSvgChild)
  const unexpected = node.children.filter((child) => !isOwnedSvgChild(child))
  if (owned.length > 1 || unexpected.length) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_WRAPPER_DIRTY,
      `SVG wrapper "${spec.key}" contains unexpected children.`
    )
  }
  if (
    owned.length === 1 &&
    node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_DIGEST_NAME) === asset.digest
  ) {
    placeSvgChild(owned[0]!, node, state)
    setSvgMetadata(node, asset.digest, placement.color, state)
    return
  }

  let imported: FrameNode
  try {
    imported = figma.createNodeFromSvg(asset.svg)
  } catch {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_IMPORT_FAILED,
      `SVG asset "${placement.assetKey}" could not be imported by Figma.`
    )
  }
  if (
    !Number.isFinite(imported.width) ||
    !Number.isFinite(imported.height) ||
    imported.width <= 0 ||
    imported.height <= 0 ||
    countSceneNodes(imported) > 500
  ) {
    imported.remove()
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_IMPORT_FAILED,
      `SVG asset "${placement.assetKey}" produced invalid or excessive Figma layers.`
    )
  }
  imported.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_CHILD_NAME, 'true')
  node.appendChild(imported)
  state.mutations.count += 1
  placeSvgChild(imported, node, state)
  for (const child of owned) {
    child.remove()
    state.mutations.count += 1
  }
  setSvgMetadata(node, asset.digest, placement.color, state)
}

async function applyNodeProperties(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: CanvasParentNode
): Promise<void> {
  if (node.type === 'INSTANCE') await applyComponent(node, spec, state)
  applyVariableModes(node, spec.variableModes, state)
  await unlinkStyles(node, spec.styles, state)
  clearVariables(node, spec.variables, state)
  setValue(
    node,
    node.name,
    node.type === 'TEXT' && spec.figma?.text?.autoRename ? undefined : spec.displayName,
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
  applySize(node, spec, state)
  await applySvg(node, spec, state)
  if (parent) applyPosition(node, spec, parent, state)
  applyRelativeTransform(node, spec, parent, state)
  applyAppearance(node, spec, state)
  await applyStyles(node, spec.styles, state)
  applyLayoutAids(node, spec, state)
  if (!hasCanvasKeyPaints(spec)) {
    applyPaintStacks(node, spec, state)
  }
  applyEffects(node, spec, state)
  if (node.type === 'TEXT') await applyText(node, spec, state)
  await applyVariables(node, spec.variables, state)
  if (node.type === 'TEXT' && !hasDeferredTextRanges(spec)) {
    await applyTextRanges(node, spec.figma?.text?.ranges, state)
  }
  applySharedLayerState(node, spec, state)
  applyComponentPropertyReferences(node, spec, state)
  // Text and layout setters can leave a derived sizing mode or its geometry stale.
  if (node.type === 'TEXT') applySizingModes(node, spec, state)
  stabilizeCrossAxisFill(node, spec, parent, state)
}

function collectSvgColors(root: CanvasNodeSpec): Map<string, Set<string | undefined>> {
  const colors = new Map<string, Set<string | undefined>>()
  const visit = (spec: CanvasNodeSpec): void => {
    const svg = spec.figma?.svg
    if (svg) {
      const values = colors.get(svg.assetKey) ?? new Set<string | undefined>()
      values.add(svg.color)
      colors.set(svg.assetKey, values)
    }
    for (const child of spec.children ?? []) visit(child)
  }
  visit(root)
  return colors
}

async function applyCanvasKeyReferences(
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: CanvasParentNode
): Promise<void> {
  const node = figma.getNodeById(state.nodeIdsByKey[spec.key]!)
  if (!isSupportedSceneNode(node)) {
    specError(`Desired node "${spec.key}" was not reconciled.`)
  }
  if (hasCanvasKeyVectorPattern(spec)) {
    await applyShape(node, spec, state, true)
    applySize(node, spec, state)
    if (parent) applyPosition(node, spec, parent, state)
    applyRelativeTransform(node, spec, parent, state)
  }
  if (hasCanvasKeyPaints(spec)) {
    applyPaintStacks(node, spec, state)
  }
  if (node.type === 'TEXT') {
    if (isCanvasKeyHyperlink(spec.figma?.text?.hyperlink)) {
      applyTextHyperlink(node, spec.figma.text.hyperlink, state)
    }
    if (hasDeferredTextRanges(spec)) {
      await applyTextRanges(node, spec.figma?.text?.ranges, state)
    }
  }
  stabilizeCrossAxisFill(node, spec, parent, state)
  for (const child of spec.children ?? []) {
    await applyCanvasKeyReferences(child, state, node as CanvasParentNode)
  }
}

function rotationsMatch(current: number, desired: number): boolean {
  const delta = ((((current - desired + 180) % 360) + 360) % 360) - 180
  return Math.abs(delta) <= 0.001
}

function applySharedLayerState(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  setValue(
    node,
    node.visible,
    preservesComponentPropertyReference(node, spec, 'visible') ||
      spec.variables?.visible ||
      currentBoundVariableId(node, 'visible')
      ? undefined
      : spec.visible,
    (value) => (node.visible = value),
    state
  )
  if ('blendMode' in node) {
    setValue(node, node.blendMode, spec.blendMode, (value) => (node.blendMode = value), state)
  }
  if (
    'rotation' in node &&
    spec.rotation !== undefined &&
    !rotationsMatch(node.rotation, spec.rotation)
  ) {
    node.rotation = spec.rotation
    markMutation(state, node)
  }
  const aspectRatioLocked = spec.figma?.aspectRatioLocked
  if (aspectRatioLocked !== undefined) {
    if (!('targetAspectRatio' in node)) {
      specError(`Aspect-ratio locking is not supported on ${node.type} node "${spec.key}".`)
    }
    if ((node.targetAspectRatio !== null) !== aspectRatioLocked) {
      if (aspectRatioLocked) node.lockAspectRatio()
      else node.unlockAspectRatio()
      markMutation(state, node)
    }
  }
  setValue(node, node.locked, spec.figma?.locked, (value) => (node.locked = value), state)
}

function applyMask(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const mask = spec.figma?.mask
  if (mask === undefined) return
  if (!('isMask' in node)) {
    specError(`Masks are not supported on ${node.type} node "${spec.key}".`)
  }
  if (mask !== null) {
    setValue(node, node.maskType, mask, (value) => (node.maskType = value), state)
  }
  setValue(node, node.isMask, mask !== null, (value) => (node.isMask = value), state)
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
    const valueMatches =
      track.type === 'HUG' ||
      (target.value ?? (target.type === 'FLEX' ? 1 : undefined)) === track.value
    if (target.type === track.type && valueMatches) continue
    target.type = track.type
    if (track.type !== 'HUG') target.value = track.value
    markMutation(state, node)
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

type ReconciledGridChild = {
  node: GridChildNode
  spec: CanvasNodeSpec
}

type ReconciledChild = {
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
  state: ApplyState
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
  if (moving.length) {
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
      stagingStart + moving.length,
      (value) => (node.gridRowCount = value),
      state
    )
    for (const [index, { node: child }] of moving.entries()) {
      setGridChildSpans(child, 1, 1, state)
      setGridChildPosition(child, stagingStart + index, 0, state)
    }
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
  if (!autoRows || moving.length) {
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
  if (autoRows && moving.length) {
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

function finalizeGrid(
  node: CanvasFrameContainerNode,
  spec: CanvasNodeSpec,
  children: ReconciledChild[],
  state: ApplyState
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
    finalizeManualGrid(node, layout, gridChildren, state)
  } else {
    finalizeFlowGrid(node, layout, gridChildren, state)
  }
  for (const child of gridChildren) {
    applyGridChildAlignment(child.node, child.spec, state)
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
  const stagingParent = parent ? containingPage(parent) : figma.currentPage
  if (spec.type === 'COMPONENT_SET') {
    const children = spec.children!
    const variants = children.map((child) => {
      const variant = figma.createComponent()
      recordCreatedNode(variant, state, false)
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
  const afterPrevious = previousIndex + 1
  return currentIndex >= 0 && currentIndex < afterPrevious ? afterPrevious - 1 : afterPrevious
}

async function reconcileNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: CanvasParentNode,
  index = 0,
  forcedNode?: SupportedCanvasNode
): Promise<SupportedCanvasNode> {
  const existing = resolveExistingNode(spec, state, forcedNode)
  if (!existing && isWrappedSpec(spec)) {
    return reconcileNewWrappedContainer(spec, state, parent, index)
  }
  const node =
    existing ??
    (spec.type === 'SLOT' ? createSlotNode(spec, parent, state) : await createNode(spec, state))

  if (parent) moveIntoParent(node, parent, index, state)
  setNodeKey(state, node, spec.key)
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

function placementBounds(node: SceneNode): Rect | null {
  const bounds = ('absoluteRenderBounds' in node ? node.absoluteRenderBounds : null) ??
    ('absoluteBoundingBox' in node ? node.absoluteBoundingBox : null) ?? {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    }
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width >= 0 &&
    bounds.height >= 0
    ? bounds
    : null
}

function placementOverlap(candidate: Rect, obstacle: Rect): boolean {
  return (
    candidate.x < obstacle.x + obstacle.width + ROOT_PLACEMENT_GAP &&
    candidate.x + candidate.width + ROOT_PLACEMENT_GAP > obstacle.x &&
    candidate.y < obstacle.y + obstacle.height + ROOT_PLACEMENT_GAP &&
    candidate.y + candidate.height + ROOT_PLACEMENT_GAP > obstacle.y
  )
}

function placeCreatedRoot(node: SupportedCanvasNode, page: PageNode, state: ApplyState): void {
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

  const x = node.x + candidate.x - bounds.x
  const y = node.y + candidate.y - bounds.y
  if (node.x === x && node.y === y) return
  node.x = x
  node.y = y
  markMutation(state, node)
}

function createApplyState(
  target: SupportedCanvasNode | null,
  desiredKeys: Set<string>,
  assets: ResolvedCanvasAssets = new Map()
): ApplyState {
  return {
    assets,
    claimedNodeIds: new Set(),
    componentCache: new Map(),
    componentPropertyKeys: new Map(),
    createdNodeIds: new Set(),
    desiredKeys,
    fontLoads: new Map(),
    imageHashes: new Map(),
    imageAssetKeys: new Set(),
    imageUrls: new Set(),
    keyedNodes: target ? collectKeyedNodes(target) : new Map(),
    mutations: { count: 0 },
    nodeIdsByKey: Object.create(null) as Record<string, string>,
    removalNodeIds: new Set(),
    referencedNodeIds: new Set(),
    scope: target,
    shaderCache: new Map(),
    styles: createStyleState(),
    updatedNodeIds: new Set(),
    variables: createVariableState(),
    videoHashes: new Map(),
    videoUrls: new Set()
  }
}

function passedVerification(nodesChecked = 0, referencesChecked = 0) {
  return {
    status: 'passed' as const,
    nodesChecked,
    referencesChecked,
    warnings: []
  }
}

function removedRootResult(
  rootNodeId: string,
  removedNodeIds: string[] = [],
  state?: ApplyState
): ApplyCanvasResult {
  return {
    rootNodeId,
    rootRemoved: true,
    nodeIdsByKey: state?.nodeIdsByKey ?? {},
    createdNodeIds: [],
    updatedNodeIds: [],
    removedNodeIds,
    mutationCount: state?.mutations.count ?? 0,
    verification: passedVerification()
  }
}

function appliedVariableId(
  node: SupportedCanvasNode,
  field: keyof CanvasVariableBindings
): string | undefined {
  if (field === 'fill' || field === 'stroke') {
    const paintField = field === 'fill' ? 'fills' : 'strokes'
    return node.boundVariables?.[paintField]?.[0]?.id
  }
  return currentBoundVariableId(node, DIRECT_VARIABLE_FIELDS[field])
}

function verifySizingGeometry(
  spec: CanvasNodeSpec,
  node: SupportedCanvasNode,
  parent?: SupportedCanvasNode
): void {
  if (!isIntrinsicNode(node) && 'layoutSizingHorizontal' in node) {
    if (
      node.layoutSizingHorizontal !== spec.size.horizontal ||
      node.layoutSizingVertical !== spec.size.vertical ||
      (spec.grow !== undefined && node.layoutGrow !== (spec.grow ? 1 : 0))
    ) {
      specError(`Verification failed for "${spec.key}": sizing modes do not match.`)
    }
  }

  const fixedWidth =
    spec.size.horizontal === 'FIXED' &&
    spec.size.width !== undefined &&
    !spec.variables?.width &&
    !currentBoundVariableId(node, 'width')
      ? spec.size.width
      : null
  const fixedHeight =
    spec.size.vertical === 'FIXED' &&
    spec.size.height !== undefined &&
    !spec.variables?.height &&
    !currentBoundVariableId(node, 'height')
      ? spec.size.height
      : null
  if (
    (fixedWidth !== null && Math.abs(node.width - fixedWidth) > GEOMETRY_TOLERANCE) ||
    (fixedHeight !== null && Math.abs(node.height - fixedHeight) > GEOMETRY_TOLERANCE)
  ) {
    specError(`Verification failed for "${spec.key}": fixed geometry does not match.`)
  }

  const fill = expectedCrossAxisFill(node, spec, parent)
  if (fill) {
    const actual = fill.axis === 'horizontal' ? node.width : node.height
    if (Math.abs(actual - fill.size) > GEOMETRY_TOLERANCE) {
      specError(`Verification failed for "${spec.key}": fill geometry does not match.`)
    }
  }

  if (node.type !== 'TEXT') return
  if (node.textAutoResize !== spec.text?.autoResize) {
    specError(`Verification failed for "${spec.key}": text auto-resize does not match.`)
  }
  if (
    node.characters.length > 0 &&
    (node.textAutoResize === 'HEIGHT' || node.textAutoResize === 'WIDTH_AND_HEIGHT') &&
    node.height <= GEOMETRY_TOLERANCE
  ) {
    specError(`Verification failed for "${spec.key}": auto-resizing text has no height.`)
  }
  if (
    node.characters.length > 0 &&
    node.textAutoResize === 'WIDTH_AND_HEIGHT' &&
    node.width <= GEOMETRY_TOLERANCE
  ) {
    specError(`Verification failed for "${spec.key}": auto-resizing text has no width.`)
  }
}

async function verifyAppliedNode(
  spec: CanvasNodeSpec,
  node: SupportedCanvasNode,
  state: ApplyState,
  parent?: SupportedCanvasNode
): Promise<{ nodes: number; references: number }> {
  if (node.type !== spec.type) {
    specError(`Verification failed for "${spec.key}": expected ${spec.type}, found ${node.type}.`)
  }
  if (state.nodeIdsByKey[spec.key] !== node.id) {
    specError(`Verification failed for "${spec.key}": stable identity did not resolve to its node.`)
  }
  if (node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_KEY_NAME) !== spec.key) {
    specError(`Verification failed for "${spec.key}": native stable identity is missing.`)
  }
  if (parent && node.parent?.id !== parent.id) {
    specError(`Verification failed for "${spec.key}": parent does not match the desired tree.`)
  }
  const geometry = [
    node.x,
    node.y,
    node.width,
    node.height,
    ...('rotation' in node ? [node.rotation] : [])
  ]
  if (!geometry.every(Number.isFinite)) {
    specError(`Verification failed for "${spec.key}": geometry is not finite.`)
  }
  verifySizingGeometry(spec, node, parent)

  let references = 0
  if (spec.component) {
    const expected = resolvedComponent(spec.component, state)
    const actual = node.type === 'INSTANCE' ? await node.getMainComponentAsync() : null
    references += 1
    if (actual?.id !== expected.id) {
      specError(`Verification failed for "${spec.key}": component link does not match.`)
    }
  }
  for (const [field, reference] of Object.entries(spec.variables ?? {}) as Array<
    [keyof CanvasVariableBindings, CanvasVariableBindings[keyof CanvasVariableBindings]]
  >) {
    const expected = reference ? resolvedVariable(reference, state.variables).id : undefined
    references += 1
    if (appliedVariableId(node, field) !== expected) {
      specError(`Verification failed for "${spec.key}": variable link "${field}" does not match.`)
    }
  }
  for (const field of STYLE_FIELDS) {
    const reference = spec.styles?.[field]
    if (reference === undefined) continue
    const expected = reference ? (await resolveStyle(reference, state.styles)).id : ''
    references += 1
    if (styleTarget(node, field).current !== expected) {
      specError(`Verification failed for "${spec.key}": style link "${field}" does not match.`)
    }
  }
  for (const [collectionReference, modeReference] of Object.entries(spec.variableModes ?? {})) {
    const collection = resolvedCollection(collectionReference, state.variables)
    const expected =
      modeReference === null
        ? undefined
        : resolvedModeId(collection, modeReference, state.variables)
    references += 1
    if (node.explicitVariableModes[collection.id] !== expected) {
      specError(`Verification failed for "${spec.key}": variable mode does not match.`)
    }
  }
  if (spec.figma?.mask !== undefined) {
    const mask = spec.figma.mask
    if (
      !('isMask' in node) ||
      node.isMask !== (mask !== null) ||
      (mask !== null && (!('maskType' in node) || node.maskType !== mask))
    ) {
      specError(`Verification failed for "${spec.key}": mask state does not match.`)
    }
  }
  if (spec.figma?.svg) {
    if (node.type !== 'FRAME') {
      specError(`Verification failed for "${spec.key}": SVG wrapper is not a frame.`)
    }
    const asset = resolvedSvgAsset(state.assets, spec.figma.svg.assetKey, spec.figma.svg.color)
    const owned = node.children.filter(isOwnedSvgChild)
    const unexpected = node.children.filter((child) => !isOwnedSvgChild(child))
    if (
      !asset ||
      owned.length !== 1 ||
      unexpected.length ||
      node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_DIGEST_NAME) !== asset.digest ||
      node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_POLICY_NAME) !==
        SVG_POLICY_VERSION ||
      node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_COLOR_NAME) !==
        (spec.figma.svg.color?.toUpperCase() ?? '')
    ) {
      specError(`Verification failed for "${spec.key}": SVG import state does not match.`)
    }
    const child = owned[0]!
    if (
      child.x < -0.01 ||
      child.y < -0.01 ||
      child.x + child.width > node.width + 0.01 ||
      child.y + child.height > node.height + 0.01
    ) {
      specError(`Verification failed for "${spec.key}": SVG is outside its wrapper.`)
    }
    references += 1
  }

  const childSpecs = spec.children ?? []
  const childNodes = childSpecs.map((child) => {
    const candidate = figma.getNodeById(state.nodeIdsByKey[child.key]!)
    if (!isSupportedSceneNode(candidate)) {
      specError(`Verification failed for "${child.key}": desired child is missing.`)
    }
    return candidate
  })
  if (childNodes.length) {
    if (!('children' in node)) {
      specError(`Verification failed for "${spec.key}": desired children have no container.`)
    }
    let previous = -1
    for (const child of childNodes) {
      const index = node.children.findIndex((candidate) => candidate.id === child.id)
      if (index <= previous) {
        specError(`Verification failed for "${spec.key}": desired child order does not match.`)
      }
      previous = index
    }
  }
  let nodes = 1
  for (const [index, childSpec] of childSpecs.entries()) {
    const verified = await verifyAppliedNode(childSpec, childNodes[index]!, state, node)
    nodes += verified.nodes
    references += verified.references
  }
  return { nodes, references }
}

async function withUndoBoundary<T>(
  apply: () => Promise<T>,
  mutations: MutationCounter
): Promise<T> {
  try {
    figma.commitUndo()
    const result = await apply()
    figma.commitUndo()
    return result
  } catch (error) {
    const readOnly = canvasReadOnlyError(error)
    if (mutations.count > 0) {
      try {
        figma.triggerUndo()
      } catch {
        if (readOnly) throw readOnly
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          'Canvas apply failed and automatic rollback was not available. Use Figma Undo.'
        )
      }
    }
    if (readOnly) throw readOnly
    throw error
  }
}

async function removeUpdateRoot(targetNodeId: string): Promise<ApplyCanvasResult> {
  const candidate = figma.getNodeById(targetNodeId)
  if (!candidate) return removedRootResult(targetNodeId)
  if (!isSupportedSceneNode(candidate)) {
    scopeError('The requested removal target is not a supported scene node.')
  }

  const state = createApplyState(candidate, new Set())
  validateRemovalAncestors(candidate)
  validateRemovalOwnership(candidate, state)
  state.removalNodeIds.add(candidate.id)

  return withUndoBoundary(async () => {
    const removedNodeIds = await applyRemovals([candidate], state)
    if (figma.getNodeById(candidate.id)) {
      specError(`Verification failed: root "${candidate.id}" is still present.`)
    }
    return removedRootResult(candidate.id, removedNodeIds, state)
  }, state.mutations)
}

export async function reconcileCanvas(input: ParsedCanvasInput): Promise<ApplyCanvasResult> {
  if (input.root === null) return removeUpdateRoot(input.targetNodeId)

  const rootSpec = input.root
  let target: SupportedCanvasNode | null = null
  if (input.mode === 'update') {
    const candidate = figma.getNodeById(input.targetNodeId!)
    if (!isSupportedSceneNode(candidate)) {
      scopeError('The requested update target does not exist or is not a supported scene node.')
    }
    target = candidate
  }
  if (target && target.type !== rootSpec.type) {
    specError(
      `The update root expects ${rootSpec.type}, but target "${target.id}" is ${target.type}.`
    )
  }
  const assets = await resolveCanvasAssets(input.assets, collectSvgColors(rootSpec))
  const state = createApplyState(target, collectDesiredKeys(rootSpec), assets)
  const removalNodes = resolveRemovalNodes(input, state)

  return withUndoBoundary(async () => {
    const page = await resolveResultPage(input.page, target, state)
    await validateRemovalComponents(outermostNodes(removalNodes))
    preflightMasks(rootSpec, state, target)
    preflightContainers(rootSpec, state, target)
    await reconcileVariableCollections(input.variableCollections, state.variables, state.mutations)
    await prepareStyleResources(input.styles, state.styles, state.mutations)
    await preflightStyleResources(state)
    await preflightVariableModes(input.page?.variableModes, state)
    await preflightResources(rootSpec, state, target ?? undefined)
    await resolveImageUrls(state)
    resolveImageAssets(state)
    await resolveVideoUrls(state)
    applyStyleResources(state)
    if (input.page) applyPage(page, input.page, state)
    const destination =
      input.mode === 'create' && page.id !== figma.currentPage.id ? page : undefined
    const root = await reconcileNode(
      rootSpec,
      state,
      destination,
      destination?.children.length ?? 0,
      target ?? undefined
    )
    await applyCanvasKeyReferences(rootSpec, state)
    if (input.mode === 'create' && rootSpec.figma?.relativeTransform === undefined) {
      placeCreatedRoot(root, page, state)
    }
    applyMask(root, rootSpec, state)
    const removedNodeIds = await applyRemovals(removalNodes, state)
    await removeStyleResources(state.styles, state.mutations)
    await removeVariableResources(state.variables, state.mutations)
    const verified = await verifyAppliedNode(rootSpec, root, state)
    return {
      rootNodeId: root.id,
      nodeIdsByKey: state.nodeIdsByKey,
      createdNodeIds: [...state.createdNodeIds],
      updatedNodeIds: [...state.updatedNodeIds],
      removedNodeIds,
      mutationCount: state.mutations.count,
      verification: passedVerification(verified.nodes, verified.references)
    }
  }, state.mutations)
}
