import type {
  CanvasDesignReference,
  CanvasFigmaComponentPropertyDefinition,
  CanvasVariableReference,
  CanvasComponentPropertyValue,
  CanvasFigmaSlotProperty
} from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { getMainComponent } from '../../../local-resources'
import { scopeError, specError, applyError } from '../errors'
import { CANVAS_KEY_NAMESPACE, designReferenceCacheKey } from '../identity'
import { resolveVariable, resolvedVariable } from '../variables'
import { validateVariableDataType } from './binding-values'
import { isVariableBinding, isRecord, nativeValueEqual } from './comparison'
import { lookupNodeById, findExistingNode } from './nodes'
import { type ApplyState, markMutation, type SupportedCanvasNode, setValue } from './state'
import { protectNode } from './undo'

const CANVAS_COMPONENT_PROPERTY_KEYS_NAME = 'component-property-keys'
const CANVAS_SLOT_PROPERTY_NAME = 'slot-property-name'

type ComponentPropertyOwner = ComponentNode | ComponentSetNode

type ComponentPropertyReferenceField = 'characters' | 'mainComponent' | 'visible'

export type ComponentPropertyContext = {
  existing?: ComponentPropertyOwner
  spec?: CanvasNodeSpec
}

export function componentPropertyOwner(node: BaseNode): ComponentPropertyOwner | null {
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

export function componentDefinitionOwner(component: ComponentNode): ComponentPropertyOwner {
  return component.parent?.type === 'COMPONENT_SET' ? component.parent : component
}

export function componentPropertyKeys(
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
      keys = Object.assign(Object.create(null) as Record<string, string>, parsed)
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

export function componentPropertyName(
  owner: ComponentPropertyOwner,
  key: string,
  state: ApplyState
): string | undefined {
  const mapped = componentPropertyKeys(owner, state)[key]
  // Older slot identities shared this map with authored component-property keys.
  if (mapped && owner.componentPropertyDefinitions[mapped]?.type !== 'SLOT') return mapped
  return Object.hasOwn(owner.componentPropertyDefinitions, key) ? key : undefined
}

function setSlotPropertyName(node: SlotNode, propertyName: string, state: ApplyState): void {
  state.slotPropertyNames.set(node.id, propertyName)
  if (node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SLOT_PROPERTY_NAME) === propertyName)
    return
  node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SLOT_PROPERTY_NAME, propertyName)
  markMutation(state, node)
}

