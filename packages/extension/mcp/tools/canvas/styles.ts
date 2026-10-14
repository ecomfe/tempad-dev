import type { CanvasStyleReference, CanvasStyleResource, CanvasStyles } from '@tempad-dev/shared'

import { getLocalStyles, getStyleById } from '../../local-resources'
import { scopeError, specError } from './errors'
import {
  CANVAS_STYLE_KEY_NAME,
  type MutationCounter,
  assertAuthoringKey,
  claimAuthoringKey,
  designReferenceCacheKey,
  readAuthoringKey
} from './identity'

type CanvasStyleResourceState = {
  key: string
  spec: CanvasStyleResource
  style: BaseStyle
}

type StyleSelection = {
  key: string
  spec: CanvasStyleResource | null
  style: BaseStyle | undefined
}

export type CanvasStyleState = {
  byKey: Map<string, BaseStyle>
  cache: Map<string, BaseStyle>
  createdStyleKeys: Set<string>
  indexing?: Promise<void>
  removals: Array<{ key: string; style: BaseStyle }>
  resources: CanvasStyleResourceState[]
  selections?: StyleSelection[]
}

function indexStyle(styles: Map<string, BaseStyle>, key: string, style: BaseStyle): void {
  const existing = styles.get(key)
  if (existing && existing.id !== style.id) {
    specError(`Style key "${key}" identifies more than one local style.`)
  }
  styles.set(key, style)
}

async function ensureLocalIndex(state: CanvasStyleState): Promise<void> {
  state.indexing ??= (async () => {
    const styles = await getLocalStyles()
    const byKey = new Map<string, BaseStyle>()
    for (const style of styles) {
      const key = readAuthoringKey(style, CANVAS_STYLE_KEY_NAME)
      if (key) indexStyle(byKey, key, style)
    }
    for (const style of styles) {
      state.cache.set(`id:${style.id}`, style)
      if (style.key) state.cache.set(`key:${style.key}`, style)
    }
    for (const [key, style] of byKey) state.byKey.set(key, style)
  })().catch((error: unknown) => {
    state.indexing = undefined
    throw error
  })
  await state.indexing
}

function createStyle(type: CanvasStyleResource['type']): BaseStyle {
  switch (type) {
    case 'PAINT':
      return figma.createPaintStyle()
    case 'TEXT':
      return figma.createTextStyle()
    case 'EFFECT':
      return figma.createEffectStyle()
    case 'GRID':
      return figma.createGridStyle()
  }
}

async function locateStyle(
  key: string,
  spec: CanvasStyleResource,
  state: CanvasStyleState
): Promise<BaseStyle | undefined> {
  const keyed = state.byKey.get(key)
  const explicit = spec.id ? await getStyleById(spec.id) : null
  if (spec.id && !explicit) specError(`Style "${spec.id}" does not exist.`)
  if (keyed && explicit && keyed.id !== explicit.id) {
    specError(`Style key "${key}" does not identify "${explicit.id}".`)
  }
  const style = explicit ?? keyed
  if (!style) {
    if (!spec.name) specError(`New ${spec.type} style "${key}" requires a name.`)
    return undefined
  }
  if (style.remote) specError(`Style "${style.id}" is not an editable local style.`)
  if (style.type !== spec.type) {
    specError(`Style "${style.id}" is ${style.type}, expected ${spec.type}.`)
  }
  return style
}

export async function preflightStyleDeclarations(
  specs: CanvasStyles | undefined,
  state: CanvasStyleState
): Promise<void> {
  if (!specs) return
  await ensureLocalIndex(state)
  const selections: StyleSelection[] = []
  const claims = new Map<string, string>()
  for (const [key, spec] of Object.entries(specs)) {
    const style = spec === null ? state.byKey.get(key) : await locateStyle(key, spec, state)
    if (style && spec !== null) {
      const current = claims.get(style.id) ?? readAuthoringKey(style, CANVAS_STYLE_KEY_NAME)
      assertAuthoringKey(style.id, key, current, 'Style')
      claims.set(style.id, key)
    }
    selections.push({ key, spec, style })
  }
  state.selections = selections
}

export function createStyleState(): CanvasStyleState {
  return {
    byKey: new Map(),
    cache: new Map(),
    createdStyleKeys: new Set(),
    removals: [],
    resources: []
  }
}

export async function prepareStyleResources(
  specs: CanvasStyles | undefined,
  state: CanvasStyleState,
  mutations: MutationCounter
): Promise<void> {
  if (!specs) return
  if (!state.selections) await preflightStyleDeclarations(specs, state)
  for (const { key, spec, style: selected } of state.selections ?? []) {
    if (spec === null) {
      if (selected) state.removals.push({ key, style: selected })
      continue
    }
    const style = selected ?? createStyle(spec.type)
    if (!selected) {
      mutations.count += 1
      state.createdStyleKeys.add(key)
    }
    claimAuthoringKey(style, key, CANVAS_STYLE_KEY_NAME, 'Style', mutations)
    indexStyle(state.byKey, key, style)
    state.cache.set(`id:${style.id}`, style)
    if (style.key) state.cache.set(`key:${style.key}`, style)
    state.resources.push({ key, spec, style })
  }
}

export async function removeStyleResources(
  state: CanvasStyleState,
  mutations: MutationCounter
): Promise<void> {
  for (const { key, style } of state.removals) {
    const consumer = (await style.getStyleConsumersAsync())[0]
    if (consumer) {
      scopeError(
        `Style "${key}" is still used by node "${consumer.node.id}" in ${consumer.fields.join(', ')}.`
      )
    }
  }
  for (const { style } of state.removals) {
    style.remove()
    mutations.count += 1
  }
}

export async function resolveStyle(
  reference: CanvasStyleReference,
  state: CanvasStyleState
): Promise<BaseStyle> {
  if ('styleKey' in reference) {
    await ensureLocalIndex(state)
    const style = state.byKey.get(reference.styleKey)
    if (!style) specError(`Style key "${reference.styleKey}" could not be resolved.`)
    return style
  }
  const cacheKey = designReferenceCacheKey(reference)
  const cached = state.cache.get(cacheKey)
  if (cached) return cached
  const style =
    reference.id !== undefined
      ? await getStyleById(reference.id)
      : await figma.importStyleByKeyAsync(reference.key)
  if (!style) specError('The requested style could not be resolved.')
  state.cache.set(cacheKey, style)
  return style
}
