import type { CanvasPageProperties } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { coerceToolErrorPayload } from '../../../errors'
import { getStyleById, getVariableById, getVariableCollectionById } from '../../../local-resources'
import { applyError, scopeError, errorMessage } from '../errors'
import { loadFonts, currentTextFonts, loadFont, resolveFamilyFont } from '../fonts'
import { walkPhysicalNodes } from '../traversal'
import { resolvedCollection, resolvedModeId } from '../variables'
import { SIZE_BOUND_FIELDS } from './layout'
import { type ApplyState, type SupportedCanvasNode, markMutation } from './state'
import { TEXT_STYLE_VARIABLES_BY_VALUE } from './text-fonts'

type FontModeValues = {
  values: VariableValue[]
  optional: boolean
  affected: boolean
  unavailable?: string
}
type MissingModeResources = {
  variables: Set<string>
  collections: Set<string>
  styles: Set<string>
}

const TEXT_MODE_FONT_FIELDS = [
  'characters',
  'width',
  'height',
  ...SIZE_BOUND_FIELDS,
  ...Object.values(TEXT_STYLE_VARIABLES_BY_VALUE).flat()
] as const

async function modeFontVariable(
  id: string,
  state: ApplyState,
  missing: Set<string>
): Promise<Variable | null> {
  const key = `id:${id}`
  const cached = state.variables.variableCache.get(key)
  if (cached) return cached
  if (missing.has(id)) return null
  const variable = await getVariableById(id)
  if (variable) state.variables.variableCache.set(key, variable)
  else missing.add(id)
  return variable
}

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

async function modeTextStyle(
  id: string,
  state: ApplyState,
  missing: Set<string>
): Promise<BaseStyle | null> {
  const key = `id:${id}`
  const cached = state.styles.cache.get(key)
  if (cached) return cached
  if (missing.has(id)) return null
  const style = await getStyleById(id)
  if (style) state.styles.cache.set(key, style)
  else missing.add(id)
  return style
}

async function modeFontVariableValues(
  variable: Variable,
  consumer: TextNode,
  target: SupportedCanvasNode | PageNode,
  changedCollectionId: string,
  changedModeId: string | undefined,
  state: ApplyState,
  missing: MissingModeResources,
  cache = new Map<string, FontModeValues>(),
  seen = new Set<string>()
): Promise<FontModeValues> {
  if (seen.has(variable.id) || seen.size >= 64) {
    applyError('Text variable aliases contain a cycle or exceed 64 levels.')
  }
  const cached = cache.get(variable.id)
  if (cached) return cached
  const active = new Set(seen).add(variable.id)
  const base = await modeFontCollection(variable.variableCollectionId, state, missing.collections)
  if (!base) {
    return {
      values: [],
      optional: true,
      affected: false,
      unavailable: `Text variable collection "${variable.variableCollectionId}" is unavailable.`
    }
  }
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
    const collection = await modeFontCollection(id, state, missing.collections)
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
  let unavailable: string | undefined
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
      if (value === undefined) {
        unavailable ??= `Text variable "${variable.id}" has no value for the selected mode.`
        continue
      }
      if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
        const referenced = await modeFontVariable(value.id, state, missing.variables)
        if (!referenced) {
          unavailable ??= `Text variable alias "${value.id}" is unavailable.`
          continue
        }
        const alias = await modeFontVariableValues(
          referenced,
          consumer,
          target,
          changedCollectionId,
          changedModeId,
          state,
          missing,
          cache,
          active
        )
        candidates.push(...alias.values)
        optional ||= alias.optional
        affected ||= alias.affected
        unavailable ??= alias.unavailable
      } else candidates.push(value)
    }
  }
  const values = [...new Set(candidates)]
  if (values.length > 64 || cache.size >= 256)
    scopeError('Font mode preloading exceeds the bounded candidate budget.')
  // Page Auto candidates are possibilities, not selected dependencies. A missing
  // candidate must not block the native Auto setter; known selections stay strict.
  const result = {
    values,
    optional,
    affected,
    ...(selected.length === 1 && unavailable ? { unavailable } : {})
  }
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
  // Only misses are scan-local: later imports can expose previously unavailable resources.
  const missing: MissingModeResources = {
    variables: new Set(),
    collections: new Set(),
    styles: new Set()
  }
  for (const node of walkPhysicalNodes(roots)) {
    if (node.type !== 'TEXT') continue
    const cache = new Map<string, FontModeValues>()
    const segments = node.getStyledTextSegments(['fontName', 'textStyleId', 'boundVariables'])
    for (const segment of segments) {
      const style = segment.textStyleId
        ? await modeTextStyle(segment.textStyleId, state, missing.styles)
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
          const variable = await modeFontVariable(reference.id, state, missing.variables)
          if (!variable) continue
          const resolved = await modeFontVariableValues(
            variable,
            node,
            target,
            collectionId,
            modeId,
            state,
            missing,
            cache
          )
          // A dangling native binding cannot be changed by an unrelated collection.
          // Keep its failure until aliases establish whether this transition reaches it.
          if (resolved.affected && resolved.unavailable) applyError(resolved.unavailable)
          values.set(field, resolved)
        } catch (error) {
          if (coerceToolErrorPayload(error).code === TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE)
            throw error
          applyError(
            `Cannot resolve text variable dependency "${field}" on "${node.id}": ${errorMessage(error)}`
          )
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
              applyError(
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
