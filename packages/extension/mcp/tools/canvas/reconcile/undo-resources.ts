import type { ApplyState } from './state'

import { getStyleById, getVariableById, getVariableCollectionById } from '../../../local-resources'
import {
  CANVAS_KEY_NAMESPACE,
  CANVAS_STYLE_KEY_NAME,
  CANVAS_VARIABLE_COLLECTION_KEY_NAME,
  CANVAS_VARIABLE_KEY_NAME,
  CANVAS_VARIABLE_MODE_KEYS_NAME
} from '../identity'
import { TEXT_STYLE_VALUE_FIELDS } from './text-fonts'

type ResourceSnapshot = {
  id: string
  before: string
  read: () => Promise<string | null>
}

export function createdResourceChecks(state: ApplyState): Array<{
  id: string
  exists: () => Promise<boolean>
}> {
  return [
    ...[...state.variables.createdCollectionIds].map((id) => ({
      id,
      exists: async () => !!(await getVariableCollectionById(id))
    })),
    ...[...state.variables.createdVariableIds].map((id) => ({
      id,
      exists: async () => !!(await getVariableById(id))
    })),
    ...[...state.styles.createdStyleIds].map((id) => ({
      id,
      exists: async () => !!(await getStyleById(id))
    }))
  ]
}

function snapshotStyle(style: BaseStyle): string {
  return JSON.stringify({
    name: style.name,
    descriptionMarkdown: style.descriptionMarkdown,
    documentationLinks: style.documentationLinks,
    key: style.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_STYLE_KEY_NAME),
    ...(style.type === 'TEXT'
      ? {
          boundVariables: (style as TextStyle).boundVariables,
          ...Object.fromEntries(
            TEXT_STYLE_VALUE_FIELDS.map((field) => [field, (style as TextStyle)[field]])
          )
        }
      : {}),
    ...(style.type === 'PAINT' ? { paints: (style as PaintStyle).paints } : {}),
    ...(style.type === 'EFFECT' ? { effects: (style as EffectStyle).effects } : {}),
    ...(style.type === 'GRID' ? { layoutGrids: (style as GridStyle).layoutGrids } : {})
  })
}

function snapshotVariable(variable: Variable): string {
  return JSON.stringify({
    name: variable.name,
    description: variable.description,
    hiddenFromPublishing: variable.hiddenFromPublishing,
    scopes: variable.scopes,
    codeSyntax: variable.codeSyntax,
    valuesByMode: variable.valuesByMode,
    key: variable.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_KEY_NAME)
  })
}

function snapshotCollection(collection: VariableCollection): string {
  return JSON.stringify({
    name: collection.name,
    hiddenFromPublishing: collection.hiddenFromPublishing,
    modes: collection.modes,
    defaultModeId: collection.defaultModeId,
    variableIds: collection.variableIds,
    ...(collection.isExtension
      ? {
          variableOverrides: (collection as unknown as ExtendedVariableCollection).variableOverrides
        }
      : {}),
    key: collection.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_COLLECTION_KEY_NAME),
    modeKeys: collection.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_MODE_KEYS_NAME)
  })
}

export function snapshotDeclaredResources(state: ApplyState): ResourceSnapshot[] {
  const snapshots: ResourceSnapshot[] = []
  function capture<T extends { id: string }>(
    resource: T | undefined,
    read: (id: string) => Promise<T | null>,
    snapshot: (resource: T) => string
  ): void {
    if (!resource) return
    const id = resource.id
    snapshots.push({
      id,
      before: snapshot(resource),
      read: async () => {
        const current = await read(id)
        return current ? snapshot(current) : null
      }
    })
  }
  for (const selection of state.styles.selections ?? []) {
    capture(selection.style, getStyleById, snapshotStyle)
  }
  for (const collection of state.variables.selectedCollections?.values() ?? []) {
    capture(collection, getVariableCollectionById, snapshotCollection)
  }
  for (const variable of state.variables.selectedVariables?.values() ?? []) {
    capture(variable, getVariableById, snapshotVariable)
  }
  return snapshots
}

export async function hasResourceChange(
  snapshots: ResourceSnapshot[],
  state: ApplyState
): Promise<boolean> {
  for (const snapshot of snapshots) {
    try {
      const current = await snapshot.read()
      if (current !== null) {
        if (current !== snapshot.before) return true
      } else if (
        state.styles.removedStyleIds.has(snapshot.id) ||
        state.variables.removedCollectionIds.has(snapshot.id) ||
        state.variables.removedVariableIds.has(snapshot.id)
      )
        return true
    } catch {
      // An unavailable resource cannot erase evidence from another resource.
    }
  }
  return false
}

export async function verifyResourceRollback(
  snapshots: ResourceSnapshot[],
  state: ApplyState
): Promise<void> {
  for (const snapshot of snapshots) {
    if ((await snapshot.read()) !== snapshot.before) {
      throw new Error(`Rollback did not restore pre-existing resource ${snapshot.id}`)
    }
  }
  for (const resource of createdResourceChecks(state)) {
    if (await resource.exists())
      throw new Error(`Rollback did not remove created resource ${resource.id}`)
  }
}
