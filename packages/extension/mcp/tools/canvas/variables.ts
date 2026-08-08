import type {
  CanvasVariableCollectionReference,
  CanvasVariableCollections,
  CanvasVariableReference,
  CanvasVariableValue
} from '@tempad-dev/shared'

import { getLocalStyles } from '../../local-styles'
import { collectVariableAliasIds } from '../../variable-references'
import { scopeError, specError } from './errors'
import {
  CANVAS_KEY_NAMESPACE,
  CANVAS_VARIABLE_COLLECTION_KEY_NAME,
  CANVAS_VARIABLE_KEY_NAME,
  CANVAS_VARIABLE_MODE_KEYS_NAME,
  type MutationCounter,
  claimAuthoringKey,
  designReferenceCacheKey,
  parseVariableModeKeys,
  readAuthoringKey
} from './identity'
import { isComponentPropertyOwner } from './traversal'

type CollectionSpec = Exclude<CanvasVariableCollections[string], null>
type ModeSpec = Exclude<NonNullable<CollectionSpec['modes']>[string], null>
type OverrideSpec = NonNullable<CollectionSpec['overrides']>[number]
type VariableSpec = Exclude<NonNullable<CollectionSpec['variables']>[string], null>

type ModeRemoval = {
  collection: VariableCollection
  modeId: string
}

export type CanvasVariableState = {
  collectionCache: Map<string, VariableCollection>
  collectionsByKey: Map<string, VariableCollection>
  collectionRemovals: VariableCollection[]
  createdVariableKeys: Set<string>
  localIndex?: Promise<void>
  modeIdsByCollection: Map<string, Map<string, string>>
  modeRemovals: ModeRemoval[]
  variableCache: Map<string, Variable>
  variableRemovals: Variable[]
  variablesByKey: Map<string, Variable>
}

type VariableWork = {
  collection: VariableCollection
  spec: VariableSpec
  values: Map<string, CanvasVariableValue>
  variable: Variable
}

type OverrideWork = {
  collection: ExtendedVariableCollection
  values: Map<string, CanvasVariableValue | null>
  variable: Variable
}

function extendedCollection(collection: VariableCollection): ExtendedVariableCollection {
  if (!collection.isExtension) {
    specError(`Variable collection "${collection.id}" is not an extended collection.`)
  }
  return collection as unknown as ExtendedVariableCollection
}

export function createVariableState(): CanvasVariableState {
  return {
    collectionCache: new Map(),
    collectionsByKey: new Map(),
    collectionRemovals: [],
    createdVariableKeys: new Set(),
    modeIdsByCollection: new Map(),
    modeRemovals: [],
    variableCache: new Map(),
    variableRemovals: [],
    variablesByKey: new Map()
  }
}

export function variableReferenceCacheKey(reference: CanvasVariableReference): string {
  if ('variableKey' in reference) return `variable-key:${reference.variableKey}`
  return designReferenceCacheKey(reference)
}

function readModeIds(collection: VariableCollection): Map<string, string> {
  const raw = collection.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_MODE_KEYS_NAME)
  const modeIds = parseVariableModeKeys(raw, collection.modes)
  if (!modeIds) {
    scopeError(`Variable mode identity data on collection "${collection.id}" is invalid.`)
  }
  return modeIds
}

function serializeModeIds(modeIds: Map<string, string>): string {
  return JSON.stringify(Object.fromEntries(modeIds))
}

function indexResource<T extends Variable | VariableCollection>(
  resources: Map<string, T>,
  key: string,
  resource: T,
  kind: string
): void {
  const existing = resources.get(key)
  if (existing && existing.id !== resource.id) {
    scopeError(`${kind} authoring key "${key}" is duplicated in this file.`)
  }
  resources.set(key, resource)
}

async function ensureLocalIndex(state: CanvasVariableState): Promise<void> {
  state.localIndex ??= (async () => {
    const [collections, variables] = await Promise.all([
      figma.variables.getLocalVariableCollectionsAsync(),
      figma.variables.getLocalVariablesAsync()
    ])
    for (const collection of collections) {
      state.collectionCache.set(`id:${collection.id}`, collection)
      const key = readAuthoringKey(collection, CANVAS_VARIABLE_COLLECTION_KEY_NAME)
      if (key) indexResource(state.collectionsByKey, key, collection, 'Variable collection')
      state.modeIdsByCollection.set(collection.id, readModeIds(collection))
    }
    for (const variable of variables) {
      state.variableCache.set(`id:${variable.id}`, variable)
      const key = readAuthoringKey(variable, CANVAS_VARIABLE_KEY_NAME)
      if (key) indexResource(state.variablesByKey, key, variable, 'Variable')
    }
  })()
  await state.localIndex
}

