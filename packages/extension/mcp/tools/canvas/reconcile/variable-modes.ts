import type { CanvasPageProperties } from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { getVariableCollectionById } from '../../../local-resources'
import { specError, scopeError, errorMessage } from '../errors'
import { loadFonts, currentTextFonts, loadFont, resolveFamilyFont } from '../fonts'
import { resolveStyle } from '../styles'
import { walkPhysicalNodes } from '../traversal'
import { resolveVariable, resolvedCollection, resolvedModeId } from '../variables'
import { SIZE_BOUND_FIELDS } from './layout'
import { type ApplyState, type SupportedCanvasNode, markMutation } from './state'
import { TEXT_STYLE_VARIABLES_BY_VALUE } from './text-fonts'

type FontModeValues = { values: VariableValue[]; optional: boolean; affected: boolean }

const TEXT_MODE_FONT_FIELDS = [
  'characters',
  'width',
  'height',
  ...SIZE_BOUND_FIELDS,
  ...Object.values(TEXT_STYLE_VARIABLES_BY_VALUE).flat()
] as const

async function modeFontCollection(
  id: string,
  state: ApplyState,
  missingCollections: Set<string>
): Promise<VariableCollection | null> {
  const key = `id:${id}`
  const cached = state.variables.collectionCache.get(key)
  if (cached) return cached
  if (missingCollections.has(id)) return null
  const collection = await getVariableCollectionById(id)
  if (collection) state.variables.collectionCache.set(key, collection)
  else missingCollections.add(id)
  return collection
}

async function modeFontVariableValues(
  variable: Variable,
  consumer: TextNode,
  target: SupportedCanvasNode | PageNode,
  changedCollectionId: string,
  changedModeId: string | undefined,
  state: ApplyState,
  missingCollections: Set<string>,
  cache = new Map<string, FontModeValues>(),
  seen = new Set<string>()
): Promise<FontModeValues> {
  if (seen.has(variable.id) || seen.size >= 64) {
    specError('Text variable aliases contain a cycle or exceed 64 levels.')
  }
  const cached = cache.get(variable.id)
  if (cached) return cached
  const active = new Set(seen).add(variable.id)
  const base = await modeFontCollection(variable.variableCollectionId, state, missingCollections)
  if (!base)
    scopeError(`Text variable collection "${variable.variableCollectionId}" is unavailable.`)
  const related = new Map<string, VariableCollection>([[base.id, base]])
  const ancestors: BaseNode[] = []
  const candidateIds = new Set([
    changedCollectionId,
    ...Object.keys(consumer.resolvedVariableModes ?? {})
  ])
  for (let ancestor: BaseNode | null = consumer; ancestor; ancestor = ancestor.parent) {
    ancestors.push(ancestor)
    if ('explicitVariableModes' in ancestor) {
      for (const id of Object.keys(ancestor.explicitVariableModes)) candidateIds.add(id)
    }
  }
  for (const id of candidateIds) {
    if (related.has(id)) continue
    const collection = await modeFontCollection(id, state, missingCollections)
    if (collection?.isExtension && collection.variableIds.includes(variable.id))
      related.set(id, collection)
  }
  let selected: Array<[string, string]> = []
  let affected = false
  for (const ancestor of ancestors) {
    const explicit =
      'explicitVariableModes' in ancestor ? { ...ancestor.explicitVariableModes } : {}
    if (ancestor === target) {
      affected = related.has(changedCollectionId) && explicit[changedCollectionId] !== changedModeId
      delete explicit[changedCollectionId]
      if (changedModeId !== undefined) explicit[changedCollectionId] = changedModeId
    }
    selected = Object.entries(explicit).filter(([id]) => related.has(id))
    if (selected.length) break
  }
  if (!selected.length) {
    // An unaffected consumer or the parent above a cleared override exposes native
    // Auto resolution. Page Auto has no such reader: preload candidates, don't guess.
    const context = related.has(changedCollectionId) ? target.parent : consumer
    if (context && 'resolvedVariableModes' in context) {
      selected = Object.entries(context.resolvedVariableModes).filter(([id]) => related.has(id))
    }
  }
  let optional = selected.length !== 1
  const candidates: VariableValue[] = []
  for (const collection of related.values()) {
    const modes = selected.filter(([id]) => id === collection.id).map(([, mode]) => mode)
    if (selected.length && !modes.length) continue
    const values =
      collection.id === base.id
        ? variable.valuesByMode
        : await variable.valuesByModeForCollectionAsync(collection)
    const modeValues = modes.length ? modes.map((mode) => values[mode]) : Object.values(values)
    for (const value of modeValues) {
      if (value === undefined)
        scopeError(`Text variable "${variable.id}" has no value for the selected mode.`)
      if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
        const alias = await modeFontVariableValues(
          await resolveVariable({ id: value.id }, state.variables),
          consumer,
          target,
          changedCollectionId,
          changedModeId,
          state,
          missingCollections,
          cache,
          active
        )
        candidates.push(...alias.values)
        optional ||= alias.optional
        affected ||= alias.affected
      } else candidates.push(value)
    }
  }
  const values = [...new Set(candidates)]
  if (values.length > 64 || cache.size >= 256)
    scopeError('Font mode preloading exceeds the bounded candidate budget.')
  const result = { values, optional, affected }
  cache.set(variable.id, result)
  return result
}

