import type {
  ApplyCanvasParameters,
  CanvasBinding,
  CanvasResolvedApplyParameters
} from '@tempad-dev/shared'

import { CanvasResolvedApplyParametersSchema } from '@tempad-dev/shared'

import {
  requireDesignSystemCatalog,
  type CatalogEntry,
  type DesignSystemCatalog
} from '../design-system-catalog'
import { formatSchemaError } from './errors'

type Resolution = {
  catalog?: DesignSystemCatalog
  input: CanvasResolvedApplyParameters
}

const CATALOG_REF_PATTERN = /^(?:[chksv]\d+|m\d+_\d+)$/
const MAX_RESOLUTION_DEPTH = 64

function inputError(message: string): never {
  throw new Error(message)
}

function catalogEntry(
  catalog: DesignSystemCatalog | undefined,
  ref: string
): CatalogEntry | undefined {
  const entry = catalog?.entries.get(ref)
  if (!entry && CATALOG_REF_PATTERN.test(ref)) {
    inputError(
      catalog
        ? `Unknown design-system ref "${ref}" in catalog "${catalog.id}".`
        : `Design-system ref "${ref}" requires catalogId.`
    )
  }
  return entry
}

function resolveDeep(value: unknown, catalog: DesignSystemCatalog | undefined, depth = 0): unknown {
  if (depth > MAX_RESOLUTION_DEPTH) {
    inputError(`Canvas native data may be at most ${MAX_RESOLUTION_DEPTH} levels deep.`)
  }
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, catalog, depth + 1))
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.ref === 'string') {
    if (Object.keys(record).length !== 1) {
      inputError('A design-system { ref } value cannot contain other fields.')
    }
    if (!catalog) inputError(`Design-system ref "${record.ref}" requires catalogId.`)
    const entry = catalogEntry(catalog, record.ref)
    if (!entry) {
      inputError(`Unknown design-system ref "${record.ref}" in catalog "${catalog.id}".`)
    }
    if (entry.kind === 'mode' || entry.kind === 'shader') return entry.id
    return entry.reference
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, resolveDeep(item, catalog, depth + 1)])
  )
}

function resolveNativeBinding(
  binding: NonNullable<ApplyCanvasParameters['native']>[string],
  catalog: DesignSystemCatalog | undefined
): CanvasBinding {
  const variableModes = binding.variableModes
    ? Object.fromEntries(
        Object.entries(binding.variableModes).map(([collectionRef, modeRef]) => {
          const collection = catalogEntry(catalog, collectionRef)
          const mode = modeRef === null ? null : catalogEntry(catalog, modeRef)
          if (collection && collection.kind !== 'collection') {
            inputError(`Design-system ref "${collectionRef}" is not a collection.`)
          }
          if (mode && mode.kind !== 'mode') {
            inputError(`Design-system ref "${modeRef}" is not a mode.`)
          }
          if (collection?.kind === 'collection' && mode?.kind === 'mode') {
            if (mode.collectionRef !== collection.ref) {
              inputError(`Mode "${modeRef}" does not belong to collection "${collectionRef}".`)
            }
          }
          const resolvedCollection =
            collection?.kind === 'collection'
              ? (collection.reference.id ?? collection.reference.key)
              : collectionRef
          return [resolvedCollection, mode?.kind === 'mode' ? mode.id : modeRef]
        })
      )
    : undefined
  return {
    ...(binding.variables ? { variables: binding.variables } : {}),
    ...(variableModes ? { variableModes } : {}),
    ...(binding.styles ? { styles: binding.styles } : {}),
    ...(binding.figma
      ? { figma: resolveDeep(binding.figma, catalog) as CanvasBinding['figma'] }
      : {})
  }
}

export function resolveCanvasInput(input: ApplyCanvasParameters): Resolution {
  const catalog = input.catalogId
    ? requireDesignSystemCatalog(
        input.catalogId,
        typeof figma === 'undefined' ? undefined : figma.fileKey
      )
    : undefined
  const candidate = {
    mode: input.mode,
    ...(input.targetNodeId ? { targetNodeId: input.targetNodeId } : {}),
    markup: input.markup,
    ...(input.native
      ? {
          bindings: Object.fromEntries(
            Object.entries(input.native).map(([key, binding]) => [
              key,
              resolveNativeBinding(binding, catalog)
            ])
          )
        }
      : {}),
    ...(input.variableCollections === undefined
      ? {}
      : { variableCollections: resolveDeep(input.variableCollections, catalog) }),
    ...(input.styles === undefined ? {} : { styles: resolveDeep(input.styles, catalog) }),
    ...(input.assets === undefined ? {} : { assets: input.assets }),
    ...(input.removeKeys === undefined ? {} : { removeKeys: input.removeKeys }),
    ...(input.page === undefined ? {} : { page: resolveDeep(input.page, catalog) })
  }
  const parsed = CanvasResolvedApplyParametersSchema.safeParse(candidate)
  if (!parsed.success) {
    inputError(formatSchemaError(parsed.error))
  }
  return { input: parsed.data, ...(catalog ? { catalog } : {}) }
}
