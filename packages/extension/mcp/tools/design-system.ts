import type {
  DesignSystemComponent,
  DesignSystemComponentProperty,
  DesignSystemVariable,
  GetDesignSystemParametersInput,
  GetDesignSystemResult
} from '@tempad-dev/shared'

const MAX_COMPONENTS = 40
const MAX_VARIABLES = 60

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function queryTerms(query?: string): string[] {
  return query ? normalizeSearchText(query).split(/\s+/).filter(Boolean) : []
}

function scoreCandidate(name: string, searchText: string, terms: string[]): number {
  if (!terms.length) return 1
  const normalizedName = normalizeSearchText(name)
  let score = 0
  for (const term of terms) {
    if (normalizedName === term) {
      score += 20
    } else if (normalizedName.startsWith(term)) {
      score += 10
    } else if (normalizedName.includes(term)) {
      score += 6
    } else if (searchText.includes(term)) {
      score += 2
    }
  }
  return score
}

function rankAndLimit<T extends { name: string }>(
  items: T[],
  terms: string[],
  getSearchText: (item: T) => string,
  limit: number
): T[] {
  return items
    .map((item) => ({
      item,
      score: scoreCandidate(item.name, normalizeSearchText(getSearchText(item)), terms)
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name)
    )
    .slice(0, limit)
    .map((entry) => entry.item)
}

async function readOrNull<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

function componentProperties(
  definitions: ComponentPropertyDefinitions
): Record<string, DesignSystemComponentProperty> | undefined {
  const entries = Object.entries(definitions).map(([name, definition]) => {
    const options =
      definition.type === 'VARIANT'
        ? definition.variantOptions
        : definition.preferredValues?.map((value) => value.key)
    return [
      name,
      {
        type: definition.type,
        defaultValue: definition.defaultValue,
        ...(options?.length ? { options } : {})
      }
    ] as const
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function describeComponent(component: ComponentNode): DesignSystemComponent {
  const componentSet = component.parent?.type === 'COMPONENT_SET' ? component.parent : null
  const definitions =
    componentSet?.componentPropertyDefinitions ?? component.componentPropertyDefinitions
  const properties = componentProperties(definitions)
  const description = component.description.trim()
  return {
    id: component.id,
    key: component.key,
    name: component.name,
    ...(description ? { description } : {}),
    ...(componentSet ? { componentSetName: componentSet.name } : {}),
    ...(properties ? { properties } : {}),
    remote: component.remote
  }
}

async function collectComponents(warnings: string[]): Promise<DesignSystemComponent[]> {
  const localComponents = figma.currentPage.findAllWithCriteria({
    types: ['COMPONENT']
  })
  const byId = new Map(localComponents.map((component) => [component.id, component]))

  const instances = figma.currentPage.findAllWithCriteria({
    types: ['INSTANCE']
  })
  const mainComponents = await Promise.all(
    instances.map((instance) => readOrNull(() => instance.getMainComponentAsync()))
  )
  for (const component of mainComponents) {
    if (component) byId.set(component.id, component)
  }

  if (!byId.size) {
    warnings.push('No components were found on the current page.')
  }
  return [...byId.values()].map(describeComponent)
}

async function collectVariables(warnings: string[]): Promise<DesignSystemVariable[]> {
  try {
    const [localVariables, localCollections] = await Promise.all([
      figma.variables.getLocalVariablesAsync(),
      figma.variables.getLocalVariableCollectionsAsync()
    ])
    const variablesById = new Map(localVariables.map((variable) => [variable.id, variable]))
    const boundVariableIds = new Set<string>()
    for (const node of figma.currentPage.findAll()) {
      if ('boundVariables' in node) {
        collectVariableAliasIds(node.boundVariables, boundVariableIds)
      }
    }
    const remoteVariables = await Promise.all(
      [...boundVariableIds]
        .filter((id) => !variablesById.has(id))
        .map((id) => readOrNull(() => figma.variables.getVariableByIdAsync(id)))
    )
    for (const variable of remoteVariables) {
      if (variable) variablesById.set(variable.id, variable)
    }

    const variables = [...variablesById.values()]
    const collectionsById = new Map(
      localCollections.map((collection) => [collection.id, collection.name])
    )
    const remoteCollectionIds = [
      ...new Set(
        variables
          .map((variable) => variable.variableCollectionId)
          .filter((id) => !collectionsById.has(id))
      )
    ]
    const remoteCollections = await Promise.all(
      remoteCollectionIds.map((id) =>
        readOrNull(() => figma.variables.getVariableCollectionByIdAsync(id))
      )
    )
    for (const collection of remoteCollections) {
      if (collection) collectionsById.set(collection.id, collection.name)
    }

    if (!variables.length) {
      warnings.push('No local or currently bound variables were found.')
    }
    return variables.map((variable) => {
      const description = variable.description.trim()
      const scopes = variable.scopes?.map(String)
      return {
        id: variable.id,
        key: variable.key,
        name: variable.name,
        collectionName: collectionsById.get(variable.variableCollectionId) ?? 'Unknown collection',
        ...(description ? { description } : {}),
        remote: variable.remote,
        resolvedType: variable.resolvedType,
        ...(scopes?.length ? { scopes } : {})
      }
    })
  } catch {
    warnings.push('Variables could not be read in the current Figma context.')
    return []
  }
}

function collectVariableAliasIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableAliasIds(item, ids))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.type === 'VARIABLE_ALIAS' && typeof record.id === 'string') {
    ids.add(record.id)
    return
  }
  Object.values(record).forEach((item) => collectVariableAliasIds(item, ids))
}

export async function handleGetDesignSystem(
  args?: GetDesignSystemParametersInput
): Promise<GetDesignSystemResult> {
  const componentWarnings: string[] = []
  const variableWarnings: string[] = []
  const terms = queryTerms(args?.query)
  const [components, variables] = await Promise.all([
    collectComponents(componentWarnings),
    collectVariables(variableWarnings)
  ])
  const warnings = [...componentWarnings, ...variableWarnings]

  const rankedComponents = rankAndLimit(
    components,
    terms,
    (component) =>
      [
        component.name,
        component.componentSetName,
        component.description,
        ...Object.keys(component.properties ?? {})
      ]
        .filter(Boolean)
        .join(' '),
    MAX_COMPONENTS
  )
  const rankedVariables = rankAndLimit(
    variables,
    terms,
    (variable) =>
      [variable.name, variable.collectionName, variable.description, ...(variable.scopes ?? [])]
        .filter(Boolean)
        .join(' '),
    MAX_VARIABLES
  )

  return {
    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name
    },
    components: rankedComponents,
    variables: rankedVariables,
    ...(warnings.length ? { warnings } : {})
  }
}
