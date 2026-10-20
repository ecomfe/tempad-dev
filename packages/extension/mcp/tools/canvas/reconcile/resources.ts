import type {
  CanvasHyperlink,
  CanvasFigmaShaderPropertyValue,
  CanvasVariableReference,
  CanvasFigmaEffect,
  CanvasFigmaPaint,
  CanvasVariableBindings,
  CanvasFigmaLayoutGrid,
  CanvasStyleBindings,
  CanvasStyleResource,
  CanvasStyleReference
} from '@tempad-dev/shared'

import type { CanvasNodeSpec, ParsedCanvasTreeInput } from '../model'
import type { ApplyState, SupportedCanvasNode } from './state'

import { specError } from '../errors'
import { loadFont, loadFonts, currentTextFonts } from '../fonts'
import { readOwnedNodeKey } from '../identity'
import { collectCanvasMedia, importCanvasMedia } from '../media'
import {
  resolveStyle,
  preflightStyleDeclarations,
  prepareStyleResources,
  removeStyleResources
} from '../styles'
import {
  resolveVariable,
  resolveCollection,
  resolveModeId,
  resolvedVariable,
  preflightVariableDeclarations,
  reconcileVariableCollections,
  removeVariableResources
} from '../variables'
import { canonicalVectorPaths } from '../vector'
import { preflightShadowSpread } from './appearance'
import {
  validateVariableDataType,
  validateStyleType,
  currentBoundVariableId,
  validateVariableType,
  STYLE_TYPES
} from './binding-values'
import {
  isRecord,
  isVariableBinding,
  nativeValueEqual,
  textMeasuresEqual,
  fontNamesEqual
} from './comparison'
import {
  type ComponentPropertyContext,
  preflightComponentState,
  type ComponentPreflightResources,
  resolveComponent,
  componentPropertyOwner
} from './components'
import {
  nativePaint,
  paintStacksEqual,
  nativeEffect,
  effectsEqual,
  nativeLayoutGrid,
  layoutGridsEqual
} from './native-values'
import { isSceneNode, lookupNodeById, findExistingNode } from './nodes'
import {
  textStyleVariableEntries,
  loadTextStyleVariableFonts,
  preflightTextFont,
  type TextStyleResource,
  TEXT_STYLE_VALUE_FIELDS,
  TEXT_STYLE_VARIABLES_BY_VALUE
} from './text-fonts'
import { rangeHasSemanticTextOverrides } from './text-range-style'
import { protectNode } from './undo'

type CanvasNodeReference = { nodeId: string } | { canvasKey: string }

function preflightRetainedNode(node: BaseNode, state: ApplyState): void {
  for (let ancestor: BaseNode | null = node; ancestor; ancestor = ancestor.parent) {
    if (state.removalNodeIds.has(ancestor.id)) {
      specError(`Referenced node "${node.id}" would be removed by this result.`)
    }
    // A desired ancestor can carry this reference out of a removed subtree.
    if (
      state.explicitNodes.has(ancestor.id) ||
      (isSceneNode(ancestor) && state.desiredKeys.has(readOwnedNodeKey(ancestor) ?? ''))
    )
      return
  }
}

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
    const existing = state.keyedNodes.get(reference.canvasKey)
    if (existing) preflightRetainedNode(existing, state)
    return
  }
  const node = await lookupNodeById(reference.nodeId)
  if (!node || (sceneOnly && !isSceneNode(node))) {
    specError(
      `${context} "${reference.nodeId}" does not exist${sceneOnly ? ' or is not a scene node' : ''}.`
    )
  }
  preflightRetainedNode(node, state)
  protectNode(state, node)
  state.referencedNodeIds.add(node.id)
}

async function preflightHyperlink(
  hyperlink: CanvasHyperlink | undefined,
  key: string,
  state: ApplyState
): Promise<void> {
  if (hyperlink?.type !== 'NODE') return
  await preflightNodeReference(
    typeof hyperlink.value === 'string'
      ? { nodeId: hyperlink.value }
      : { canvasKey: hyperlink.value.canvasKey },
    `Hyperlink target on "${key}"`,
    state
  )
}