export async function resolveVariable(
  reference: CanvasVariableReference,
  state: CanvasVariableState
): Promise<Variable> {
  const cacheKey = variableReferenceCacheKey(reference)
  const cached = state.variableCache.get(cacheKey)
  if (cached) return cached

  let variable: Variable | null | undefined
  if ('variableKey' in reference) {
    await ensureLocalIndex(state)
    variable = state.variablesByKey.get(reference.variableKey)
  } else {
    variable =
      reference.id !== undefined
        ? await figma.variables.getVariableByIdAsync(reference.id)
        : await figma.variables.importVariableByKeyAsync(reference.key)
  }
  if (!variable) {
    let identity: string
    if ('variableKey' in reference) identity = `authoring key "${reference.variableKey}"`
    else if (reference.id !== undefined) identity = `id "${reference.id}"`
    else identity = `library key "${reference.key}"`
    specError(`Variable ${identity} could not be resolved.`)
  }
  state.variableCache.set(cacheKey, variable)
  state.variableCache.set(`id:${variable.id}`, variable)
  return variable
}

export function resolvedVariable(
  reference: CanvasVariableReference,
  state: CanvasVariableState
): Variable {
  const variable = state.variableCache.get(variableReferenceCacheKey(reference))
  if (!variable) specError('A preflighted variable could not be resolved.')
  return variable
}

export async function resolveCollection(
  reference: string,
  state: CanvasVariableState
): Promise<VariableCollection> {
  const cached = state.collectionCache.get(`id:${reference}`)
  if (cached) return cached

  const byId = await figma.variables.getVariableCollectionByIdAsync(reference)
  if (byId) {
    state.collectionCache.set(`id:${reference}`, byId)
    return byId
  }
  await ensureLocalIndex(state)
  const collection = state.collectionsByKey.get(reference)
  if (!collection) specError(`Variable collection "${reference}" could not be resolved.`)
  return collection
}

export function resolvedCollection(
  reference: string,
  state: CanvasVariableState
): VariableCollection {
  const collection =
    state.collectionCache.get(`id:${reference}`) ?? state.collectionsByKey.get(reference)
  if (!collection) {
    specError(`Preflighted variable collection "${reference}" could not be resolved.`)
  }
  return collection
}

export async function resolveModeId(
  collection: VariableCollection,
  reference: string,
  state: CanvasVariableState
): Promise<string> {
  if (collection.modes.some((mode) => mode.modeId === reference)) return reference
  await ensureLocalIndex(state)
  const modeId = state.modeIdsByCollection.get(collection.id)?.get(reference)
  if (modeId) return modeId
  if (collection.isExtension) {
    const extended = extendedCollection(collection)
    const direct = extended.modes.find((mode) => mode.parentModeId === reference)
    if (direct) return direct.modeId
    const parent = await resolveCollection(extended.parentVariableCollectionId, state)
    const parentModeId = await resolveModeId(parent, reference, state)
    const inherited = extended.modes.find((mode) => mode.parentModeId === parentModeId)
    if (inherited) return inherited.modeId
  }
  specError(`Variable collection "${collection.id}" has no mode "${reference}".`)
}

export function resolvedModeId(
  collection: VariableCollection,
  reference: string,
  state: CanvasVariableState
): string {
  if (collection.modes.some((mode) => mode.modeId === reference)) return reference
  const modeId = state.modeIdsByCollection.get(collection.id)?.get(reference)
  if (modeId) return modeId
  if (collection.isExtension) {
    const extended = extendedCollection(collection)
    const direct = extended.modes.find((mode) => mode.parentModeId === reference)
    if (direct) return direct.modeId
    const parent = resolvedCollection(extended.parentVariableCollectionId, state)
    const parentModeId = resolvedModeId(parent, reference, state)
    const inherited = extended.modes.find((mode) => mode.parentModeId === parentModeId)
    if (inherited) return inherited.modeId
  }
  specError(`Preflighted variable mode "${reference}" could not be resolved.`)
}

async function collectionByReference(
  reference: CanvasVariableCollectionReference,
  state: CanvasVariableState
): Promise<VariableCollection> {
  if ('collectionKey' in reference) {
    return resolveCollection(reference.collectionKey, state)
  }
  if (reference.id !== undefined) {
    const collection = await resolveCollection(reference.id, state)
    if (reference.key !== undefined && collection.key !== reference.key) {
      specError(`Variable collection "${reference.id}" does not have key "${reference.key}".`)
    }
    return collection
  }
  specError('A published collection key cannot be resolved before extension.')
}

async function createExtendedCollection(
  reference: CanvasVariableCollectionReference,
  name: string,
  state: CanvasVariableState
): Promise<VariableCollection> {
  let collection: ExtendedVariableCollection
  if (!('collectionKey' in reference) && reference.id === undefined) {
    collection = await figma.variables.extendLibraryCollectionByKeyAsync(reference.key, name)
  } else {
    const parent = await collectionByReference(reference, state)
    collection = parent.remote
      ? await figma.variables.extendLibraryCollectionByKeyAsync(parent.key, name)
      : parent.extend(name)
  }
  return collection as unknown as VariableCollection
}

