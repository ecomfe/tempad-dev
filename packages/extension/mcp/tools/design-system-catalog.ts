import type {
  CanvasDesignReference,
  CanvasStyleReference,
  CanvasVariableReference,
  CanvasVariableValue
} from '@tempad-dev/shared'

export type CatalogComponentProperty = {
  name: string
  type: 'boolean' | 'instance' | 'text' | 'variant'
  default?: string | boolean
  options?: string[]
  omittedOptions?: number
}

export type CatalogComponent = {
  kind: 'component'
  ref: string
  tag: string
  name: string
  reference: CanvasDesignReference
  nativeReferences?: CanvasDesignReference[]
  nativeSize: { width: number; height: number }
  pageName: string
  variantCount: number
  properties: Record<string, CatalogComponentProperty>
  definition: unknown
}

type CatalogVariable = {
  kind: 'variable'
  ref: string
  name: string
  reference: CanvasVariableReference
  resolvedType: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING'
  defaultValue?: CanvasVariableValue
  definition: unknown
}

export type CatalogCollection = {
  kind: 'collection'
  ref: string
  name: string
  reference: CanvasDesignReference
  modes: Array<{ ref: string; id: string; name: string }>
  defaultModeId: string
  definition: unknown
}

type CatalogMode = {
  kind: 'mode'
  ref: string
  name: string
  id: string
  collectionRef: string
  definition: unknown
}

type CatalogStyle = {
  kind: 'style'
  ref: string
  name: string
  reference: CanvasStyleReference
  styleType: 'EFFECT' | 'GRID' | 'PAINT' | 'TEXT'
  definition: unknown
}

type CatalogShader = {
  kind: 'shader'
  ref: string
  name: string
  id: string
  shaderType: 'effect' | 'fill'
  definition: unknown
}

export type CatalogEntry =
  | CatalogCollection
  | CatalogComponent
  | CatalogMode
  | CatalogShader
  | CatalogStyle
  | CatalogVariable

export type DesignSystemCatalog = {
  componentReferences: Map<string, CanvasDesignReference>
  id: string
  fileKey?: string
  entries: Map<string, CatalogEntry>
  orderedRefs: string[]
  tags: Map<string, CatalogComponent>
  warnings: string[]
}

const catalogs = new Map<string, DesignSystemCatalog>()
const MAX_CATALOGS = 8

export function registerDesignSystemCatalog(
  entries: CatalogEntry[],
  fileKey?: string,
  orderedRefs = entries.filter((entry) => entry.kind !== 'mode').map((entry) => entry.ref),
  warnings: string[] = []
): DesignSystemCatalog {
  const id = `ds_${crypto.randomUUID()}`
  const catalog = {
    componentReferences: new Map(
      entries
        .filter((entry): entry is CatalogComponent => entry.kind === 'component')
        .flatMap((entry) => [entry.reference, ...(entry.nativeReferences ?? [])])
        .flatMap((reference) =>
          [reference.id, reference.key]
            .filter((value): value is string => value !== undefined)
            .map((value) => [value, reference] as const)
        )
    ),
    id,
    ...(fileKey ? { fileKey } : {}),
    entries: new Map(entries.map((entry) => [entry.ref, entry])),
    orderedRefs,
    tags: new Map(
      entries
        .filter((entry): entry is CatalogComponent => entry.kind === 'component')
        .map((entry) => [entry.tag, entry])
    ),
    warnings: [...warnings]
  }
  catalogs.set(id, catalog)
  while (catalogs.size > MAX_CATALOGS) {
    catalogs.delete(catalogs.keys().next().value!)
  }
  return catalog
}

export function requireDesignSystemCatalog(
  id: string,
  fileKey?: string | null
): DesignSystemCatalog {
  const catalog = catalogs.get(id)
  if (!catalog || (catalog.fileKey && catalog.fileKey !== fileKey)) {
    throw new Error(`Unknown or expired design-system catalog: ${id}`)
  }
  catalogs.delete(id)
  catalogs.set(id, catalog)
  return catalog
}