export async function resolveShader(id: string, state: ApplyState): Promise<Shader> {
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

function collectShaderVariableReferences(
  value: CanvasFigmaShaderPropertyValue,
  references: CanvasVariableReference[]
): void {
  if (!isRecord(value)) return
  if (isVariableBinding(value)) {
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
  if (isVariableBinding(value)) return true
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
        validateVariableDataType(variable, expected, `effect ${index} ${field} on "${key}"`)
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
  validateVariableDataType(variable, 'COLOR', `${field} paint ${index} on "${key}"`)
}

function paintColorVariables(paint: CanvasFigmaPaint): CanvasVariableReference[] {
  if (paint.type === 'SOLID' && paint.variables) return [paint.variables.color]
  if ('gradientStops' in paint) {
    return paint.gradientStops.flatMap((stop) => (stop.variables ? [stop.variables.color] : []))
  }
  return []
}

async function preflightPaintSource(
  paint: CanvasFigmaPaint,
  field: string,
  index: number,
  key: string,
  state: ApplyState
): Promise<void> {
  if (paint.type === 'IMAGE') {
    if (paint.imageUrl !== undefined) {
      if (!state.media.imageUrls.has(paint.imageUrl)) {
        state.media.imageUrls.set(paint.imageUrl, `${field} paint ${index} on "${key}"`)
      }
    } else if (paint.assetKey !== undefined) {
      state.media.imageAssetKeys.add(paint.assetKey)
    } else if (paint.imageHash && !figma.getImageByHash(paint.imageHash)) {
      specError(
        `Image "${paint.imageHash}" for ${field} paint ${index} on "${key}" does not exist.`
      )
    }
  }
  if (paint.type === 'VIDEO' && paint.videoUrl !== undefined) {
    state.media.videoUrls.add(paint.videoUrl)
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
}

async function preflightPaintStack(
  paints: CanvasFigmaPaint[] | undefined,
  field: string,
  key: string,
  state: ApplyState
): Promise<void> {
  for (const [index, paint] of (paints ?? []).entries()) {
    for (const reference of paintColorVariables(paint))
      await preflightPaintVariable(reference, field, index, key, state)
    await preflightPaintSource(paint, field, index, key, state)
    if (paint.type === 'SHADER') {
      await preflightShader(paint.id, paint.properties, 'fill', key, state)
    }
  }
}

async function preflightPaints(spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  await preflightPaintStack(spec.figma?.fills, 'fill', spec.key, state)
  await preflightPaintStack(spec.figma?.strokes, 'stroke', spec.key, state)
}

export function preflightVectorPaths(spec: CanvasNodeSpec): void {
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
}

async function preflightVector(spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  const shape = spec.figma?.shape
  if (shape?.type !== 'VECTOR') return
  for (const [index, region] of (shape.network?.regions ?? []).entries()) {
    await preflightPaintStack(region.fills, `vector region ${index} fill`, spec.key, state)
    if (!region.fillStyle) continue
    const style = await resolveStyle(region.fillStyle, state.styles)
    validateStyleType('fill', style, spec.key)
  }
}

function preflightTextRangeBounds(spec: CanvasNodeSpec, state: ApplyState): void {
  for (const range of spec.figma?.text?.ranges ?? []) {
    const existing = findExistingNode(spec, state)
    if (
      spec.text &&
      !spec.variables?.characters &&
      !(existing && currentBoundVariableId(existing, 'characters')) &&
      range.end > spec.text.characters.length
    ) {
      specError(
        `Text range ${range.start}:${range.end} on "${spec.key}" exceeds ${spec.text.characters.length} UTF-16 code units.`
      )
    }
  }
}

async function preflightTextRanges(spec: CanvasNodeSpec, state: ApplyState): Promise<void> {
  preflightTextRangeBounds(spec, state)
  const existing = findExistingNode(spec, state)
  for (const [index, range] of (spec.figma?.text?.ranges ?? []).entries()) {
    if (
      existing?.type === 'TEXT' &&
      range.end <= existing.characters.length &&
      spec.text?.characters === existing.characters
    ) {
      rangeHasSemanticTextOverrides(existing, range, state)
    }
    const key = `${spec.key} text range ${index}`
    if (range.fontName) await loadFont(range.fontName, state.fonts)
    for (const [field, reference] of [
      ['text', range.textStyle],
      ['fill', range.fillStyle]
    ] as const) {
      if (!reference) continue
      const style = await resolveStyle(reference, state.styles)
      validateStyleType(field, style, key)
      if (style.type === 'TEXT') await loadFont(style.fontName, state.fonts)
    }
    for (const [field, reference] of Object.entries(range.variables ?? {}) as Array<
      [keyof CanvasVariableBindings, CanvasVariableReference | null]
    >) {
      if (!reference) continue
      validateVariableType(field, await resolveVariable(reference, state.variables), key)
    }
    await preflightHyperlink(range.hyperlink, key, state)
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
      validateVariableDataType(variable, 'FLOAT', `layout grid ${index} ${field} on "${key}"`)
    }
  }
}

function preflightStylePatternSources(
  paints: CanvasFigmaPaint[] | undefined,
  key: string,
  state: ApplyState
): void {
  for (const paint of paints ?? []) {
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
}

async function preflightStyleResources(state: ApplyState): Promise<void> {
  for (const { key, spec, style } of state.styles.resources) {
    switch (spec.type) {
      case 'PAINT':
        preflightStylePatternSources(spec.paints, key, state)
        await preflightPaintStack(spec.paints, 'style', key, state)
        break
      case 'TEXT':
        if (style.type === 'TEXT') await loadFont(style.fontName, state.fonts)
        if (spec.fontName) await loadFont(spec.fontName, state.fonts)
        for (const [field, reference] of textStyleVariableEntries(spec)) {
          if (!reference) continue
          validateVariableType(
            field as keyof CanvasVariableBindings,
            await resolveVariable(reference, state.variables),
            key
          )
        }
        if (style.type === 'TEXT') await loadTextStyleVariableFonts(style, spec, state)
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

export async function preflightVariableModes(
  modes: CanvasNodeSpec['variableModes'],
  state: ApplyState
): Promise<void> {
  for (const [collectionId, modeId] of Object.entries(modes ?? {})) {
    const collection = await resolveCollection(collectionId, state.variables)
    if (modeId !== null) await resolveModeId(collection, modeId, state.variables)
  }
}

export async function preflightResources(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing?: SupportedCanvasNode,
  inheritedComponent?: ComponentPropertyContext
): Promise<void> {
  preflightShadowSpread(spec, existing)
  if (existing?.type === 'TEXT') await loadFonts(currentTextFonts(existing), state.fonts)
  const component = await preflightComponentState(spec, state, existing, inheritedComponent)
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
      if (style.type === 'TEXT') await loadFont(style.fontName, state.fonts)
    }
  }
  await preflightTextFont(spec, state, existing)
  await preflightHyperlink(spec.figma?.text?.hyperlink, spec.key, state)
  await preflightPaints(spec, state)
  await preflightVector(spec, state)
  await preflightTextRanges(spec, state)
  await preflightEffects(spec.figma?.effects, spec.key, state)
  await preflightLayoutGrids(spec.figma?.layoutGrids, spec.key, state)
  for (const child of spec.children ?? []) {
    await preflightResources(child, state, findExistingNode(child, state) ?? undefined, component)
  }
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
      )
    ) {
      continue
    }
    const equal =
      field === 'fontName'
        ? fontNamesEqual(style.fontName, spec.fontName!)
        : field === 'lineHeight' || field === 'letterSpacing'
          ? textMeasuresEqual(field, style[field], spec[field]!)
          : nativeValueEqual(style[field], desired)
    if (equal) continue
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

export function applyStyleResources(state: ApplyState): void {
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

type ResourceInput = Pick<ParsedCanvasTreeInput, 'variableCollections' | 'styles'>

export function hasDeclaredResources(input: ResourceInput): boolean {
  return (
    Object.keys(input.variableCollections ?? {}).length > 0 ||
    Object.keys(input.styles ?? {}).length > 0
  )
}

export async function preflightDeclaredResources(
  specs: Iterable<CanvasNodeSpec>,
  input: ResourceInput,
  state: ApplyState
): Promise<void> {
  const nodes = [...specs]
  const specsByKey = new Map(nodes.map((spec) => [spec.key, spec]))
  const componentContexts = new Map<CanvasNodeSpec, ComponentPropertyContext | undefined>()
  await preflightStyleDeclarations(input.styles, state.styles)
  for (const { spec, style } of state.styles.selections ?? []) {
    if (spec !== null && style?.type === 'TEXT') await loadFont(style.fontName, state.fonts)
  }
  const declaredVariables = await preflightVariableDeclarations(
    input.variableCollections,
    state.variables
  )
  async function knownVariable(reference: CanvasVariableReference) {
    // Key-only library references can import resources; keep those in the full preflight.
    if (!('variableKey' in reference) && reference.id === undefined) return
    return (
      ('variableKey' in reference ? declaredVariables.get(reference.variableKey) : undefined) ??
      (await resolveVariable(reference, state.variables))
    )
  }
  const componentResources: ComponentPreflightResources = {
    variable: knownVariable,
    component: (reference) => resolveComponent(reference, state)
  }
  async function preflightDeclaredPaints(
    paints: CanvasFigmaPaint[] | undefined,
    field: string,
    key: string
  ) {
    for (const [index, paint] of (paints ?? []).entries()) {
      for (const reference of paintColorVariables(paint)) {
        const variable = await knownVariable(reference)
        if (variable)
          validateVariableDataType(variable, 'COLOR', `${field} paint ${index} on "${key}"`)
      }
      await preflightPaintSource(paint, field, index, key, state)
    }
  }
  async function preflightEffectVariables(effects: CanvasFigmaEffect[] | undefined, key: string) {
    for (const [index, effect] of (effects ?? []).entries()) {
      if (!('variables' in effect)) continue
      for (const [field, reference] of Object.entries(effect.variables ?? {})) {
        const variable = await knownVariable(reference)
        if (variable)
          validateVariableDataType(
            variable,
            field === 'color' ? 'COLOR' : 'FLOAT',
            `effect ${index} ${field} on "${key}"`
          )
      }
    }
  }
  async function preflightGridVariables(grids: CanvasFigmaLayoutGrid[] | undefined, key: string) {
    for (const [index, grid] of (grids ?? []).entries()) {
      for (const [field, reference] of Object.entries(grid.variables ?? {})) {
        const variable = await knownVariable(reference)
        if (variable)
          validateVariableDataType(variable, 'FLOAT', `layout grid ${index} ${field} on "${key}"`)
      }
    }
  }
  async function preflightBindings(
    key: string,
    variables: CanvasVariableBindings | undefined,
    styles: CanvasStyleBindings | undefined
  ): Promise<void> {
    for (const [field, reference] of Object.entries(variables ?? {}) as Array<
      [keyof CanvasVariableBindings, CanvasVariableReference | null]
    >) {
      if (!reference) continue
      const variable = await knownVariable(reference)
      if (variable) validateVariableType(field, variable, key)
    }
    for (const [field, reference] of Object.entries(styles ?? {}) as Array<
      [keyof CanvasStyleBindings, CanvasStyleReference | null]
    >) {
      if (!reference) continue
      const declared = 'styleKey' in reference ? input.styles?.[reference.styleKey] : undefined
      if (declared) {
        if (declared.type !== STYLE_TYPES[field]) {
          specError(
            `Declared style for ${field} on "${key}" has incompatible type ${declared.type}.`
          )
        }
        continue
      }
      if (!('styleKey' in reference) && reference.id === undefined) continue
      const style = await resolveStyle(reference, state.styles)
      validateStyleType(field, style, key)
      if (style.type === 'TEXT') await loadFont(style.fontName, state.fonts)
    }
  }
  for (const [key, style] of Object.entries(input.styles ?? {})) {
    if (style?.type === 'TEXT') {
      if (style.fontName) await loadFont(style.fontName, state.fonts)
      await preflightBindings(key, style.variables, undefined)
    }
    if (style?.type === 'PAINT') {
      preflightStylePatternSources(style.paints, key, state)
      await preflightDeclaredPaints(style.paints, 'style', key)
    }
    if (style?.type === 'EFFECT') await preflightEffectVariables(style.effects, key)
    if (style?.type === 'GRID') await preflightGridVariables(style.layoutGrids, key)
  }
  if (Object.keys(input.variableCollections ?? {}).length === 0) {
    for (const { spec, style } of state.styles.selections ?? []) {
      if (spec?.type !== 'TEXT' || style?.type !== 'TEXT') continue
      const importsFontVariable = TEXT_STYLE_VARIABLES_BY_VALUE.fontName.some((field) => {
        const reference = spec.variables?.[field]
        return reference && !('variableKey' in reference) && reference.id === undefined
      })
      if (importsFontVariable) continue
      // Existing consumer modes are ready to read when no variable declarations
      // or library imports can change their fonts. The full preflight rechecks them.
      await loadTextStyleVariableFonts(style, spec, state)
    }
  }
  for (const spec of nodes) {
    preflightTextRangeBounds(spec, state)
    const existing = findExistingNode(spec, state)
    const owner = existing ? componentPropertyOwner(existing) : null
    // Tree children inherit the desired context; native-only patches use their live owner.
    const inherited = componentContexts.has(spec)
      ? componentContexts.get(spec)
      : owner
        ? { existing: owner, spec: specsByKey.get(readOwnedNodeKey(owner) ?? '') }
        : undefined
    const component = await preflightComponentState(
      spec,
      state,
      existing ?? undefined,
      inherited,
      componentResources
    )
    for (const child of spec.children ?? []) componentContexts.set(child, component)
    preflightShadowSpread(spec, existing ?? undefined)
    if (existing?.type === 'TEXT') await loadFonts(currentTextFonts(existing), state.fonts)
    await preflightBindings(spec.key, spec.variables, spec.styles)
    const hasBoundFont =
      spec.variables?.fontFamily ||
      spec.variables?.fontStyle ||
      (existing?.type === 'TEXT' &&
        (currentBoundVariableId(existing, 'fontFamily') ||
          currentBoundVariableId(existing, 'fontStyle')))
    // Same-call variable declarations can change the bound half of a literal font pair.
    // Resolve that pair in the full preflight, after those values have been applied.
    if (!hasBoundFont) await preflightTextFont(spec, state, existing ?? undefined)
    await preflightHyperlink(spec.figma?.text?.hyperlink, spec.key, state)
    await preflightDeclaredPaints(spec.figma?.fills, 'fill', spec.key)
    await preflightDeclaredPaints(spec.figma?.strokes, 'stroke', spec.key)
    await preflightEffectVariables(spec.figma?.effects, spec.key)
    await preflightGridVariables(spec.figma?.layoutGrids, spec.key)
    if (spec.figma?.shape?.type === 'VECTOR') {
      for (const [index, region] of (spec.figma.shape.network?.regions ?? []).entries()) {
        await preflightBindings(spec.key, undefined, { fill: region.fillStyle })
        await preflightDeclaredPaints(region.fills, `vector region ${index} fill`, spec.key)
      }
    }
    for (const [index, range] of (spec.figma?.text?.ranges ?? []).entries()) {
      if (range.fontName) await loadFont(range.fontName, state.fonts)
      await preflightBindings(`${spec.key} text range ${index}`, range.variables, {
        text: range.textStyle,
        fill: range.fillStyle
      })
      await preflightHyperlink(range.hyperlink, `${spec.key} text range ${index}`, state)
      await preflightDeclaredPaints(range.fills, `text range ${index} fill`, spec.key)
      if (range.textDecorationColor && range.textDecorationColor.value !== 'AUTO') {
        await preflightDeclaredPaints(
          [range.textDecorationColor.value],
          `text range ${index} decoration`,
          spec.key
        )
      }
    }
  }
}

export async function prepareResources(input: ResourceInput, state: ApplyState): Promise<void> {
  await reconcileVariableCollections(input.variableCollections, state.variables, state.mutations)
  await prepareStyleResources(input.styles, state.styles, state.mutations)
  await preflightStyleResources(state)
}

export async function prepareMedia(
  specs: Iterable<CanvasNodeSpec>,
  input: ResourceInput,
  state: ApplyState
): Promise<void> {
  for (const spec of specs) collectCanvasMedia(spec.figma, `node "${spec.key}"`, state.media)
  collectCanvasMedia(input.styles, 'styles', state.media)
  await importCanvasMedia(state.media)
}

export async function removeResources(state: ApplyState): Promise<void> {
  await removeStyleResources(state.styles, state.mutations)
  await removeVariableResources(state.variables, state.mutations)
}