async function validateExtendedParent(
  collection: VariableCollection,
  reference: CanvasVariableCollectionReference,
  state: CanvasVariableState
): Promise<void> {
  const extended = extendedCollection(collection)
  const parent = await figma.variables.getVariableCollectionByIdAsync(
    extended.parentVariableCollectionId
  )
  if (!parent) {
    specError(`Parent of extended collection "${collection.id}" does not exist.`)
  }
  if (!('collectionKey' in reference) && reference.id === undefined) {
    if (parent.key !== reference.key) {
      specError(`Extended collection "${collection.id}" does not inherit "${reference.key}".`)
    }
    return
  }
  const expected = await collectionByReference(reference, state)
  if (parent.id !== expected.id) {
    specError(`Extended collection "${collection.id}" does not inherit "${expected.id}".`)
  }
}

async function selectCollection(
  key: string,
  spec: CollectionSpec,
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<{ collection: VariableCollection; isNew: boolean }> {
  const keyed = state.collectionsByKey.get(key)
  const explicit = spec.id
    ? await figma.variables.getVariableCollectionByIdAsync(spec.id)
    : undefined
  if (spec.id && !explicit) specError(`Variable collection "${spec.id}" does not exist.`)
  if (keyed && explicit && keyed.id !== explicit.id) {
    specError(`Variable collection key "${key}" does not identify "${explicit.id}".`)
  }
  let collection = explicit ?? keyed
  const isNew = !collection
  if (!collection) {
    if (!spec.name) specError(`New variable collection "${key}" requires a name.`)
    if (spec.extends) {
      collection = await createExtendedCollection(spec.extends, spec.name, state)
    } else {
      collection = figma.variables.createVariableCollection(spec.name)
    }
    mutations.count += 1
  }
  if (collection.remote) {
    specError(`Variable collection "${collection.id}" is not an editable local collection.`)
  }
  if (collection.isExtension) {
    if (spec.modes || spec.variables) {
      specError(`Extended collection "${collection.id}" cannot define modes or variables.`)
    }
    if (spec.extends) {
      await validateExtendedParent(collection, spec.extends, state)
    }
  } else if (spec.extends || spec.overrides) {
    specError(`Base collection "${collection.id}" cannot declare extension overrides.`)
  }
  claimAuthoringKey(collection, key, CANVAS_VARIABLE_COLLECTION_KEY_NAME, 'Resource', mutations)
  indexResource(state.collectionsByKey, key, collection, 'Variable collection')
  state.collectionCache.set(`id:${collection.id}`, collection)
  state.modeIdsByCollection.set(
    collection.id,
    state.modeIdsByCollection.get(collection.id) ?? readModeIds(collection)
  )
  return { collection, isNew }
}

function orderedCollectionEntries(
  specs: CanvasVariableCollections
): Array<[string, CollectionSpec]> {
  const pending = new Map(
    Object.entries(specs).filter((entry): entry is [string, CollectionSpec] => entry[1] !== null)
  )
  const ordered: Array<[string, CollectionSpec]> = []
  while (pending.size) {
    let progressed = false
    for (const [key, spec] of pending) {
      const parentKey =
        spec.extends && 'collectionKey' in spec.extends ? spec.extends.collectionKey : undefined
      if (parentKey && pending.has(parentKey)) continue
      ordered.push([key, spec])
      pending.delete(key)
      progressed = true
    }
    if (!progressed) {
      specError('Extended variable collections contain a parent cycle.')
    }
  }
  return ordered
}

function selectMode(
  collection: VariableCollection,
  key: string,
  spec: ModeSpec,
  isNewCollection: boolean,
  first: boolean,
  modeIds: Map<string, string>,
  mutations: MutationCounter
): void {
  const mappedId = modeIds.get(key)
  if (mappedId && spec.id && mappedId !== spec.id) {
    specError(`Variable mode key "${key}" does not identify "${spec.id}".`)
  }
  let modeId = spec.id ?? mappedId
  if (modeId && !collection.modes.some((mode) => mode.modeId === modeId)) {
    specError(`Variable collection "${collection.id}" has no mode "${modeId}".`)
  }
  if (!modeId) {
    if (!spec.name) specError(`New variable mode "${key}" requires a name.`)
    modeId = isNewCollection && first ? collection.defaultModeId : collection.addMode(spec.name)
    if (!(isNewCollection && first)) mutations.count += 1
  }
  const claimedKey = [...modeIds].find(
    ([existingKey, existingId]) => existingId === modeId && existingKey !== key
  )?.[0]
  if (claimedKey) {
    specError(`Variable mode "${modeId}" is already owned by authoring key "${claimedKey}".`)
  }
  modeIds.set(key, modeId)
  const current = collection.modes.find((mode) => mode.modeId === modeId)!
  if (spec.name !== undefined && current.name !== spec.name) {
    collection.renameMode(modeId, spec.name)
    mutations.count += 1
  }
}

function reconcileModes(
  collection: VariableCollection,
  specs: CollectionSpec['modes'],
  isNew: boolean,
  state: CanvasVariableState,
  mutations: MutationCounter
): string[] {
  if (!specs) return []
  const existingIds = new Set(collection.modes.map((mode) => mode.modeId))
  const modeIds = state.modeIdsByCollection.get(collection.id) ?? new Map()
  const before = serializeModeIds(modeIds)
  let first = true
  for (const [key, spec] of Object.entries(specs)) {
    if (spec === null) {
      const modeId = modeIds.get(key)
      if (modeId) state.modeRemovals.push({ collection, modeId })
      continue
    }
    selectMode(collection, key, spec, isNew, first, modeIds, mutations)
    first = false
  }
  state.modeIdsByCollection.set(collection.id, modeIds)
  const after = serializeModeIds(modeIds)
  if (after !== before) {
    collection.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_MODE_KEYS_NAME, after)
    mutations.count += 1
  }
  return isNew
    ? []
    : collection.modes.map((mode) => mode.modeId).filter((modeId) => !existingIds.has(modeId))
}

