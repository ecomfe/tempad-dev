import type {
  CanvasFigmaEffect,
  CanvasFigmaLayoutGrid,
  CanvasFigmaPaint,
  CanvasFigmaShaderPropertyValue,
  CanvasVariableValue,
  DesignSystemCatalogCollection,
  DesignSystemCatalogComponent,
  DesignSystemCatalogShader,
  DesignSystemCatalogStyle,
  DesignSystemCatalogVariable,
  GetDesignSystemParametersInput,
  GetDesignSystemResult
} from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetDesignSystemToolResult,
  measureCallToolResultBytes,
  utf8Bytes
} from '@tempad-dev/shared'

import {
  getLocalStyles,
  getLocalVariableCollections,
  getLocalVariables,
  getNodeById,
  getVariableById,
  getVariableCollectionById
} from '../local-resources'
import { collectVariableAliasIds } from '../variable-references'
import {
  CANVAS_KEY_NAMESPACE,
  CANVAS_STYLE_KEY_NAME,
  CANVAS_VARIABLE_COLLECTION_KEY_NAME,
  CANVAS_VARIABLE_KEY_NAME,
  CANVAS_VARIABLE_MODE_KEYS_NAME,
  parseVariableModeKeys,
  readAuthoringKey
} from './canvas/identity'
import {
  registerDesignSystemCatalog,
  requireDesignSystemCatalog,
  type CatalogCollection,
  type CatalogComponent,
  type CatalogComponentProperty,
  type CatalogEntry
} from './design-system-catalog'

const TARGET_BYTES = 16 * 1024
const MAX_SUMMARY_LENGTH = 240
const MAX_DETAIL_TEXT_LENGTH = 2_000
const MAX_CATALOG_PROPERTIES = 32
const MAX_CATALOG_OPTIONS = 32
const MAX_DETAIL_OPTIONS = 128
const MAX_COMPONENT_VARIANTS = 128
const MAX_ANATOMY_NODES = 64
const MAX_ANATOMY_VISITS = 512

function boundedText(value: string | undefined, maxLength = MAX_DETAIL_TEXT_LENGTH) {
  const text = value?.replaceAll(/\s+/g, ' ').trim()
  if (!text || text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.toSorted((left, right) => compareText(left.name, right.name))
}

function modeAuthoringKeys(
  collection: VariableCollection,
  warnings: string[]
): Map<string, string> {
  if (typeof collection.getSharedPluginData !== 'function') return new Map()
  const raw = collection.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_MODE_KEYS_NAME)
  const keys = parseVariableModeKeys(raw, collection.modes)
  if (!keys) {
    if (!warnings.includes('Some variable authoring identities could not be read.')) {
      warnings.push('Some variable authoring identities could not be read.')
    }
    return new Map()
  }
  return new Map([...keys].map(([key, id]) => [id, key]))
}

async function readOrNull<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

function describeVariableAlias(alias: VariableAlias): { id: string } {
  return { id: alias.id }
}

function describeVariableValue(value: VariableValue): CanvasVariableValue {
  return typeof value === 'object' && 'type' in value
    ? { variable: describeVariableAlias(value) }
    : value
}

function describeVariableValues(
  values: Record<string, VariableValue>
): Record<string, CanvasVariableValue> {
  return Object.fromEntries(
    Object.entries(values).map(([modeId, value]) => [modeId, describeVariableValue(value)])
  )
}