export async function resolveComponent(reference: CanvasDesignReference, state: ApplyState) {
  const cacheKey = designReferenceCacheKey(reference)
  const cached = state.componentCache.get(cacheKey)
  if (cached) return cached

  let component: ComponentNode | null = null
  if (reference.id !== undefined) {
    const node = await lookupNodeById(reference.id)
    if (node?.type === 'COMPONENT') {
      component = node
      protectNode(state, node)
    } else if (node?.type === 'COMPONENT_SET') {
      component = node.defaultVariant
      protectNode(state, node)
      protectNode(state, component)
    }
  } else {
    try {
      component = await figma.importComponentByKeyAsync(reference.key)
    } catch {
      specError(`Component key "${reference.key}" could not be imported.`)
    }
  }

  if (!component) {
    specError('The requested component could not be resolved.')
  }
  state.componentCache.set(cacheKey, component)
  return component
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
  const properties = context.spec?.figma?.component?.properties
  const desired = properties && Object.hasOwn(properties, key) ? properties[key] : undefined
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

export type ComponentPreflightResources = {
  variable: (
    reference: CanvasVariableReference
  ) => Promise<Pick<Variable, 'id' | 'resolvedType'> | undefined>
  component: (reference: CanvasDesignReference) => Promise<ComponentNode | undefined>
}

async function preflightComponentPropertyDefinition(
  key: string,
  definition: CanvasFigmaComponentPropertyDefinition,
  resources: ComponentPreflightResources
): Promise<void> {
  if (isVariableBinding(definition.defaultValue)) {
    const variable = await resources.variable(definition.defaultValue.variable)
    const expected = expectedComponentPropertyVariableType(definition.type)
    if (variable) validateVariableDataType(variable, expected, `component property "${key}"`)
  } else if (definition.type === 'INSTANCE_SWAP') {
    await resources.component(definition.defaultValue)
  }
}

async function preflightAuthoredComponentProperties(
  spec: CanvasNodeSpec,
  context: ComponentPropertyContext | undefined,
  state: ApplyState,
  resources: ComponentPreflightResources
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
    const propertyName =
      owner && desired !== null
        ? (componentPropertyName(owner, key, state) ?? key)
        : (keys?.[key] ?? key)
    const current =
      owner && propertyName && Object.hasOwn(owner.componentPropertyDefinitions, propertyName)
        ? owner.componentPropertyDefinitions[propertyName]
        : undefined
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
    await preflightComponentPropertyDefinition(key, desired, resources)
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
  node: SlotNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): string | undefined {
  const stored =
    state.slotPropertyNames.get(node.id) ??
    node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SLOT_PROPERTY_NAME)
  if (stored && owner.componentPropertyDefinitions[stored]?.type === 'SLOT') return stored
  const legacy = componentPropertyKeys(owner, state)[spec.key] ?? spec.key
  if (owner.componentPropertyDefinitions[legacy]?.type === 'SLOT') return legacy
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
    if (context.existing) protectNode(state, context.existing)
    return
  }
  if (existing.type !== 'SLOT' || !spec.figma?.slot?.property) return
  const owner = componentPropertyOwner(existing)
  const propertyName = owner ? slotPropertyName(owner, existing, spec, state) : undefined
  if (!owner || !propertyName) {
    specError(`Slot property for "${spec.key}" could not be resolved.`)
  }
  // Slot metadata writes the definition owner, which can be outside the update root.
  protectNode(state, owner)
  // Keep legacy resolution stable if a normal property takes the same key during apply.
  state.slotPropertyNames.set(existing.id, propertyName)
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
  state: ApplyState,
  resources: ComponentPreflightResources
): Promise<void> {
  const owner = componentDefinitionOwner(component)
  for (const [key, value] of Object.entries(spec.componentProperties ?? {})) {
    const name = componentPropertyName(owner, key, state) ?? key
    const definition = Object.hasOwn(owner.componentPropertyDefinitions, name)
      ? owner.componentPropertyDefinitions[name]
      : undefined
    if (!definition) {
      specError(`Component "${component.id}" has no property "${key}" for "${spec.key}".`)
    }
    if (definition.type === 'SLOT') {
      specError(`Slot property "${name}" on "${spec.key}" cannot be set with componentProperties.`)
    }
    if (isVariableBinding(value)) {
      if (definition.type === 'VARIANT' || definition.type === 'INSTANCE_SWAP') {
        specError(
          `Component property "${name}" on "${spec.key}" cannot bind a variable because it is ${definition.type}.`
        )
      }
      const variable = await resources.variable(value.variable)
      const expected = expectedComponentPropertyVariableType(definition.type)
      if (variable && variable.resolvedType !== expected) {
        specError(
          `Variable "${variable.id}" for component property "${name}" on "${spec.key}" is ${variable.resolvedType}, expected ${expected}.`
        )
      }
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
    const replacement = await lookupNodeById(value as string)
    if (replacement?.type !== 'COMPONENT' && replacement?.type !== 'COMPONENT_SET') {
      specError(
        `Instance-swap property "${name}" on "${spec.key}" must reference a component node.`
      )
    }
    if (replacement.type === 'COMPONENT_SET' && spec.componentProperties) {
      spec.componentProperties[key] = replacement.defaultVariant.id
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

export async function preflightComponentState(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing?: SupportedCanvasNode,
  inheritedComponent?: ComponentPropertyContext,
  resources: ComponentPreflightResources = {
    variable: (reference) => resolveVariable(reference, state.variables),
    component: (reference) => resolveComponent(reference, state)
  }
): Promise<ComponentPropertyContext | undefined> {
  const component = nextComponentPropertyContext(spec, existing, inheritedComponent)
  if (component?.existing?.remote) {
    specError(`Remote ${component.existing.type} containing "${spec.key}" is read-only.`)
  }
  await preflightAuthoredComponentProperties(spec, component, state, resources)
  preflightComponentPropertyReferences(spec, existing, component, state)
  preflightSlot(spec, existing, component, state)
  if (spec.component) {
    const instanceComponent = await resources.component(spec.component)
    if (instanceComponent)
      await preflightComponentProperties(spec, instanceComponent, state, resources)
  } else if (spec.componentProperties || spec.figma?.instance) {
    const instance = existing ?? findExistingNode(spec, state)
    if (instance?.type !== 'INSTANCE') {
      specError(
        `Instance state on "${spec.key}" requires an existing instance or a component reference.`
      )
    }
    if (spec.componentProperties) {
      const instanceComponent = await getMainComponent(instance)
      if (!instanceComponent) {
        specError(`Existing instance "${spec.key}" has no main component.`)
      }
      await preflightComponentProperties(spec, instanceComponent, state, resources)
    }
  }
  if (spec.figma?.instance?.exposed !== undefined) {
    const instance = existing ?? findExistingNode(spec, state)
    if (instance?.type !== 'INSTANCE' || !isPrimaryNestedInstance(instance)) {
      specError(
        `Instance exposure on "${spec.key}" requires an existing primary instance inside a component.`
      )
    }
  }
  return component
}

export function resolvedComponent(
  reference: CanvasDesignReference,
  state: ApplyState
): ComponentNode {
  const component = state.componentCache.get(designReferenceCacheKey(reference))
  if (!component)
    applyError(
      'A preflighted component could not be resolved. This is an internal apply failure; do not retry the same payload.'
    )
  return component
}

export function preservesComponentPropertyReference(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  field: ComponentPropertyReferenceField
): boolean {
  const desired = spec.figma?.componentPropertyReferences?.[field]
  return desired === undefined
    ? node.componentPropertyReferences?.[field] !== undefined
    : desired !== null
}

export function componentPropertyMatches(
  current: ComponentProperties[string] | undefined,
  value: CanvasComponentPropertyValue,
  state: ApplyState
): boolean {
  return isVariableBinding(value)
    ? current?.boundVariables?.value?.id === resolvedVariable(value.variable, state.variables).id
    : current?.value === value && current.boundVariables?.value === undefined
}

export async function applyComponent(
  node: InstanceNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const instance = spec.figma?.instance
  const component = spec.component
    ? resolvedComponent(spec.component, state)
    : await getMainComponent(node)
  if (!component) {
    specError(`Existing instance "${spec.key}" has no main component.`)
  }
  if (spec.component && !preservesComponentPropertyReference(node, spec, 'mainComponent')) {
    const currentComponent = await getMainComponent(node)
    if (!componentLinkMatches(spec, node, component, currentComponent, state)) {
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

  const owner = componentDefinitionOwner(component)
  const desiredProperties = Object.entries(spec.componentProperties ?? {}).map(
    ([key, value]) => [componentPropertyName(owner, key, state) ?? key, value] as const
  )
  const changedProperties = desiredProperties.filter(
    ([name, value]) => !componentPropertyMatches(node.componentProperties[name], value, state)
  )
  if (changedProperties.length) {
    node.setProperties(
      Object.fromEntries(
        changedProperties.map(([name, value]) => [
          name,
          isVariableBinding(value)
            ? figma.variables.createVariableAlias(resolvedVariable(value.variable, state.variables))
            : value
        ])
      )
    )
    markMutation(state, node)
  }
}

function nativeComponentPropertyDefault(
  definition: CanvasFigmaComponentPropertyDefinition,
  state: ApplyState
): string | boolean | VariableAlias {
  const value = definition.defaultValue
  if (isVariableBinding(value)) {
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

export function applyAuthoredComponentProperties(
  owner: ComponentPropertyOwner,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const properties = spec.figma?.component?.properties
  if (!properties) return
  const keys = componentPropertyKeys(owner, state)
  for (const [key, desired] of Object.entries(properties)) {
    const propertyName =
      desired === null ? (keys[key] ?? key) : (componentPropertyName(owner, key, state) ?? key)
    const current = Object.hasOwn(owner.componentPropertyDefinitions, propertyName)
      ? owner.componentPropertyDefinitions[propertyName]
      : undefined
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

export function applySlotProperty(node: SlotNode, spec: CanvasNodeSpec, state: ApplyState): void {
  const desired = spec.figma?.slot?.property
  if (!desired) return
  const owner = componentPropertyOwner(node)
  if (!owner) specError(`Slot "${spec.key}" has no authored component owner.`)
  const propertyName = slotPropertyName(owner, node, spec, state)
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
  let editedName = propertyName
  if (Object.keys(edit).length) {
    editedName = owner.editComponentProperty(propertyName, edit)
    markMutation(state, owner)
  }
  setSlotPropertyName(node, editedName, state)
}

export function applyComponentPropertyReferences(
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

export function applyComponentMetadata(
  node: ComponentNode | ComponentSetNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const metadata = spec.figma?.component
  if (!metadata) return
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

export function componentLinkMatches(
  spec: CanvasNodeSpec,
  node: InstanceNode,
  expected: ComponentNode,
  actual: ComponentNode | null,
  state: ApplyState
): boolean {
  if (actual?.id === expected.id) return true
  const componentSet = expected.parent
  if (
    !actual ||
    componentSet?.type !== 'COMPONENT_SET' ||
    actual.parent?.type !== 'COMPONENT_SET' ||
    actual.parent.id !== componentSet.id
  ) {
    return false
  }

  const variantProperties = Object.entries(spec.componentProperties ?? {}).flatMap(
    ([key, value]) => {
      const name = componentPropertyName(componentSet, key, state) ?? key
      return componentSet.componentPropertyDefinitions[name]?.type === 'VARIANT'
        ? ([[name, value]] as const)
        : []
    }
  )
  return (
    variantProperties.length > 0 &&
    variantProperties.every(([name, value]) =>
      componentPropertyMatches(node.componentProperties[name], value, state)
    )
  )
}
