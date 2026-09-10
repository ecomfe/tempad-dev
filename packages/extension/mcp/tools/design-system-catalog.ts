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
  cssName?: string
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
  className?: string
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

function resourceSlug(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

function withResourceAliases(entries: CatalogEntry[]): CatalogEntry[] {
  const proposed = entries.map((entry) => {
    if (entry.kind === 'variable') {
      const definition = entry.definition as { codeSyntax?: { WEB?: string } } | undefined
      const syntax = definition?.codeSyntax?.WEB
      const cssName =
        syntax?.match(/^var\((--[a-zA-Z0-9_-]+)\)$/)?.[1] ??
        (syntax && /^--[a-zA-Z0-9_-]+$/.test(syntax) ? syntax : undefined)
      return cssName ?? `--${resourceSlug(entry.name) || 'variable'}`
    }
    return entry.kind === 'style' && entry.styleType === 'TEXT'
      ? `type-${resourceSlug(entry.name) || 'text'}`
      : undefined
  })
  const reserved = new Set(proposed.filter((name): name is string => name !== undefined))
  const counts = new Map<string, number>()
  for (const name of proposed) if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  return entries.map((entry, index) => {
    let name = proposed[index]
    if (!name) return entry
    if (counts.get(name)! > 1) {
      const base = `${name}-${entry.ref}`
      name = base
      for (let suffix = 2; reserved.has(name); suffix += 1) name = `${base}-${suffix}`
      reserved.add(name)
    }
    return entry.kind === 'variable' ? { ...entry, cssName: name } : { ...entry, className: name }
  })
}

export function registerDesignSystemCatalog(
  entries: CatalogEntry[],
  fileKey?: string,
  orderedRefs = entries.filter((entry) => entry.kind !== 'mode').map((entry) => entry.ref),
  warnings: string[] = []
): DesignSystemCatalog {
  entries = withResourceAliases(entries)
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