function setResourceValue<T>(
  current: T,
  desired: T | undefined,
  apply: (value: T) => void,
  mutations: MutationCounter,
  equal: (left: T, right: T) => boolean = Object.is
): void {
  if (desired === undefined || equal(current, desired)) return
  apply(desired)
  mutations.count += 1
}

function setCollectionProperties(
  collection: VariableCollection,
  spec: CollectionSpec,
  mutations: MutationCounter
): void {
  setResourceValue(collection.name, spec.name, (value) => (collection.name = value), mutations)
  setResourceValue(
    collection.hiddenFromPublishing,
    spec.hiddenFromPublishing,
    (value) => (collection.hiddenFromPublishing = value),
    mutations
  )
}

async function resolveValues<T>(
  collection: VariableCollection,
  values: Record<string, T> | undefined,
  state: CanvasVariableState,
  kind: string
): Promise<Map<string, T>> {
  const resolved = new Map<string, T>()
  for (const [modeReference, value] of Object.entries(values ?? {})) {
    const modeId = await resolveModeId(collection, modeReference, state)
    if (resolved.has(modeId)) {
      specError(`${kind} describes mode "${modeId}" more than once.`)
    }
    resolved.set(modeId, value)
  }
  return resolved
}

async function selectVariable(
  collection: VariableCollection,
  key: string,
  spec: VariableSpec,
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<VariableWork> {
  const keyed = state.variablesByKey.get(key)
  const explicit = spec.id ? await figma.variables.getVariableByIdAsync(spec.id) : undefined
  if (spec.id && !explicit) specError(`Variable "${spec.id}" does not exist.`)
  if (keyed && explicit && keyed.id !== explicit.id) {
    specError(`Variable key "${key}" does not identify "${explicit.id}".`)
  }
  let variable = explicit ?? keyed
  const isNew = !variable
  const values = await resolveValues(collection, spec.values, state, 'Variable value')
  if (!variable) {
    if (!spec.name || !spec.type) {
      specError(`New variable "${key}" requires a name and type.`)
    }
    const missingMode = collection.modes.find((mode) => !values.has(mode.modeId))
    if (missingMode) {
      specError(`New variable "${key}" requires a value for mode "${missingMode.name}".`)
    }
    variable = figma.variables.createVariable(spec.name, collection, spec.type)
    mutations.count += 1
  }
  if (variable.remote) {
    specError(`Variable "${variable.id}" is not editable in collection "${collection.id}".`)
  }
  if (variable.variableCollectionId !== collection.id) {
    if (keyed?.id === variable.id) {
      specError(
        `Variable authoring key "${key}" already identifies variable "${variable.id}" in collection "${variable.variableCollectionId}" and cannot be reused in collection "${collection.id}". Authoring keys are file-wide; use a namespaced key.`
      )
    }
    specError(
      `Variable "${variable.id}" belongs to collection "${variable.variableCollectionId}", not "${collection.id}".`
    )
  }
  if (spec.type !== undefined && variable.resolvedType !== spec.type) {
    specError(`Variable "${variable.id}" is ${variable.resolvedType}, expected ${spec.type}.`)
  }
  claimAuthoringKey(variable, key, CANVAS_VARIABLE_KEY_NAME, 'Resource', mutations)
  indexResource(state.variablesByKey, key, variable, 'Variable')
  state.variableCache.set(`id:${variable.id}`, variable)
  state.variableCache.set(`variable-key:${key}`, variable)
  if (isNew) state.createdVariableKeys.add(key)
  return { collection, spec, values, variable }
}

async function selectOverride(
  collection: VariableCollection,
  spec: OverrideSpec,
  state: CanvasVariableState
): Promise<OverrideWork> {
  const extended = extendedCollection(collection)
  const variable = await resolveVariable(spec.variable, state)
  if (!extended.variableIds.includes(variable.id)) {
    specError(`Variable "${variable.id}" is not inherited by extended collection "${extended.id}".`)
  }
  return {
    collection: extended,
    values: await resolveValues(collection, spec.values, state, 'Extended variable override'),
    variable
  }
}

function setVariableProperties(work: VariableWork, mutations: MutationCounter): void {
  const { spec, variable } = work
  setResourceValue(variable.name, spec.name, (value) => (variable.name = value), mutations)
  setResourceValue(
    variable.description,
    spec.description,
    (value) => (variable.description = value),
    mutations
  )
  setResourceValue(
    variable.hiddenFromPublishing,
    spec.hiddenFromPublishing,
    (value) => (variable.hiddenFromPublishing = value),
    mutations
  )
  setResourceValue(
    variable.scopes,
    spec.scopes,
    (value) => (variable.scopes = value),
    mutations,
    (left, right) =>
      left.length === right.length && left.every((value, index) => value === right[index])
  )
  for (const [platform, value] of Object.entries(spec.codeSyntax ?? {}) as Array<
    [CodeSyntaxPlatform, string | null]
  >) {
    const current = variable.codeSyntax[platform]
    if (value === null) {
      if (current !== undefined) {
        variable.removeVariableCodeSyntax(platform)
        mutations.count += 1
      }
    } else if (current !== value) {
      variable.setVariableCodeSyntax(platform, value)
      mutations.count += 1
    }
  }
}

function isAlias(value: VariableValue | CanvasVariableValue): value is VariableAlias {
  return typeof value === 'object' && value !== null && 'type' in value
}

function isVariableReference(
  value: CanvasVariableValue
): value is { variable: CanvasVariableReference } {
  return typeof value === 'object' && value !== null && 'variable' in value
}

function isColor(value: unknown): value is RGB | RGBA {
  return typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value
}

function valuesEqual(left: VariableValue | undefined, right: VariableValue): boolean {
  if (left === right) return true
  if (left === undefined || typeof left !== 'object' || typeof right !== 'object') return false
  if (isAlias(left) || isAlias(right)) {
    return isAlias(left) && isAlias(right) && left.id === right.id
  }
  if (!isColor(left) || !isColor(right)) return false
  return (
    left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    ('a' in left ? left.a : 1) === ('a' in right ? right.a : 1)
  )
}

function literalMatchesType(value: CanvasVariableValue, type: VariableResolvedDataType): boolean {
  if (type === 'BOOLEAN') return typeof value === 'boolean'
  if (type === 'FLOAT') return typeof value === 'number'
  if (type === 'STRING') return typeof value === 'string'
  return isColor(value)
}

async function nativeValue(
  value: CanvasVariableValue,
  variable: Variable,
  state: CanvasVariableState
): Promise<VariableValue> {
  if (!isVariableReference(value)) {
    if (!literalMatchesType(value, variable.resolvedType)) {
      specError(`Value for variable "${variable.id}" must be ${variable.resolvedType}.`)
    }
    return value
  }
  const target = await resolveVariable(value.variable, state)
  if (target.resolvedType !== variable.resolvedType) {
    specError(
      `Variable alias "${target.id}" is ${target.resolvedType}, expected ${variable.resolvedType}.`
    )
  }
  return figma.variables.createVariableAlias(target)
}

async function setVariableValues(
  work: VariableWork,
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<void> {
  for (const [modeId, value] of work.values) {
    const desired = await nativeValue(value, work.variable, state)
    if (valuesEqual(work.variable.valuesByMode[modeId], desired)) continue
    work.variable.setValueForMode(modeId, desired)
    mutations.count += 1
  }
}

async function setOverrideValues(
  work: OverrideWork,
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<void> {
  const current = work.collection.variableOverrides[work.variable.id] ?? {}
  for (const [modeId, value] of work.values) {
    if (value === null) {
      if (current[modeId] === undefined) continue
      work.variable.removeOverrideForMode(modeId)
    } else {
      const desired = await nativeValue(value, work.variable, state)
      if (valuesEqual(current[modeId], desired)) continue
      work.variable.setValueForMode(modeId, desired)
    }
    mutations.count += 1
  }
}

function validateNewCollection(key: string, spec: CollectionSpec): void {
  if (spec.extends) {
    if (spec.modes || spec.variables) {
      specError(`Extended collection "${key}" cannot define modes or variables.`)
    }
    return
  }
  if (spec.overrides) {
    specError(`Base collection "${key}" cannot declare extension overrides.`)
  }
  const modes = Object.entries(spec.modes ?? {})
    .filter(([, mode]) => mode !== null)
    .map(([modeKey]) => modeKey)
  if (!modes.length) {
    specError(`New variable collection "${key}" requires at least one mode.`)
  }
  for (const [modeKey, mode] of Object.entries(spec.modes ?? {})) {
    if (mode === null) continue
    if (mode.id) {
      specError(`New variable mode "${modeKey}" cannot declare an existing id.`)
    }
  }
  for (const [variableKey, variable] of Object.entries(spec.variables ?? {})) {
    if (variable === null) continue
    if (variable.id) {
      specError(`Variable "${variableKey}" cannot be adopted into new collection "${key}".`)
    }
    if (!variable.name || !variable.type) {
      specError(`New variable "${variableKey}" requires a name and type.`)
    }
    const values = new Set(Object.keys(variable.values ?? {}))
    const missing = modes.find((modeKey) => !values.has(modeKey))
    if (missing) {
      specError(`New variable "${variableKey}" requires a value for mode "${missing}".`)
    }
    const unknown = [...values].find((modeKey) => !modes.includes(modeKey))
    if (unknown) {
      specError(`New collection "${key}" has no mode "${unknown}".`)
    }
  }
}

async function initializeAddedModes(
  collection: VariableCollection,
  modeIds: string[],
  works: VariableWork[],
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<void> {
  if (!modeIds.length) return
  const desiredByVariable = new Map(works.map((work) => [work.variable.id, work.values]))
  for (const variableId of collection.variableIds) {
    const variable = await resolveVariable({ id: variableId }, state)
    for (const modeId of modeIds) {
      if (desiredByVariable.get(variableId)?.has(modeId)) continue
      const fallback = variable.valuesByMode[collection.defaultModeId]
      if (fallback === undefined) {
        specError(
          `Variable "${variable.id}" requires a value before adding a mode to collection "${collection.id}".`
        )
      }
      variable.setValueForMode(modeId, fallback)
      mutations.count += 1
    }
  }
}

export async function reconcileVariableCollections(
  specs: CanvasVariableCollections | undefined,
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<void> {
  if (!specs) return
  await ensureLocalIndex(state)
  const collections: Array<{
    addedModeIds: string[]
    collection: VariableCollection
    spec: CollectionSpec
  }> = []

  for (const [key, spec] of Object.entries(specs)) {
    if (spec !== null) continue
    const collection = state.collectionsByKey.get(key)
    if (collection) state.collectionRemovals.push(collection)
  }

  for (const [key, spec] of orderedCollectionEntries(specs)) {
    if (!spec.id && !state.collectionsByKey.has(key)) validateNewCollection(key, spec)
    const { collection, isNew } = await selectCollection(key, spec, state, mutations)
    const addedModeIds = reconcileModes(collection, spec.modes, isNew, state, mutations)
    setCollectionProperties(collection, spec, mutations)
    collections.push({ addedModeIds, collection, spec })
  }

  const variables: VariableWork[] = []
  for (const { collection, spec } of collections) {
    for (const [key, variable] of Object.entries(spec.variables ?? {})) {
      if (variable === null) {
        const existing = state.variablesByKey.get(key)
        if (!existing) continue
        if (existing.variableCollectionId !== collection.id) {
          specError(`Variable "${existing.id}" is not in collection "${collection.id}".`)
        }
        state.variableRemovals.push(existing)
        continue
      }
      variables.push(await selectVariable(collection, key, variable, state, mutations))
    }
  }
  const overrides: OverrideWork[] = []
  const overridden = new Set<string>()
  for (const { collection, spec } of collections) {
    if (!spec.overrides) continue
    for (const override of spec.overrides) {
      const work = await selectOverride(collection, override, state)
      const key = `${collection.id}:${work.variable.id}`
      if (overridden.has(key)) {
        specError(
          `Variable "${work.variable.id}" has more than one override entry in collection "${collection.id}".`
        )
      }
      overridden.add(key)
      overrides.push(work)
    }
  }
  for (const { addedModeIds, collection } of collections) {
    await initializeAddedModes(
      collection,
      addedModeIds,
      variables.filter((variable) => variable.collection.id === collection.id),
      state,
      mutations
    )
  }
  for (const variable of variables) setVariableProperties(variable, mutations)
  for (const variable of variables) await setVariableValues(variable, state, mutations)
  for (const override of overrides) await setOverrideValues(override, state, mutations)
}

function assertNoRemovedVariable(
  value: unknown,
  removedVariableIds: Set<string>,
  consumer: string
): void {
  const referencedIds = new Set<string>()
  collectVariableAliasIds(value, referencedIds)
  const variableId = [...referencedIds].find((id) => removedVariableIds.has(id))
  if (variableId) {
    scopeError(`Variable "${variableId}" is still used by ${consumer}.`)
  }
}

function assertNoRemovedVariableInRetainedModes(
  values: Record<string, unknown>,
  removedModeIds: Set<string>,
  removedVariableIds: Set<string>,
  consumer: string
): void {
  for (const [modeId, value] of Object.entries(values)) {
    if (!removedModeIds.has(modeId)) {
      assertNoRemovedVariable(value, removedVariableIds, consumer)
    }
  }
}

function assertModeAvailable(
  consumer: SceneNode | PageNode,
  removedCollectionIds: Set<string>,
  removedModeIds: Set<string>
): void {
  for (const [collectionId, modeId] of Object.entries(consumer.explicitVariableModes)) {
    if (removedCollectionIds.has(collectionId) || removedModeIds.has(modeId)) {
      scopeError(`Variable mode "${modeId}" is still selected on "${consumer.id}".`)
    }
  }
}

async function collectDocumentConsumers(): Promise<{
  nodes: SceneNode[]
  pages: PageNode[]
}> {
  const pages = [...figma.root.children]
  const nodes: SceneNode[] = []
  for (const page of pages) {
    try {
      await page.loadAsync()
    } catch {
      scopeError(`Page "${page.id}" could not be inspected before variable removal.`)
    }
    const pending = [...page.children]
    while (pending.length) {
      const node = pending.pop()!
      nodes.push(node)
      if ('children' in node) pending.push(...node.children)
    }
  }
  return { nodes, pages }
}

async function collectShadersForRemoval(): Promise<Shader[]> {
  try {
    return await figma.listAvailableShaders()
  } catch {
    scopeError('Shaders could not be inspected before variable removal.')
  }
}

function inspectNodeVariables(node: SceneNode, removedVariableIds: Set<string>): void {
  assertNoRemovedVariable(node.boundVariables, removedVariableIds, `node "${node.id}"`)
  const record = node as unknown as Record<string, unknown>
  for (const field of ['fills', 'strokes', 'effects', 'layoutGrids'] as const) {
    assertNoRemovedVariable(record[field], removedVariableIds, `node "${node.id}"`)
  }
  if (node.type === 'VECTOR') {
    assertNoRemovedVariable(
      node.vectorNetwork.regions,
      removedVariableIds,
      `vector regions on node "${node.id}"`
    )
  }
  if (isComponentPropertyOwner(node)) {
    assertNoRemovedVariable(
      node.componentPropertyDefinitions,
      removedVariableIds,
      `component properties on node "${node.id}"`
    )
  }
  if (node.type !== 'TEXT') return
  try {
    const segments = node.getStyledTextSegments(['boundVariables', 'fills'])
    assertNoRemovedVariable(segments, removedVariableIds, `rich text on node "${node.id}"`)
  } catch {
    scopeError(`Rich text on node "${node.id}" could not be inspected before variable removal.`)
  }
}

function modeRemovalPlan(
  state: CanvasVariableState,
  collections: VariableCollection[],
  removedCollectionIds: Set<string>
): { removals: ModeRemoval[]; removedModeIds: Set<string> } {
  const removals = state.modeRemovals.filter(
    ({ collection }) => !removedCollectionIds.has(collection.id)
  )
  const removedModeIds = new Set(removals.map(({ modeId }) => modeId))
  for (const collection of state.collectionRemovals) {
    for (const mode of collection.modes) removedModeIds.add(mode.modeId)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const collection of collections) {
      if (!collection.isExtension || removedCollectionIds.has(collection.id)) continue
      for (const mode of extendedCollection(collection).modes) {
        if (!removedModeIds.has(mode.parentModeId) || removedModeIds.has(mode.modeId)) continue
        removals.push({ collection, modeId: mode.modeId })
        removedModeIds.add(mode.modeId)
        changed = true
      }
    }
  }
  return { removals, removedModeIds }
}

function validateCollectionRemovals(
  collections: VariableCollection[],
  removedCollectionIds: Set<string>
): void {
  for (const collection of collections) {
    if (
      collection.isExtension &&
      removedCollectionIds.has(extendedCollection(collection).parentVariableCollectionId) &&
      !removedCollectionIds.has(collection.id)
    ) {
      scopeError(
        `Extended collection "${collection.id}" still depends on a collection marked for removal.`
      )
    }
  }
}

function updateModeKeys(
  collection: VariableCollection,
  modeId: string,
  state: CanvasVariableState
): number {
  const modeIds = state.modeIdsByCollection.get(collection.id)
  if (!modeIds) return 0
  const key = [...modeIds].find(([, id]) => id === modeId)?.[0]
  if (!key) return 0
  modeIds.delete(key)
  collection.setSharedPluginData(
    CANVAS_KEY_NAMESPACE,
    CANVAS_VARIABLE_MODE_KEYS_NAME,
    serializeModeIds(modeIds)
  )
  return 1
}

function collectionDepth(
  collection: VariableCollection,
  collectionsById: Map<string, VariableCollection>
): number {
  let depth = 0
  let current = collection
  const seen = new Set<string>()
  while (current.isExtension && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = collectionsById.get(extendedCollection(current).parentVariableCollectionId)
    if (!parent) break
    current = parent
    depth += 1
  }
  return depth
}

export async function removeVariableResources(
  state: CanvasVariableState,
  mutations: MutationCounter
): Promise<void> {
  if (
    !state.collectionRemovals.length &&
    !state.modeRemovals.length &&
    !state.variableRemovals.length
  ) {
    return
  }

  const [collections, variables, styles, shaders, document] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
    getLocalStyles(),
    collectShadersForRemoval(),
    collectDocumentConsumers()
  ])
  const removedCollectionIds = new Set(state.collectionRemovals.map((collection) => collection.id))
  validateCollectionRemovals(collections, removedCollectionIds)

  const removedVariableIds = new Set(state.variableRemovals.map((variable) => variable.id))
  for (const collection of state.collectionRemovals) {
    if (!collection.isExtension) {
      for (const variableId of collection.variableIds) removedVariableIds.add(variableId)
    }
  }
  const { removals: modeRemovals, removedModeIds } = modeRemovalPlan(
    state,
    collections,
    removedCollectionIds
  )
  for (const collection of collections) {
    if (removedCollectionIds.has(collection.id)) continue
    const removedCount = modeRemovals.filter(
      (removal) => removal.collection.id === collection.id
    ).length
    if (collection.modes.length === removedCount) {
      scopeError(`Variable collection "${collection.id}" must retain at least one mode.`)
    }
  }

  for (const page of document.pages) {
    assertModeAvailable(page, removedCollectionIds, removedModeIds)
    assertNoRemovedVariable(page.backgrounds, removedVariableIds, `page "${page.id}"`)
  }
  for (const node of document.nodes) {
    assertModeAvailable(node, removedCollectionIds, removedModeIds)
    inspectNodeVariables(node, removedVariableIds)
  }
  for (const style of styles) {
    assertNoRemovedVariable(style.boundVariables, removedVariableIds, `style "${style.id}"`)
    if (style.type === 'PAINT') {
      assertNoRemovedVariable(style.paints, removedVariableIds, `style "${style.id}"`)
    } else if (style.type === 'EFFECT') {
      assertNoRemovedVariable(style.effects, removedVariableIds, `style "${style.id}"`)
    } else if (style.type === 'GRID') {
      assertNoRemovedVariable(style.layoutGrids, removedVariableIds, `style "${style.id}"`)
    }
  }
  for (const variable of variables) {
    if (removedVariableIds.has(variable.id)) continue
    assertNoRemovedVariableInRetainedModes(
      variable.valuesByMode,
      removedModeIds,
      removedVariableIds,
      `variable "${variable.id}"`
    )
  }
  for (const collection of collections) {
    if (!collection.isExtension || removedCollectionIds.has(collection.id)) continue
    for (const [variableId, values] of Object.entries(
      extendedCollection(collection).variableOverrides
    )) {
      if (removedVariableIds.has(variableId)) continue
      assertNoRemovedVariableInRetainedModes(
        values,
        removedModeIds,
        removedVariableIds,
        `extended collection "${collection.id}"`
      )
    }
  }
  for (const shader of shaders) {
    assertNoRemovedVariable(shader.propertyDefinitions, removedVariableIds, `shader "${shader.id}"`)
  }

  for (const variable of state.variableRemovals) {
    for (const collection of collections) {
      if (!collection.isExtension || removedCollectionIds.has(collection.id)) continue
      const extended = extendedCollection(collection)
      if (extended.variableOverrides[variable.id] === undefined) continue
      extended.removeOverridesForVariable(variable)
      mutations.count += 1
    }
  }
  for (const { collection, modeId } of modeRemovals) {
    collection.removeMode(modeId)
    mutations.count += 1 + updateModeKeys(collection, modeId, state)
  }
  for (const variable of state.variableRemovals) {
    variable.remove()
    mutations.count += 1
  }
  const collectionsById = new Map(collections.map((collection) => [collection.id, collection]))
  const collectionRemovals = [...state.collectionRemovals].sort(
    (left, right) =>
      collectionDepth(right, collectionsById) - collectionDepth(left, collectionsById)
  )
  for (const collection of collectionRemovals) {
    collection.remove()
    mutations.count += 1
  }
}
