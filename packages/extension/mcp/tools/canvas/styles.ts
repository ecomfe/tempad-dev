import type { CanvasStyleReference, CanvasStyleResource, CanvasStyles } from '@tempad-dev/shared'

import { getLocalStyles } from '../../local-styles'
import { scopeError, specError } from './errors'
import {
  CANVAS_STYLE_KEY_NAME,
  type MutationCounter,
  claimAuthoringKey,
  designReferenceCacheKey,
  readAuthoringKey
} from './identity'

type CanvasStyleResourceState = {
  key: string
  spec: CanvasStyleResource
  style: BaseStyle
}

export type CanvasStyleState = {
  byKey: Map<string, BaseStyle>
  cache: Map<string, BaseStyle>
  indexed: boolean
  removals: Array<{ key: string; style: BaseStyle }>
  resources: CanvasStyleResourceState[]
}

function indexStyle(styles: Map<string, BaseStyle>, key: string, style: BaseStyle): void {
  const existing = styles.get(key)
  if (existing && existing.id !== style.id) {
    specError(`Style key "${key}" identifies more than one local style.`)
  }
  styles.set(key, style)
}

async function ensureLocalIndex(state: CanvasStyleState): Promise<void> {
  if (state.indexed) return
  state.indexed = true
  const styles = await getLocalStyles()
  for (const style of styles) {
    state.cache.set(`id:${style.id}`, style)
    if (style.key) state.cache.set(`key:${style.key}`, style)
    const key = readAuthoringKey(style, CANVAS_STYLE_KEY_NAME)
    if (key) indexStyle(state.byKey, key, style)
  }
}

function createStyle(type: StyleType): BaseStyle {
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

async function selectStyle(
  key: string,
  spec: CanvasStyleResource,
  state: CanvasStyleState,
  mutations: MutationCounter
): Promise<BaseStyle> {
  const keyed = state.byKey.get(key)
  const explicit = spec.id ? await figma.getStyleByIdAsync(spec.id) : null
  if (spec.id && !explicit) specError(`Style "${spec.id}" does not exist.`)
  if (keyed && explicit && keyed.id !== explicit.id) {
    specError(`Style key "${key}" does not identify "${explicit.id}".`)
  }
  let style = explicit ?? keyed
  if (!style) {
    if (!spec.name) specError(`New ${spec.type} style "${key}" requires a name.`)
    style = createStyle(spec.type)
    mutations.count += 1
  }
  if (style.remote) specError(`Style "${style.id}" is not an editable local style.`)
  if (style.type !== spec.type) {
    specError(`Style "${style.id}" is ${style.type}, expected ${spec.type}.`)
  }
  claimAuthoringKey(style, key, CANVAS_STYLE_KEY_NAME, 'Style', mutations)
  indexStyle(state.byKey, key, style)
  state.cache.set(`id:${style.id}`, style)
  if (style.key) state.cache.set(`key:${style.key}`, style)
  return style
}

export function createStyleState(): CanvasStyleState {
  return {
    byKey: new Map(),
    cache: new Map(),
    indexed: false,
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
  await ensureLocalIndex(state)
  for (const [key, spec] of Object.entries(specs)) {
    if (spec === null) {
      const style = state.byKey.get(key)
      if (style) state.removals.push({ key, style })
      continue
    }
    state.resources.push({
      key,
      spec,
      style: await selectStyle(key, spec, state, mutations)
    })
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
      ? await figma.getStyleByIdAsync(reference.id)
      : await figma.importStyleByKeyAsync(reference.key)
  if (!style) specError('The requested style could not be resolved.')
  state.cache.set(cacheKey, style)
  return style
}
