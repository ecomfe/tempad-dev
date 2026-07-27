import type {
  ApplyCanvasParameters,
  ApplyCanvasParametersInput,
  ApplyCanvasResult,
  CanvasDesignReference,
  CanvasNodeSpec,
  CanvasVariableBindings
} from '@tempad-dev/shared'

import { ApplyCanvasParametersSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { canvasWritesOn } from '@/ui/state'

import { createCodedError } from '../errors'

const CANVAS_KEY_NAMESPACE = 'tempad_dev'
const CANVAS_KEY_NAME = 'canvas-key'
const SUPPORTED_NODE_TYPES = new Set<CanvasNodeSpec['type']>([
  'ELLIPSE',
  'FRAME',
  'INSTANCE',
  'LINE',
  'RECTANGLE',
  'TEXT'
])

type SupportedCanvasNode = Extract<SceneNode, { type: CanvasNodeSpec['type'] }>

type ApplyState = {
  claimedNodeIds: Set<string>
  componentCache: Map<string, ComponentNode>
  createdNodeIds: Set<string>
  keyedNodes: Map<string, SupportedCanvasNode>
  mutationCount: number
  nodeIdsByKey: Record<string, string>
  scope: SupportedCanvasNode | null
  updatedNodeIds: Set<string>
  variableCache: Map<string, Variable>
}

let applyInProgress = false

function specError(message: string): never {
  throw createCodedError(TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC, message)
}

function scopeError(message: string): never {
  throw createCodedError(TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE, message)
}

function isSupportedSceneNode(node: BaseNode | null): node is SupportedCanvasNode {
  return !!node && SUPPORTED_NODE_TYPES.has(node.type as CanvasNodeSpec['type'])
}

function isWithinScope(node: BaseNode, scope: BaseNode): boolean {
  let current: BaseNode | null = node
  while (current) {
    if (current.id === scope.id) return true
    current = current.parent
  }
  return false
}

function collectKeyedNodes(scope: SupportedCanvasNode): Map<string, SupportedCanvasNode> {
  const keyed = new Map<string, SupportedCanvasNode>()
  const stack: BaseNode[] = [scope]
  while (stack.length) {
    const node = stack.pop()!
    if (isSupportedSceneNode(node)) {
      const key = node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_KEY_NAME)
      if (key) {
        if (keyed.has(key)) {
          scopeError(`Canvas key "${key}" is duplicated inside the update scope.`)
        }
        keyed.set(key, node)
      }
    }
    if ('children' in node) {
      stack.push(...node.children)
    }
  }
  return keyed
}

function markMutation(state: ApplyState, node: SupportedCanvasNode): void {
  state.mutationCount += 1
  if (!state.createdNodeIds.has(node.id)) {
    state.updatedNodeIds.add(node.id)
  }
}

function setNodeKey(state: ApplyState, node: SupportedCanvasNode, key: string): void {
  const currentKey = node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_KEY_NAME)
  if (currentKey === key) return
  if (currentKey) {
    specError(`Node "${node.id}" is already owned by canvas key "${currentKey}".`)
  }
  node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_KEY_NAME, key)
  markMutation(state, node)
}

function resolveExistingNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  forcedNode?: SupportedCanvasNode
): SupportedCanvasNode | null {
  let node = forcedNode ?? null
  if (!node && spec.nodeId) {
    const candidate = figma.getNodeById(spec.nodeId)
    if (!isSupportedSceneNode(candidate)) {
      scopeError(`Node "${spec.nodeId}" does not exist or is not supported by apply_canvas.`)
    }
    node = candidate
  } else if (!node) {
    node = state.keyedNodes.get(spec.key) ?? null
  }

  if (!node) return null
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

function referenceCacheKey(reference: CanvasDesignReference): string {
  return reference.id !== undefined ? `id:${reference.id}` : `key:${reference.key}`
}

async function resolveComponent(reference: CanvasDesignReference, state: ApplyState) {
  const cacheKey = referenceCacheKey(reference)
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

async function resolveVariable(
  reference: CanvasDesignReference,
  state: ApplyState
): Promise<Variable> {
  const cacheKey = referenceCacheKey(reference)
  const cached = state.variableCache.get(cacheKey)
  if (cached) return cached

  const variable =
    reference.id !== undefined
      ? await figma.variables.getVariableByIdAsync(reference.id)
      : await figma.variables.importVariableByKeyAsync(reference.key)
  if (!variable) {
    specError('The requested variable could not be resolved.')
  }
  state.variableCache.set(cacheKey, variable)
  return variable
}

async function createNode(spec: CanvasNodeSpec, state: ApplyState): Promise<SupportedCanvasNode> {
  let node: SupportedCanvasNode
  switch (spec.type) {
    case 'ELLIPSE':
      node = figma.createEllipse()
      break
    case 'FRAME':
      node = figma.createFrame()
      break
    case 'INSTANCE': {
      const component = await resolveComponent(spec.component!, state)
      node = component.createInstance()
      break
    }
    case 'LINE':
      node = figma.createLine()
      break
    case 'RECTANGLE':
      node = figma.createRectangle()
      break
    case 'TEXT':
      node = figma.createText()
      break
  }
  state.mutationCount += 1
  state.createdNodeIds.add(node.id)
  state.claimedNodeIds.add(node.id)
  return node
}

function moveIntoParent(
  node: SupportedCanvasNode,
  parent: FrameNode,
  index: number,
  state: ApplyState
): void {
  if (node.parent?.id === parent.id && parent.children.indexOf(node) === index) return
  parent.insertChild(index, node)
  markMutation(state, node)
}

function setValue<T>(
  node: SupportedCanvasNode,
  current: T,
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

function applyLayout(node: FrameNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const layout = spec.layout
  if (!layout) return
  const bindings = spec.variables

  setValue(node, node.layoutMode, layout.mode, (value) => (node.layoutMode = value), state)
  const hasAutoLayoutProperty =
    layout.gap !== undefined ||
    layout.padding !== undefined ||
    layout.primaryAlign !== undefined ||
    layout.counterAlign !== undefined
  if (hasAutoLayoutProperty && node.layoutMode === 'NONE') {
    specError(
      `FRAME "${spec.key}" must use HORIZONTAL or VERTICAL layout before setting layout details.`
    )
  }
  setValue(
    node,
    node.itemSpacing,
    bindings?.gap ? undefined : layout.gap,
    (value) => (node.itemSpacing = value),
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

  const padding = layout.padding
  if (padding === undefined) return
  for (const [side, field] of PADDING_FIELDS) {
    const desired = typeof padding === 'number' ? padding : padding[side]
    setValue(
      node,
      node[field],
      bindings?.[field] ? undefined : desired,
      (value) => (node[field] = value),
      state
    )
  }
}

function applyPosition(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const position = spec.position
  if (!position) return
  setValue(node, node.x, position.x, (value) => (node.x = value), state)
  setValue(node, node.y, position.y, (value) => (node.y = value), state)
}

function applySize(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const size = spec.size
  if (!size) return
  const width = !spec.variables?.width && size.width !== undefined ? size.width : node.width
  const height =
    node.type !== 'LINE' && !spec.variables?.height && size.height !== undefined
      ? size.height
      : node.height
  if (Math.abs(node.width - width) > 0.01 || Math.abs(node.height - height) > 0.01) {
    node.resize(width, height)
    markMutation(state, node)
  }
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
}

function paintsEqual(current: readonly Paint[], desired: readonly SolidPaint[]): boolean {
  return (
    current.length === desired.length &&
    current.every((paint, index) => {
      const expected = desired[index]!
      return (
        paint.type === 'SOLID' &&
        paint.color.r === expected.color.r &&
        paint.color.g === expected.color.g &&
        paint.color.b === expected.color.b &&
        (paint.opacity ?? 1) === (expected.opacity ?? 1) &&
        (paint.visible ?? true) === (expected.visible ?? true) &&
        (paint.blendMode ?? 'NORMAL') === (expected.blendMode ?? 'NORMAL')
      )
    })
  )
}

function applyPaint(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  field: 'fill' | 'stroke',
  state: ApplyState
): void {
  const color = spec.appearance?.[field]
  if (color === undefined) return

  const property = field === 'fill' ? 'fills' : 'strokes'
  const paints = node[property]
  const desired = color === null ? [] : [figma.util.solidPaint(color)]
  const hasBinding = !!spec.variables?.[field]
  if (hasBinding) {
    if (paints !== figma.mixed && paints.length === 1 && paints[0]?.type === 'SOLID') return
    if (color === null) {
      const label = field === 'fill' ? 'Fill' : 'Stroke'
      specError(`${label} variable binding on "${spec.key}" requires a solid fallback paint.`)
    }
  } else if (paints !== figma.mixed && paintsEqual(paints, desired)) {
    return
  }

  node[property] = desired
  markMutation(state, node)
}

function applyAppearance(node: SupportedCanvasNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const appearance = spec.appearance
  if (!appearance) return

  applyPaint(node, spec, 'fill', state)
  applyPaint(node, spec, 'stroke', state)
  if ('strokeWeight' in node) {
    setValue(
      node,
      node.strokeWeight,
      appearance.strokeWeight,
      (value) => (node.strokeWeight = value),
      state
    )
  }
  if ('cornerRadius' in node) {
    setValue(
      node,
      node.cornerRadius,
      spec.variables?.cornerRadius ? undefined : appearance.cornerRadius,
      (value) => (node.cornerRadius = value),
      state
    )
  }
  setValue(
    node,
    node.opacity,
    spec.variables?.opacity ? undefined : appearance.opacity,
    (value) => (node.opacity = value),
    state
  )
}

async function loadTextFonts(node: TextNode, spec: CanvasNodeSpec): Promise<FontName | null> {
  const text = spec.text
  const currentFont = node.fontName
  const fontFamily = spec.variables?.fontFamily ? undefined : text?.fontFamily
  const fontStyle = spec.variables?.fontStyle ? undefined : text?.fontStyle
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
  const uniqueFonts = [
    ...new Map(fonts.map((font) => [`${font.family}\0${font.style}`, font])).values()
  ]
  await Promise.all(uniqueFonts.map((font) => figma.loadFontAsync(font)))
  return desiredFont
}

async function applyText(node: TextNode, spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  const text = spec.text
  if (!text) return
  const desiredFont = await loadTextFonts(node, spec)
  if (
    desiredFont &&
    (node.fontName === figma.mixed ||
      node.fontName.family !== desiredFont.family ||
      node.fontName.style !== desiredFont.style)
  ) {
    node.fontName = desiredFont
    markMutation(state, node)
  }
  setValue(node, node.characters, text.characters, (value) => (node.characters = value), state)
  setValue(
    node,
    node.fontSize,
    spec.variables?.fontSize ? undefined : text.fontSize,
    (value) => (node.fontSize = value),
    state
  )
  setTextPixelValue(
    node,
    'lineHeight',
    spec.variables?.lineHeight ? undefined : text.lineHeight,
    state
  )
  setTextPixelValue(
    node,
    'letterSpacing',
    spec.variables?.letterSpacing ? undefined : text.letterSpacing,
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
}

function setTextPixelValue(
  node: TextNode,
  field: 'letterSpacing' | 'lineHeight',
  desired: number | undefined,
  state: ApplyState
): void {
  if (desired === undefined) return
  const current = node[field]
  if (current !== figma.mixed && current.unit === 'PIXELS' && current.value === desired) return
  node[field] = { unit: 'PIXELS', value: desired }
  markMutation(state, node)
}

async function applyComponent(
  node: InstanceNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const component = await resolveComponent(spec.component!, state)
  const currentComponent = await node.getMainComponentAsync()
  if (currentComponent?.id !== component.id) {
    node.swapComponent(component)
    markMutation(state, node)
  }

  if (!spec.componentProperties) return
  const changedProperties = Object.entries(spec.componentProperties).filter(
    ([name, value]) => node.componentProperties[name]?.value !== value
  )
  if (!changedProperties.length) return
  node.setProperties(Object.fromEntries(changedProperties))
  markMutation(state, node)
}

type DirectVariableField = Exclude<keyof CanvasVariableBindings, 'fill' | 'stroke'>

const DIRECT_VARIABLE_FIELDS: Record<
  DirectVariableField,
  VariableBindableNodeField | VariableBindableTextField
> = {
  width: 'width',
  height: 'height',
  gap: 'itemSpacing',
  paddingTop: 'paddingTop',
  paddingRight: 'paddingRight',
  paddingBottom: 'paddingBottom',
  paddingLeft: 'paddingLeft',
  cornerRadius: 'cornerRadius',
  opacity: 'opacity',
  fontFamily: 'fontFamily',
  fontStyle: 'fontStyle',
  fontSize: 'fontSize',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing'
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
  variable: Variable,
  state: ApplyState
): void {
  const property = field === 'fill' ? 'fills' : 'strokes'
  const currentPaints = node[property]
  if (currentPaints === figma.mixed) {
    specError(`${field} variable bindings cannot target mixed paints on node "${node.id}".`)
  }
  const paints = [...currentPaints]
  if (paints.length !== 1 || paints[0]?.type !== 'SOLID') {
    specError(`${field} variable bindings require exactly one solid paint on node "${node.id}".`)
  }
  const currentVariable = node.boundVariables?.[property]?.[0]
  if (currentVariable?.id === variable.id) return
  paints[0] = figma.variables.setBoundVariableForPaint(paints[0], 'color', variable)
  node[property] = paints
  markMutation(state, node)
}

async function applyVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState
): Promise<void> {
  if (!bindings) return
  for (const field of Object.keys(bindings) as Array<keyof CanvasVariableBindings>) {
    const reference = bindings[field]
    if (!reference) continue
    const variable = await resolveVariable(reference, state)
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

async function applyNodeProperties(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  setValue(node, node.name, spec.name, (value) => (node.name = value), state)
  setValue(node, node.visible, spec.visible, (value) => (node.visible = value), state)
  if (node.type === 'FRAME') applyLayout(node, spec, state)
  applyPosition(node, spec, state)
  applySize(node, spec, state)
  applyAppearance(node, spec, state)
  if (node.type === 'TEXT') await applyText(node, spec, state)
  if (node.type === 'INSTANCE') await applyComponent(node, spec, state)
  await applyVariables(node, spec.variables, state)
}

async function reconcileNode(
  spec: CanvasNodeSpec,
  state: ApplyState,
  parent?: FrameNode,
  index = 0,
  forcedNode?: SupportedCanvasNode
): Promise<SupportedCanvasNode> {
  const existing = resolveExistingNode(spec, state, forcedNode)
  const node = existing ?? (await createNode(spec, state))

  if (parent) moveIntoParent(node, parent, index, state)
  setNodeKey(state, node, spec.key)
  await applyNodeProperties(node, spec, state)
  state.nodeIdsByKey[spec.key] = node.id

  if (spec.children?.length) {
    if (node.type !== 'FRAME') {
      specError(`Only FRAME nodes can contain desired children; "${spec.key}" is ${node.type}.`)
    }
    for (const [childIndex, child] of spec.children.entries()) {
      await reconcileNode(child, state, node, childIndex)
    }
  }
  return node
}

function placeCreatedRoot(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  if (spec.position?.x !== undefined || spec.position?.y !== undefined) return
  const center = figma.viewport.center
  const x = center.x - node.width / 2
  const y = center.y - node.height / 2
  if (node.x === x && node.y === y) return
  node.x = x
  node.y = y
  markMutation(state, node)
}

async function applyParsedCanvas(input: ApplyCanvasParameters): Promise<ApplyCanvasResult> {
  let target: SupportedCanvasNode | null = null
  if (input.mode === 'update') {
    const candidate = figma.getNodeById(input.targetNodeId!)
    if (!isSupportedSceneNode(candidate)) {
      scopeError('The requested update target does not exist or is not a supported scene node.')
    }
    target = candidate
  }
  if (target && target.type !== input.root.type) {
    specError(
      `The update root expects ${input.root.type}, but target "${target.id}" is ${target.type}.`
    )
  }

  const state: ApplyState = {
    claimedNodeIds: new Set(),
    componentCache: new Map(),
    createdNodeIds: new Set(),
    keyedNodes: target ? collectKeyedNodes(target) : new Map(),
    mutationCount: 0,
    nodeIdsByKey: Object.create(null) as Record<string, string>,
    scope: target,
    updatedNodeIds: new Set(),
    variableCache: new Map()
  }

  figma.commitUndo()
  try {
    const root = await reconcileNode(input.root, state, undefined, 0, target ?? undefined)
    if (input.mode === 'create') {
      placeCreatedRoot(root, input.root, state)
    }
    figma.commitUndo()
    return {
      rootNodeId: root.id,
      nodeIdsByKey: state.nodeIdsByKey,
      createdNodeIds: [...state.createdNodeIds],
      updatedNodeIds: [...state.updatedNodeIds],
      mutationCount: state.mutationCount
    }
  } catch (error) {
    try {
      figma.triggerUndo()
    } catch {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        'Canvas apply failed and automatic rollback was not available. Use Figma Undo.'
      )
    }
    throw error
  }
}

export async function handleApplyCanvas(
  args?: ApplyCanvasParametersInput
): Promise<ApplyCanvasResult> {
  if (!canvasWritesOn.value) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_WRITE_DISABLED,
      'Canvas writing is disabled. Enable Canvas writes in TemPad Dev → Agent integration.'
    )
  }
  if (figma.editorType !== 'figma') {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_UNSUPPORTED_EDITOR,
      'Canvas authoring is supported only in Figma Design files.'
    )
  }
  if (applyInProgress) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_BUSY,
      'Another apply_canvas call is already running in this Figma session.'
    )
  }

  const parsed = ApplyCanvasParametersSchema.safeParse(args)
  if (!parsed.success) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      parsed.error.issues.map((issue) => issue.message).join(' ')
    )
  }

  applyInProgress = true
  try {
    return await applyParsedCanvas(parsed.data)
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      error instanceof Error ? error.message : 'Canvas apply failed.'
    )
  } finally {
    applyInProgress = false
  }
}