async function loadModeFonts(
  target: SupportedCanvasNode | PageNode,
  collectionId: string,
  modeId: string | undefined,
  state: ApplyState
): Promise<void> {
  const roots = target.type === 'PAGE' ? target.children : [target]
  // Only misses are scan-local: later imports can expose previously unavailable collections.
  const missingCollections = new Set<string>()
  for (const node of walkPhysicalNodes(roots)) {
    if (node.type !== 'TEXT') continue
    const cache = new Map<string, FontModeValues>()
    const segments = node.getStyledTextSegments(['fontName', 'textStyleId', 'boundVariables'])
    for (const segment of segments) {
      const style = segment.textStyleId
        ? await resolveStyle({ id: segment.textStyleId }, state.styles)
        : undefined
      const bindings = {
        ...node.boundVariables,
        ...(style?.type === 'TEXT' ? style.boundVariables : {}),
        ...segment.boundVariables
      }
      const values = new Map<string, FontModeValues>()
      for (const field of TEXT_MODE_FONT_FIELDS) {
        const reference = bindings[field]
        // Mixed node bindings are arrays; segment aliases identify the actual run.
        if (!reference || Array.isArray(reference)) continue
        try {
          values.set(
            field,
            await modeFontVariableValues(
              await resolveVariable({ id: reference.id }, state.variables),
              node,
              target,
              collectionId,
              modeId,
              state,
              missingCollections,
              cache
            )
          )
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(errorMessage(error))
          failure.message = `Cannot resolve text variable dependency "${field}" on "${node.id}": ${failure.message}`
          throw failure
        }
      }
      if (![...values.values()].some((value) => value.affected)) continue
      await loadFonts(currentTextFonts(node), state.fonts)
      const families = values.get('fontFamily')
      const styles = values.get('fontStyle')
      const weights = values.get('fontWeight')
      const familyValues = families?.values.length ? families.values : [segment.fontName.family]
      const styleValues = styles?.values.length ? styles.values : [segment.fontName.style]
      const weightValues = weights?.values.length ? weights.values : [undefined]
      const optional = families?.optional || styles?.optional || weights?.optional
      if (familyValues.length * styleValues.length * weightValues.length > 256) {
        scopeError('Font mode preloading exceeds 256 possible font combinations.')
      }
      // Native mode changes can apply family before weight; both the intermediate
      // face and the final face must be loaded before invoking the synchronous setter.
      for (const family of familyValues)
        for (const fontStyle of styleValues)
          for (const weight of weightValues) {
            if (
              typeof family !== 'string' ||
              typeof fontStyle !== 'string' ||
              (weight !== undefined &&
                (typeof weight !== 'number' ||
                  !Number.isFinite(weight) ||
                  weight < 1 ||
                  weight > 1000))
            ) {
              if (optional) continue
              specError(
                `Font variables on "${node.id}" must resolve to STRING family/style and a weight between 1 and 1000.`
              )
            }
            try {
              await loadFont(
                await resolveFamilyFont(family, segment.fontName.style, state.fonts),
                state.fonts
              )
              await loadFont(
                await resolveFamilyFont(family, fontStyle, state.fonts, weight),
                state.fonts
              )
            } catch (error) {
              // A possible Auto font need not be the selected one. The native setter
              // remains authoritative; known explicit targets retain load failures.
              if (!optional) throw error
            }
          }
    }
  }
}

export async function applyVariableModes(
  node: SupportedCanvasNode | PageNode,
  modes: CanvasNodeSpec['variableModes'],
  state: ApplyState
): Promise<void> {
  for (const [collectionReference, modeReference] of Object.entries(modes ?? {})) {
    const collection = resolvedCollection(collectionReference, state.variables)
    const current = node.explicitVariableModes[collection.id]
    if (modeReference === null) {
      if (current === undefined) continue
      await loadModeFonts(node, collection.id, undefined, state)
      node.clearExplicitVariableModeForCollection(collection)
    } else {
      const modeId = resolvedModeId(collection, modeReference, state.variables)
      if (current === modeId) continue
      await loadModeFonts(node, collection.id, modeId, state)
      node.setExplicitVariableModeForCollection(collection, modeId)
    }
    markMutation(state, node)
  }
}

export async function preloadFirstPageModeFonts(
  page: PageNode,
  modes: CanvasPageProperties['variableModes'],
  state: ApplyState
): Promise<void> {
  for (const [collectionReference, modeReference] of Object.entries(modes ?? {})) {
    const collection = resolvedCollection(collectionReference, state.variables)
    const modeId =
      modeReference === null
        ? undefined
        : resolvedModeId(collection, modeReference, state.variables)
    if (page.explicitVariableModes[collection.id] === modeId) continue
    // Later transitions can depend on the preceding mode setters. Warm only the
    // first one; applyVariableModes still checks the live font requirements.
    await loadModeFonts(page, collection.id, modeId, state)
    return
  }
}