function componentProperties(definitions: ComponentPropertyDefinitions) {
  const entries = Object.entries(definitions).map(([name, definition]) => {
    const allOptions =
      definition.type === 'VARIANT'
        ? definition.variantOptions
        : definition.preferredValues?.map((value) => value.key)
    const options = allOptions?.slice(0, MAX_DETAIL_OPTIONS)
    const defaultVariableId = definition.boundVariables?.defaultValue?.id
    const description = boundedText(definition.description)
    return [
      name,
      {
        type: definition.type,
        defaultValue: definition.defaultValue,
        ...(options?.length ? { options } : {}),
        ...(allOptions && allOptions.length > MAX_DETAIL_OPTIONS
          ? { omittedOptions: allOptions.length - MAX_DETAIL_OPTIONS }
          : {}),
        ...(definition.preferredValues?.length
          ? { preferredValues: definition.preferredValues.slice(0, MAX_DETAIL_OPTIONS) }
          : {}),
        ...(description ? { description } : {}),
        ...(definition.slotSettings ? { slotSettings: definition.slotSettings } : {}),
        ...(defaultVariableId ? { defaultVariableId } : {})
      }
    ] as const
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function documentationUris(
  resource: Pick<PublishableMixin, 'documentationLinks'>
): string[] | undefined {
  const uris = resource.documentationLinks.map(({ uri }) => uri)
  return uris.length ? uris : undefined
}

function describeComponent(component: ComponentNode, page: Pick<PageNode, 'id' | 'name'>) {
  const componentSet = component.parent?.type === 'COMPONENT_SET' ? component.parent : null
  const definitions =
    componentSet?.componentPropertyDefinitions ?? component.componentPropertyDefinitions
  const properties = componentProperties(definitions)
  const description = boundedText(component.description)
  const descriptionMarkdown = boundedText(component.descriptionMarkdown)
  const documentationLinks = documentationUris(component)
  const componentSetDescription = boundedText(componentSet?.description)
  const componentSetDescriptionMarkdown = boundedText(componentSet?.descriptionMarkdown)
  const componentSetDocumentationLinks = componentSet ? documentationUris(componentSet) : undefined
  const variantValues = component.variantProperties
  return {
    id: component.id,
    key: component.key,
    name: component.name,
    pageId: page.id,
    pageName: page.name,
    ...(description ? { description } : {}),
    ...(descriptionMarkdown ? { descriptionMarkdown } : {}),
    ...(documentationLinks ? { documentationLinks } : {}),
    width: component.width,
    height: component.height,
    ...(componentSet
      ? {
          componentSetId: componentSet.id,
          componentSetKey: componentSet.key,
          componentSetName: componentSet.name,
          ...(componentSetDescription ? { componentSetDescription } : {}),
          ...(componentSetDescriptionMarkdown ? { componentSetDescriptionMarkdown } : {}),
          ...(componentSetDocumentationLinks ? { componentSetDocumentationLinks } : {}),
          ...(componentSet.defaultVariant.id === component.id ? { isDefaultVariant: true } : {}),
          ...(variantValues ? { variantValues } : {})
        }
      : {}),
    ...(properties ? { properties } : {}),
    remote: component.remote
  }
}

function collectComponents(warnings: string[]) {
  const components: ReturnType<typeof describeComponent>[] = []
  let unreadablePages = 0
  let pages: readonly PageNode[]
  try {
    pages = figma.root.children
  } catch {
    pages = [figma.currentPage]
  }
  for (const page of pages) {
    try {
      components.push(
        ...page
          .findAllWithCriteria({ types: ['COMPONENT'] })
          .map((component) => describeComponent(component, page))
      )
    } catch {
      unreadablePages += 1
    }
  }
  if (unreadablePages) {
    const loadedPages = pages.length - unreadablePages
    warnings.push(
      `Component definitions were read from ${loadedPages} accessible ${loadedPages === 1 ? 'page' : 'pages'}; ${unreadablePages} ${unreadablePages === 1 ? 'page was' : 'pages were'} skipped rather than loaded.`
    )
  }
  return components
}

async function collectVariables(referencedDefinitionIds: Set<string>, warnings: string[]) {
  try {
    const [localVariables, localCollections] = await Promise.all([
      getLocalVariables(),
      getLocalVariableCollections()
    ])
    const variablesById = new Map(localVariables.map((variable) => [variable.id, variable]))
    const referencedVariableIds = new Set([
      ...referencedDefinitionIds,
      ...localCollections.flatMap((collection) => collection.variableIds)
    ])
    for (const variable of localVariables) {
      collectVariableAliasIds(variable.valuesByMode, referencedVariableIds)
    }
    for (const collection of localCollections) {
      if (collection.isExtension) {
        collectVariableAliasIds(
          (collection as unknown as ExtendedVariableCollection).variableOverrides,
          referencedVariableIds
        )
      }
    }

    const attemptedVariableIds = new Set(variablesById.keys())
    let pendingVariableIds = [...referencedVariableIds].filter(
      (id) => !attemptedVariableIds.has(id)
    )
    let unreadableVariable = false
    while (pendingVariableIds.length) {
      pendingVariableIds.forEach((id) => attemptedVariableIds.add(id))
      const remoteVariables = await Promise.all(
        pendingVariableIds.map((id) => readOrNull(() => getVariableById(id)))
      )
      const aliasIds = new Set<string>()
      for (const variable of remoteVariables) {
        if (!variable) {
          unreadableVariable = true
          continue
        }
        variablesById.set(variable.id, variable)
        collectVariableAliasIds(variable.valuesByMode, aliasIds)
      }
      pendingVariableIds = [...aliasIds].filter((id) => !attemptedVariableIds.has(id))
    }
    if (unreadableVariable) {
      warnings.push('Some referenced variables could not be read.')
    }

    const variables = [...variablesById.values()]
    const collectionsById = new Map(
      localCollections.map((collection) => [collection.id, collection])
    )
    const remoteCollectionIds = [
      ...new Set(
        variables
          .map((variable) => variable.variableCollectionId)
          .filter((id) => !collectionsById.has(id))
      )
    ]
    const remoteCollections = await Promise.all(
      remoteCollectionIds.map((id) => readOrNull(() => getVariableCollectionById(id)))
    )
    for (const collection of remoteCollections) {
      if (collection) collectionsById.set(collection.id, collection)
    }

    return {
      variables: variables.map((variable) => {
        const description = boundedText(variable.description)
        const scopes = variable.scopes?.map(String)
        const variableAuthoringKey = readAuthoringKey(variable, CANVAS_VARIABLE_KEY_NAME)
        const valuesByMode = describeVariableValues(variable.valuesByMode)
        return {
          id: variable.id,
          key: variable.key,
          ...(variableAuthoringKey ? { authoringKey: variableAuthoringKey } : {}),
          name: variable.name,
          collectionId: variable.variableCollectionId,
          collectionName:
            collectionsById.get(variable.variableCollectionId)?.name ?? 'Unknown collection',
          ...(description ? { description } : {}),
          remote: variable.remote,
          resolvedType: variable.resolvedType,
          ...(scopes?.length ? { scopes } : {}),
          ...(Object.keys(valuesByMode).length ? { valuesByMode } : {})
        }
      }),
      collections: [...collectionsById.values()].map((collection) => {
        const collectionAuthoringKey = readAuthoringKey(
          collection,
          CANVAS_VARIABLE_COLLECTION_KEY_NAME
        )
        const modeKeys = modeAuthoringKeys(collection, warnings)
        const extended = collection.isExtension
          ? (collection as unknown as ExtendedVariableCollection)
          : undefined
        const variableOverrides = extended
          ? Object.fromEntries(
              Object.entries(extended.variableOverrides).map(([variableId, values]) => [
                variableId,
                describeVariableValues(values)
              ])
            )
          : {}
        return {
          id: collection.id,
          ...(collection.key ? { key: collection.key } : {}),
          ...(collectionAuthoringKey ? { authoringKey: collectionAuthoringKey } : {}),
          name: collection.name,
          remote: collection.remote,
          ...(extended
            ? {
                isExtension: true as const,
                parentVariableCollectionId: extended.parentVariableCollectionId,
                rootVariableCollectionId: extended.rootVariableCollectionId
              }
            : {}),
          modes: collection.modes.map((mode) => ({
            id: mode.modeId,
            ...(modeKeys.get(mode.modeId) ? { authoringKey: modeKeys.get(mode.modeId) } : {}),
            name: mode.name,
            ...(extended
              ? {
                  parentModeId: extended.modes.find(
                    (candidate) => candidate.modeId === mode.modeId
                  )!.parentModeId
                }
              : {})
          })),
          defaultModeId: collection.defaultModeId,
          ...(Object.keys(variableOverrides).length ? { variableOverrides } : {})
        }
      })
    }
  } catch {
    warnings.push('Variables could not be read in the current Figma context.')
    return { variables: [], collections: [] }
  }
}

function describeBindings<Field extends string>(
  bindings: Partial<Record<Field, VariableAlias>> | undefined
): Partial<Record<Field, { id: string }>> | undefined {
  const entries = Object.entries(bindings ?? {}).map(([field, alias]) => [
    field,
    describeVariableAlias(alias as VariableAlias)
  ])
  return entries.length
    ? (Object.fromEntries(entries) as Partial<Record<Field, { id: string }>>)
    : undefined
}

function describeTransform(
  transform: Transform
): [[number, number, number], [number, number, number]] {
  return [
    [transform[0][0], transform[0][1], transform[0][2]],
    [transform[1][0], transform[1][1], transform[1][2]]
  ]
}

function describeShaderProperties(
  properties: Record<string, ShaderPropertyValue> | undefined
): Record<string, CanvasFigmaShaderPropertyValue> | undefined {
  const entries = Object.entries(properties ?? {}).map(([id, value]) => [
    id,
    describeShaderValue(value)
  ])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function describePaint(paint: Paint): CanvasFigmaPaint {
  switch (paint.type) {
    case 'SOLID': {
      const { boundVariables, ...fields } = paint
      const variable = boundVariables?.color
      return {
        ...fields,
        ...(variable ? { variables: { color: describeVariableAlias(variable) } } : {})
      }
    }
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return {
        ...paint,
        gradientTransform: describeTransform(paint.gradientTransform),
        gradientStops: paint.gradientStops.map(({ boundVariables, ...stop }) => {
          const variable = boundVariables?.color
          return {
            ...stop,
            ...(variable ? { variables: { color: describeVariableAlias(variable) } } : {})
          }
        })
      }
    case 'IMAGE':
      return {
        ...paint,
        ...(paint.imageTransform ? { imageTransform: describeTransform(paint.imageTransform) } : {})
      }
    case 'VIDEO':
      return {
        ...paint,
        ...(paint.videoTransform ? { videoTransform: describeTransform(paint.videoTransform) } : {})
      }
    case 'PATTERN':
      return { ...paint }
    case 'SHADER': {
      const { properties: nativeProperties, ...fields } = paint
      const properties = describeShaderProperties(nativeProperties)
      return {
        ...fields,
        ...(properties ? { properties } : {})
      }
    }
  }
}

function describeEffect(effect: Effect): CanvasFigmaEffect {
  switch (effect.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW': {
      const { boundVariables, ...fields } = effect
      const variables = describeBindings(boundVariables)
      return { ...fields, ...(variables ? { variables } : {}) }
    }
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR': {
      const { boundVariables, ...fields } = effect
      const variable = boundVariables?.radius
      return {
        ...fields,
        ...(variable ? { variables: { radius: describeVariableAlias(variable) } } : {})
      }
    }
    case 'NOISE':
    case 'TEXTURE':
    case 'GLASS': {
      const { boundVariables: _boundVariables, ...fields } = effect
      return fields
    }
    case 'SHADER': {
      const { properties: nativeProperties, ...fields } = effect
      const properties = describeShaderProperties(nativeProperties)
      return {
        ...fields,
        ...(properties ? { properties } : {})
      }
    }
  }
}

function describeLayoutGrid(grid: LayoutGrid): CanvasFigmaLayoutGrid {
  if (grid.pattern === 'GRID') {
    const { boundVariables, ...fields } = grid
    const variable = boundVariables?.sectionSize
    return {
      ...fields,
      ...(variable ? { variables: { sectionSize: describeVariableAlias(variable) } } : {})
    }
  }
  const { boundVariables, ...fields } = grid
  const variables = describeBindings(boundVariables)
  return {
    ...fields,
    count: grid.count === Infinity ? 'AUTO' : grid.count,
    ...(variables ? { variables } : {})
  }
}

function describeStyle(style: BaseStyle) {
  const description = boundedText(style.description)
  const descriptionMarkdown = boundedText(style.descriptionMarkdown)
  const documentationLinks = documentationUris(style)
  const styleAuthoringKey = readAuthoringKey(style, CANVAS_STYLE_KEY_NAME)
  const metadata = {
    id: style.id,
    key: style.key,
    ...(styleAuthoringKey ? { authoringKey: styleAuthoringKey } : {}),
    name: style.name,
    ...(description ? { description } : {}),
    ...(descriptionMarkdown ? { descriptionMarkdown } : {}),
    ...(documentationLinks ? { documentationLinks } : {}),
    remote: style.remote
  }
  switch (style.type) {
    case 'PAINT':
      return { ...metadata, type: style.type, paints: style.paints.map(describePaint) }
    case 'TEXT': {
      const variables = describeBindings(style.boundVariables)
      return {
        ...metadata,
        type: style.type,
        fontName: style.fontName,
        fontSize: style.fontSize,
        textDecoration: style.textDecoration,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        leadingTrim: style.leadingTrim,
        paragraphIndent: style.paragraphIndent,
        paragraphSpacing: style.paragraphSpacing,
        listSpacing: style.listSpacing,
        hangingPunctuation: style.hangingPunctuation,
        hangingList: style.hangingList,
        textCase: style.textCase,
        ...(variables ? { variables } : {})
      }
    }
    case 'EFFECT':
      return { ...metadata, type: style.type, effects: style.effects.map(describeEffect) }
    case 'GRID':
      return {
        ...metadata,
        type: style.type,
        layoutGrids: style.layoutGrids.map(describeLayoutGrid)
      }
  }
}

async function collectStyles(warnings: string[]): Promise<BaseStyle[]> {
  try {
    return await getLocalStyles()
  } catch {
    warnings.push('Styles could not be read in the current Figma context.')
    return []
  }
}

function describeShaderColor(
  value: RGB | RGBA | VariableAlias
): RGB | RGBA | { variable: { id: string } } {
  if ('type' in value) return { variable: describeVariableAlias(value) }
  return value
}

function describeShaderValue(value: ShaderPropertyValue): CanvasFigmaShaderPropertyValue {
  if (typeof value !== 'object' || value === null) return value
  if ('type' in value && value.type === 'VARIABLE_ALIAS') {
    return { variable: describeVariableAlias(value) }
  }
  if ('color' in value) {
    return {
      ...value,
      color: describeShaderColor(value.color)
    }
  }
  if ('stops' in value) {
    return {
      stops: value.stops.map((stop) => ({
        position: stop.position,
        color: describeShaderColor(stop.color)
      }))
    }
  }
  return value as CanvasFigmaShaderPropertyValue
}

function describeShader(shader: Shader) {
  const propertyEntries = Object.entries(shader.propertyDefinitions ?? {}).map(
    ([id, definition]) => {
      const description = definition.description?.trim()
      return [
        id,
        {
          name: definition.name,
          type: definition.type,
          ...(description ? { description } : {}),
          ...(definition.defaultValue === undefined
            ? {}
            : { defaultValue: describeShaderValue(definition.defaultValue) })
        }
      ] as const
    }
  )
  return {
    id: shader.id,
    name: shader.name,
    type: shader.type,
    imported: shader.imported,
    ...(propertyEntries.length ? { propertyDefinitions: Object.fromEntries(propertyEntries) } : {})
  }
}

async function collectShaders(warnings: string[]): Promise<Shader[]> {
  try {
    const shaders = await figma.listAvailableShaders()
    return shaders
  } catch {
    warnings.push('Shaders could not be read in the current Figma context.')
    return []
  }
}

function collectStyleVariableIds(styles: BaseStyle[], ids: Set<string>): void {
  for (const style of styles) {
    collectVariableAliasIds(style.boundVariables, ids)
    switch (style.type) {
      case 'PAINT':
        collectVariableAliasIds(style.paints, ids)
        break
      case 'EFFECT':
        collectVariableAliasIds(style.effects, ids)
        break
      case 'GRID':
        collectVariableAliasIds(style.layoutGrids, ids)
        break
    }
  }
}

type DescribedComponent = Awaited<ReturnType<typeof collectComponents>>[number]
type DescribedVariable = Awaited<ReturnType<typeof collectVariables>>['variables'][number]
type DescribedStyle = ReturnType<typeof describeStyle>

function toIdentifier(value: string, fallback: string, upper: boolean): string {
  const words = value.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []
  const identifier = words
    .map((word, index) => {
      const normalized = word[0]!.toUpperCase() + word.slice(1)
      return upper || index > 0 ? normalized : normalized[0]!.toLowerCase() + normalized.slice(1)
    })
    .join('')
  return identifier || fallback
}

function uniqueName(base: string, used: Set<string>): string {
  let value = base
  let suffix = 2
  while (used.has(value)) value = `${base}${suffix++}`
  used.add(value)
  return value
}

function groupComponents(components: DescribedComponent[]): Array<{
  item: DescribedComponent
  name: string
  variantCount: number
  variants: DescribedComponent[]
}> {
  const groups = new Map<string, DescribedComponent[]>()
  for (const component of components) {
    const key = component.componentSetId ?? component.id
    const group = groups.get(key) ?? []
    group.push(component)
    groups.set(key, group)
  }
  return [...groups.values()].map((variants) => {
    const item = variants.reduce((current, candidate) =>
      !current.isDefaultVariant &&
      (candidate.isDefaultVariant || compareText(candidate.name, current.name) < 0)
        ? candidate
        : current
    )
    return {
      item,
      name: item.componentSetName ?? item.name,
      variantCount: variants.length,
      variants
    }
  })
}

function catalogComponentProperties(
  component: DescribedComponent
): Record<string, CatalogComponentProperty> {
  const properties: Record<string, CatalogComponentProperty> = {}
  const used = new Set<string>()
  let index = 1
  for (const [nativeName, definition] of Object.entries(component.properties ?? {})) {
    if (definition.type === 'SLOT') continue
    const name = uniqueName(
      toIdentifier(nativeName.split('#')[0]!, `property${index++}`, false),
      used
    )
    const type = {
      BOOLEAN: 'boolean',
      INSTANCE_SWAP: 'instance',
      TEXT: 'text',
      VARIANT: 'variant'
    }[definition.type] as CatalogComponentProperty['type']
    properties[name] = {
      name: nativeName,
      type,
      default: definition.defaultValue,
      ...(definition.options?.length ? { options: definition.options } : {}),
      ...(definition.omittedOptions ? { omittedOptions: definition.omittedOptions } : {})
    }
  }
  return properties
}

function compactColor(value: RGB | RGBA): string {
  const channel = (number: number): string =>
    Math.round(Math.max(0, Math.min(1, number)) * 255)
      .toString(16)
      .padStart(2, '0')
  const alpha = 'a' in value ? channel(value.a) : ''
  return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}${alpha}`.toUpperCase()
}

function styleSignature(style: DescribedStyle): string {
  switch (style.type) {
    case 'PAINT':
      return style.paints.map((paint) => paint.type.toLowerCase()).join(' + ') || 'empty'
    case 'TEXT':
      return `${style.fontName.family} ${style.fontName.style}, ${style.fontSize}px`
    case 'EFFECT':
      return style.effects.map((effect) => effect.type.toLowerCase()).join(' + ') || 'empty'
    case 'GRID':
      return style.layoutGrids.map((grid) => grid.pattern.toLowerCase()).join(' + ') || 'empty'
  }
}

function compactEntry(
  entry: CatalogEntry
):
  | DesignSystemCatalogCollection
  | DesignSystemCatalogComponent
  | DesignSystemCatalogShader
  | DesignSystemCatalogStyle
  | DesignSystemCatalogVariable
  | undefined {
  switch (entry.kind) {
    case 'component': {
      const definition = entry.definition as DescribedComponent
      const summary = boundedText(
        definition.componentSetDescription ??
          definition.componentSetDescriptionMarkdown ??
          definition.description ??
          definition.descriptionMarkdown,
        MAX_SUMMARY_LENGTH
      )
      const propertyEntries = Object.entries(entry.properties)
      return {
        ref: entry.ref,
        tag: entry.tag,
        name: entry.name,
        ...(summary ? { summary } : {}),
        page: entry.pageName,
        ...(entry.variantCount > 1 ? { variantCount: entry.variantCount } : {}),
        nativeSize: entry.nativeSize,
        props: Object.fromEntries(
          propertyEntries.slice(0, MAX_CATALOG_PROPERTIES).map(([name, property]) => {
            const label = property.name.split('#')[0]!.trim()
            const needsLabel = toIdentifier(label, '', false) !== name
            const defaultValue =
              typeof property.default === 'string'
                ? boundedText(property.default, 120)
                : property.default
            const omittedOptions =
              (property.omittedOptions ?? 0) +
              Math.max(0, (property.options?.length ?? 0) - MAX_CATALOG_OPTIONS)
            return [
              name,
              {
                type: property.type,
                ...(needsLabel ? { label } : {}),
                ...(defaultValue === undefined ? {} : { default: defaultValue }),
                ...(property.options?.length
                  ? { options: property.options.slice(0, MAX_CATALOG_OPTIONS) }
                  : {}),
                ...(omittedOptions ? { omittedOptions } : {})
              }
            ]
          })
        ),
        ...(propertyEntries.length > MAX_CATALOG_PROPERTIES
          ? { omittedProps: propertyEntries.length - MAX_CATALOG_PROPERTIES }
          : {})
      }
    }
    case 'variable': {
      const definition = entry.definition as DescribedVariable
      let defaultValue: string | number | boolean | undefined
      if (entry.defaultValue === undefined || typeof entry.defaultValue !== 'object') {
        defaultValue = entry.defaultValue
      } else if (!('variable' in entry.defaultValue)) {
        defaultValue = compactColor(entry.defaultValue)
      }
      return {
        ref: entry.ref,
        name: entry.name,
        collection:
          'collectionName' in definition ? definition.collectionName : 'Unknown collection',
        type: {
          BOOLEAN: 'boolean',
          COLOR: 'color',
          FLOAT: 'number',
          STRING: 'string'
        }[entry.resolvedType] as DesignSystemCatalogVariable['type'],
        ...('scopes' in definition && definition.scopes?.length
          ? { scopes: definition.scopes }
          : {}),
        ...(defaultValue === undefined ? {} : { defaultValue })
      }
    }
    case 'collection':
      return {
        ref: entry.ref,
        name: entry.name,
        modes: entry.modes.map(({ ref, name }) => ({ ref, name })),
        defaultModeRef:
          entry.modes.find((mode) => mode.id === entry.defaultModeId)?.ref ??
          entry.modes[0]?.ref ??
          ''
      }
    case 'style': {
      const definition = entry.definition as DescribedStyle
      const summary = boundedText(
        definition.description || definition.descriptionMarkdown,
        MAX_SUMMARY_LENGTH
      )
      return {
        ref: entry.ref,
        name: entry.name,
        type: entry.styleType.toLowerCase() as DesignSystemCatalogStyle['type'],
        signature: styleSignature(definition),
        ...(summary ? { summary } : {})
      }
    }
    case 'shader':
      return {
        ref: entry.ref,
        name: entry.name,
        type: entry.shaderType
      }
    case 'mode':
      return undefined
  }
}

function containingPage(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node
  while (current && current.type !== 'PAGE') current = current.parent
  return current?.type === 'PAGE' ? current : null
}

async function resolveCatalogComponent(entry: CatalogComponent): Promise<ComponentNode> {
  const node = entry.reference.id ? await readOrNull(() => getNodeById(entry.reference.id!)) : null
  if (node?.type === 'COMPONENT') return node
  if (node?.type === 'COMPONENT_SET') return node.defaultVariant
  throw new Error(`Component definition "${entry.ref}" is no longer available.`)
}

function describeComponentLayout(component: ComponentNode) {
  if (component.layoutMode === 'NONE') return undefined
  return {
    mode: component.layoutMode,
    wrap: component.layoutWrap,
    primaryAxisAlignItems: component.primaryAxisAlignItems,
    counterAxisAlignItems: component.counterAxisAlignItems,
    primaryAxisSizingMode: component.primaryAxisSizingMode,
    counterAxisSizingMode: component.counterAxisSizingMode,
    itemSpacing: component.itemSpacing,
    counterAxisSpacing: component.counterAxisSpacing,
    paddingTop: component.paddingTop,
    paddingRight: component.paddingRight,
    paddingBottom: component.paddingBottom,
    paddingLeft: component.paddingLeft
  }
}

function anatomyPath(parent: string, node: SceneNode): string {
  const name = boundedText(node.name, 80) || node.type
  return parent ? `${parent} / ${name}` : name
}

async function describeComponentAnatomy(component: ComponentNode) {
  const stack = component.children
    .toReversed()
    .map((node) => ({ node, path: anatomyPath('', node) }))
  const candidates: Array<{ node: InstanceNode | SlotNode | TextNode; path: string }> = []
  let visited = 0
  let omitted = 0

  while (stack.length && visited < MAX_ANATOMY_VISITS) {
    const { node, path } = stack.pop()!
    visited += 1
    if (node.type === 'TEXT' || node.type === 'INSTANCE' || node.type === 'SLOT') {
      if (candidates.length < MAX_ANATOMY_NODES) candidates.push({ node, path })
      else omitted += 1
    }
    // A nested instance is already a semantic unit; its private subtree belongs to its own component.
    if ('children' in node && node.type !== 'INSTANCE') {
      for (const child of node.children.toReversed()) {
        stack.push({ node: child, path: anatomyPath(path, child) })
      }
    }
  }

  const nodes = await Promise.all(
    candidates.map(async ({ node, path }): Promise<Record<string, unknown>> => {
      const propertyReferences = node.componentPropertyReferences ?? undefined
      if (node.type === 'TEXT') {
        return {
          type: 'text',
          path,
          text: boundedText(node.characters, 160),
          ...(propertyReferences ? { propertyReferences } : {})
        }
      }
      if (node.type === 'SLOT') {
        return {
          type: 'slot',
          path,
          ...(propertyReferences ? { propertyReferences } : {})
        }
      }
      const mainComponent = await readOrNull(() => node.getMainComponentAsync())
      return {
        type: 'instance',
        path,
        ...(mainComponent
          ? {
              component: {
                name:
                  mainComponent.parent?.type === 'COMPONENT_SET'
                    ? mainComponent.parent.name
                    : mainComponent.name,
                key: mainComponent.key
              }
            }
          : {}),
        ...(node.isExposedInstance ? { exposed: true } : {}),
        ...(propertyReferences ? { propertyReferences } : {})
      }
    })
  )

  return {
    nodes,
    ...(omitted ? { omitted } : {}),
    ...(stack.length ? { truncated: true } : {})
  }
}

async function describeComponentDetail(entry: CatalogComponent) {
  const component = await resolveCatalogComponent(entry)
  const page = containingPage(component) ?? {
    id: (entry.definition as DescribedComponent).pageId,
    name: entry.pageName
  }
  const definition = describeComponent(component, page)
  const componentSet = component.parent?.type === 'COMPONENT_SET' ? component.parent : null
  const allVariants = componentSet
    ? componentSet.children
        .filter((node): node is ComponentNode => node.type === 'COMPONENT')
        .toSorted((left, right) => {
          if (left.id === componentSet.defaultVariant.id) return -1
          if (right.id === componentSet.defaultVariant.id) return 1
          return compareText(left.name, right.name)
        })
    : [component]
  const variants = allVariants.slice(0, MAX_COMPONENT_VARIANTS).map((variant) => ({
    id: variant.id,
    key: variant.key,
    name: variant.name,
    width: variant.width,
    height: variant.height,
    ...(variant.variantProperties ? { properties: variant.variantProperties } : {}),
    ...(variant.id === componentSet?.defaultVariant.id ? { default: true } : {})
  }))
  const anatomy = await describeComponentAnatomy(component)
  const layout = describeComponentLayout(component)
  return {
    ...definition,
    ...(layout ? { layout } : {}),
    variantCount: allVariants.length,
    variants,
    ...(allVariants.length > variants.length
      ? { omittedVariants: allVariants.length - variants.length }
      : {}),
    anatomy,
    previewNodeId: component.id
  }
}

type ComponentDetail = Awaited<ReturnType<typeof describeComponentDetail>>
type ComponentDetailProperty = NonNullable<ComponentDetail['properties']>[string]
type MutableComponentDetailProperty = Omit<
  ComponentDetailProperty,
  'description' | 'omittedOptions' | 'options' | 'preferredValues'
> & {
  description?: string
  omittedOptions?: number
  options?: string[]
  preferredValues?: Array<NonNullable<ComponentDetailProperty['preferredValues']>[number]>
}
type CompactComponentDetail = ComponentDetail & {
  detailTruncated?: true
  omittedProperties?: number
}

function exactCatalogPayload(
  catalogId: string,
  entry: CatalogEntry,
  definition: unknown
): GetDesignSystemResult {
  return {
    catalogId,
    components: [],
    variables: [],
    collections: [],
    styles: [],
    details: {
      ref: entry.ref,
      kind: entry.kind,
      definition
    }
  }
}

function exactResultFits(result: GetDesignSystemResult): boolean {
  return (
    measureCallToolResultBytes(buildGetDesignSystemToolResult(result)) <=
    MCP_TOOL_INLINE_BUDGET_BYTES
  )
}

function removeTailHalf<T>(items: T[]): T[] {
  return items.splice(Math.floor(items.length / 2))
}

function compactComponentDetailResult(
  catalogId: string,
  entry: CatalogComponent,
  source: ComponentDetail
): GetDesignSystemResult {
  const mutableProperties = source.properties
    ? (Object.fromEntries(
        Object.entries(source.properties).map(([name, property]) => [
          name,
          {
            ...property,
            ...(property.options ? { options: [...property.options] } : {}),
            ...(property.preferredValues ? { preferredValues: [...property.preferredValues] } : {})
          }
        ])
      ) as Record<string, MutableComponentDetailProperty>)
    : undefined
  const detail: CompactComponentDetail = {
    ...source,
    ...(mutableProperties ? { properties: mutableProperties } : {}),
    variants: source.variants.map((variant) => ({
      ...variant,
      ...(variant.properties ? { properties: { ...variant.properties } } : {})
    })),
    anatomy: { ...source.anatomy, nodes: [...source.anatomy.nodes] }
  }
  const originalAnatomyCount = source.anatomy.nodes.length + (source.anatomy.omitted ?? 0)
  const result = () => exactCatalogPayload(catalogId, entry, detail)
  const fits = () => exactResultFits(result())

  while (!fits() && detail.anatomy.nodes.length) {
    removeTailHalf(detail.anatomy.nodes)
    detail.anatomy.omitted = originalAnatomyCount - detail.anatomy.nodes.length
    detail.anatomy.truncated = true
    detail.detailTruncated = true
  }
  while (!fits() && detail.variants.length) {
    removeTailHalf(detail.variants)
    detail.omittedVariants = detail.variantCount - detail.variants.length
    detail.detailTruncated = true
  }

  const verboseFields = [
    'descriptionMarkdown',
    'componentSetDescriptionMarkdown',
    'documentationLinks',
    'componentSetDocumentationLinks',
    'description',
    'componentSetDescription'
  ] as const
  for (const field of verboseFields) {
    if (fits()) break
    delete detail[field]
    detail.detailTruncated = true
  }

  if (!fits()) {
    for (const property of Object.values(mutableProperties ?? {})) {
      delete property.description
      delete property.preferredValues
    }
    detail.detailTruncated = true
  }
  while (!fits()) {
    let removed = 0
    for (const property of Object.values(mutableProperties ?? {})) {
      if (!property.options?.length) continue
      const removeCount = removeTailHalf(property.options).length
      property.omittedOptions = (property.omittedOptions ?? 0) + removeCount
      removed += removeCount
    }
    if (!removed) break
    detail.detailTruncated = true
  }
  const propertyNames = Object.keys(mutableProperties ?? {})
  while (!fits() && propertyNames.length) {
    const removedNames = removeTailHalf(propertyNames)
    for (const name of removedNames) {
      delete mutableProperties?.[name]
    }
    detail.omittedProperties = (detail.omittedProperties ?? 0) + removedNames.length
    detail.detailTruncated = true
  }
  if (fits()) return result()

  const minimalDefinition = {
    id: source.id,
    key: source.key,
    name: boundedText(source.name, MAX_SUMMARY_LENGTH) ?? source.name,
    pageId: source.pageId,
    pageName: boundedText(source.pageName, MAX_SUMMARY_LENGTH) ?? source.pageName,
    width: source.width,
    height: source.height,
    remote: source.remote,
    ...('componentSetId' in source
      ? {
          componentSetId: source.componentSetId,
          componentSetKey: source.componentSetKey,
          componentSetName:
            boundedText(source.componentSetName, MAX_SUMMARY_LENGTH) ?? source.componentSetName
        }
      : {}),
    variantCount: source.variantCount,
    variants: [],
    ...(source.variantCount ? { omittedVariants: source.variantCount } : {}),
    anatomy: {
      nodes: [],
      ...(originalAnatomyCount ? { omitted: originalAnatomyCount } : {}),
      truncated: true as const
    },
    previewNodeId: source.previewNodeId,
    detailTruncated: true as const,
    ...(source.properties ? { omittedProperties: Object.keys(source.properties).length } : {})
  }
  const minimalResult = exactCatalogPayload(catalogId, entry, minimalDefinition)
  if (!exactResultFits(minimalResult)) {
    throw new Error(`Design-system component identity "${entry.ref}" exceeds the inline budget.`)
  }
  return minimalResult
}

async function exactCatalogResult(catalogId: string, ref: string): Promise<GetDesignSystemResult> {
  const catalog = requireDesignSystemCatalog(catalogId, figma.fileKey)
  const entry = catalog.entries.get(ref)
  if (!entry) throw new Error(`Unknown design-system ref ${ref} in catalog ${catalogId}`)
  const definition =
    entry.kind === 'component' ? await describeComponentDetail(entry) : entry.definition
  const result = exactCatalogPayload(catalogId, entry, definition)
  if (exactResultFits(result)) return result
  if (entry.kind === 'component') {
    return compactComponentDetailResult(catalogId, entry, definition as ComponentDetail)
  }
  throw new Error(`Design-system definition "${ref}" exceeds the 64 KiB inline result budget.`)
}

type CatalogDisplayKind = Exclude<CatalogEntry['kind'], 'mode'>

function orderEntries(entries: CatalogEntry[]): CatalogEntry[] {
  const interleave = (kinds: ReadonlyArray<CatalogDisplayKind>): CatalogEntry[] => {
    const groups = kinds.map((kind) => entries.filter((entry) => entry.kind === kind))
    const ordered: CatalogEntry[] = []
    for (let index = 0; ; index += 1) {
      let added = false
      for (const group of groups) {
        const entry = group[index]
        if (!entry) continue
        ordered.push(entry)
        added = true
      }
      if (!added) return ordered
    }
  }
  return [
    ...interleave(['component', 'variable', 'style']),
    ...interleave(['collection', 'shader'])
  ]
}

function buildCompactResult(
  catalogId: string,
  entries: CatalogEntry[],
  warnings: string[],
  cursor = 0
): GetDesignSystemResult {
  const selected: CatalogEntry[] = []
  const build = (): GetDesignSystemResult => {
    const result: GetDesignSystemResult = {
      catalogId,
      components: [],
      variables: [],
      collections: [],
      styles: []
    }
    const shaders: DesignSystemCatalogShader[] = []
    for (const entry of selected) {
      const compact = compactEntry(entry)
      if (!compact) continue
      if (entry.kind === 'component') {
        result.components.push(compact as DesignSystemCatalogComponent)
      } else if (entry.kind === 'variable') {
        result.variables.push(compact as DesignSystemCatalogVariable)
      } else if (entry.kind === 'collection') {
        result.collections.push(compact as DesignSystemCatalogCollection)
      } else if (entry.kind === 'style') {
        result.styles.push(compact as DesignSystemCatalogStyle)
      } else if (entry.kind === 'shader') {
        shaders.push(compact as DesignSystemCatalogShader)
      }
    }
    if (shaders.length) result.shaders = shaders
    const nextCursor = cursor + selected.length
    const remaining = entries.slice(nextCursor)
    const counts: Record<string, number> = Object.fromEntries(
      (
        [
          ['components', 'component'],
          ['variables', 'variable'],
          ['collections', 'collection'],
          ['styles', 'style'],
          ['shaders', 'shader']
        ] as const
      )
        .map(([label, kind]) => [label, remaining.filter((entry) => entry.kind === kind).length])
        .filter(([, count]) => count)
    )
    if (remaining.length) result.nextCursor = nextCursor
    if (Object.keys(counts).length) result.omitted = counts
    if (warnings.length) result.warnings = warnings
    return result
  }

  for (const candidate of entries.slice(cursor)) {
    selected.push(candidate)
    if (utf8Bytes(build()) <= TARGET_BYTES) continue
    if (selected.length > 1) selected.pop()
    break
  }
  return build()
}

function continueCatalog(catalogId: string, cursor: number): GetDesignSystemResult {
  const catalog = requireDesignSystemCatalog(catalogId, figma.fileKey)
  if (cursor >= catalog.orderedRefs.length) {
    throw new Error(`Unknown design-system cursor ${cursor} in catalog ${catalogId}`)
  }
  const entries = catalog.orderedRefs.map((ref) => catalog.entries.get(ref)!)
  return buildCompactResult(catalogId, entries, catalog.warnings, cursor)
}

async function createCatalog(): Promise<GetDesignSystemResult> {
  const componentWarnings: string[] = []
  const variableWarnings: string[] = []
  const styleWarnings: string[] = []
  const shaderWarnings: string[] = []
  const [components, styles, availableShaders] = await Promise.all([
    collectComponents(componentWarnings),
    collectStyles(styleWarnings),
    collectShaders(shaderWarnings)
  ])
  const referencedVariableIds = new Set<string>()
  for (const component of components) {
    for (const property of Object.values(component.properties ?? {})) {
      if (property.defaultVariableId) referencedVariableIds.add(property.defaultVariableId)
    }
  }
  collectStyleVariableIds(styles, referencedVariableIds)
  for (const shader of availableShaders) {
    collectVariableAliasIds(shader.propertyDefinitions, referencedVariableIds)
  }
  const variableData = await collectVariables(referencedVariableIds, variableWarnings)
  const variables = variableData.variables
  const shaders = availableShaders.map(describeShader)
  const warnings = [...componentWarnings, ...variableWarnings, ...styleWarnings, ...shaderWarnings]
  const orderedComponents = sortByName(groupComponents(components))
  const orderedVariables = sortByName(variables)
  const orderedCollections = sortByName(variableData.collections)
  const orderedStyles = sortByName(styles.map(describeStyle))
  const orderedShaders = sortByName(shaders)
  const entries: CatalogEntry[] = []
  const componentTags = new Set<string>()
  for (const [index, family] of orderedComponents.entries()) {
    const component = family.item
    const tag = uniqueName(
      toIdentifier(component.componentSetName ?? component.name, `Component${index + 1}`, true),
      componentTags
    )
    entries.push({
      kind: 'component',
      ref: `c${index + 1}`,
      tag,
      name: component.componentSetName ?? component.name,
      reference: { id: component.id, key: component.key },
      nativeReferences: family.variants.map((variant) => ({
        id: variant.id,
        key: variant.key
      })),
      nativeSize: { width: component.width, height: component.height },
      pageName: component.pageName,
      variantCount: family.variantCount,
      properties: catalogComponentProperties(component),
      definition: component
    })
  }

  for (const [index, collection] of orderedCollections.entries()) {
    const ref = `k${index + 1}`
    const modes = collection.modes.map((mode, modeIndex) => ({
      ref: `m${index + 1}_${modeIndex + 1}`,
      id: mode.id,
      name: mode.name
    }))
    const entry: CatalogCollection = {
      kind: 'collection',
      ref,
      name: collection.name,
      reference: { id: collection.id, ...(collection.key ? { key: collection.key } : {}) },
      modes,
      defaultModeId: collection.defaultModeId,
      definition: collection
    }
    entries.push(
      entry,
      ...modes.map(
        (mode): CatalogEntry => ({
          kind: 'mode',
          ref: mode.ref,
          name: mode.name,
          id: mode.id,
          collectionRef: ref,
          definition: { id: mode.id, name: mode.name }
        })
      )
    )
  }

  for (const [index, variable] of orderedVariables.entries()) {
    const collection = variableData.collections.find((item) => item.id === variable.collectionId)
    const modeId = collection?.defaultModeId
    entries.push({
      kind: 'variable',
      ref: `v${index + 1}`,
      name: variable.name,
      reference: { id: variable.id, key: variable.key },
      resolvedType: variable.resolvedType,
      ...(modeId ? { defaultValue: variable.valuesByMode?.[modeId] } : {}),
      definition: variable
    })
  }

  for (const [index, style] of orderedStyles.entries()) {
    entries.push({
      kind: 'style',
      ref: `s${index + 1}`,
      name: style.name,
      reference: { id: style.id, key: style.key },
      styleType: style.type,
      definition: style
    })
  }
  for (const [index, shader] of orderedShaders.entries()) {
    entries.push({
      kind: 'shader',
      ref: `h${index + 1}`,
      name: shader.name,
      id: shader.id,
      shaderType: shader.type,
      definition: shader
    })
  }

  const orderedEntries = orderEntries(entries.filter((entry) => entry.kind !== 'mode'))
  const catalog = registerDesignSystemCatalog(
    entries,
    figma.fileKey ?? undefined,
    orderedEntries.map((entry) => entry.ref),
    warnings
  )
  return buildCompactResult(catalog.id, orderedEntries, warnings)
}

let pendingCatalog: Promise<GetDesignSystemResult> | undefined

export async function handleGetDesignSystem(
  args: GetDesignSystemParametersInput = {}
): Promise<GetDesignSystemResult> {
  if (args.catalogId) {
    return args.ref
      ? exactCatalogResult(args.catalogId, args.ref)
      : continueCatalog(args.catalogId, args.cursor!)
  }
  pendingCatalog ??= createCatalog().finally(() => {
    pendingCatalog = undefined
  })
  return pendingCatalog
}
