import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGetDesignSystem } from '@/mcp/tools/design-system'

function component(
  id: string,
  name: string,
  overrides: Partial<ComponentNode> = {}
): ComponentNode {
  return {
    id,
    key: `${id}-key`,
    name,
    description: '',
    remote: false,
    componentPropertyDefinitions: {},
    parent: null,
    ...overrides
  } as unknown as ComponentNode
}

function variable(
  id: string,
  name: string,
  collectionId: string,
  overrides: Partial<Variable> = {}
): Variable {
  return {
    id,
    key: `${id}-key`,
    name,
    description: '',
    remote: false,
    resolvedType: 'COLOR',
    scopes: ['ALL_FILLS'],
    variableCollectionId: collectionId,
    ...overrides
  } as Variable
}

function stubFigma({
  boundNodes = [],
  components = [],
  instances = [],
  localCollections = [],
  localVariables = [],
  remoteCollections = new Map<string, VariableCollection>(),
  remoteVariables = new Map<string, Variable>()
}: {
  boundNodes?: SceneNode[]
  components?: ComponentNode[]
  instances?: InstanceNode[]
  localCollections?: VariableCollection[]
  localVariables?: Variable[]
  remoteCollections?: Map<string, VariableCollection>
  remoteVariables?: Map<string, Variable>
} = {}): void {
  vi.stubGlobal('figma', {
    currentPage: {
      id: '0:1',
      name: 'Design System',
      findAll: vi.fn(() => boundNodes),
      findAllWithCriteria: vi.fn(({ types }: { types: string[] }) =>
        types[0] === 'COMPONENT' ? components : instances
      )
    },
    variables: {
      getLocalVariablesAsync: vi.fn().mockResolvedValue(localVariables),
      getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue(localCollections),
      getVariableByIdAsync: vi.fn((id: string) => Promise.resolve(remoteVariables.get(id) ?? null)),
      getVariableCollectionByIdAsync: vi.fn((id: string) =>
        Promise.resolve(remoteCollections.get(id) ?? null)
      )
    }
  } as unknown as PluginAPI)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/design-system', () => {
  it('returns query-ranked component metadata with stable ids and property options', async () => {
    const set = {
      id: 'set:1',
      type: 'COMPONENT_SET',
      name: '按钮 Button',
      componentPropertyDefinitions: {
        Size: {
          type: 'VARIANT',
          defaultValue: 'Medium',
          variantOptions: ['Small', 'Medium', 'Large']
        },
        Icon: {
          type: 'INSTANCE_SWAP',
          defaultValue: 'icon:default',
          preferredValues: [{ type: 'COMPONENT', key: 'icon-key' }]
        }
      }
    } as unknown as ComponentSetNode
    const local = component('component:1', '按钮 / Primary', {
      description: 'Primary action',
      parent: set
    })
    const remote = component('component:2', 'Input', { remote: true })
    const instance = {
      getMainComponentAsync: vi.fn().mockResolvedValue(remote)
    } as unknown as InstanceNode
    stubFigma({ components: [local], instances: [instance] })

    const result = await handleGetDesignSystem({ query: '按钮' })

    expect(result.components).toEqual([
      {
        id: 'component:1',
        key: 'component:1-key',
        name: '按钮 / Primary',
        description: 'Primary action',
        componentSetName: '按钮 Button',
        properties: {
          Size: {
            type: 'VARIANT',
            defaultValue: 'Medium',
            options: ['Small', 'Medium', 'Large']
          },
          Icon: {
            type: 'INSTANCE_SWAP',
            defaultValue: 'icon:default',
            options: ['icon-key']
          }
        },
        remote: false
      }
    ])
    expect(result.page).toEqual({ id: '0:1', name: 'Design System' })
    expect(result.warnings).toEqual(['No local or currently bound variables were found.'])
  })

  it('includes local and currently bound remote variables and resolves collection names', async () => {
    const local = variable('variable:1', 'Spacing / Small', 'collection:1', {
      resolvedType: 'FLOAT',
      scopes: ['GAP']
    })
    const remote = variable('variable:2', 'Color / Primary', 'collection:2', {
      description: 'Brand foreground',
      remote: true
    })
    const boundNode = {
      boundVariables: {
        fills: [{ type: 'VARIABLE_ALIAS', id: 'variable:2' }],
        width: { type: 'VARIABLE_ALIAS', id: 'variable:1' }
      }
    } as unknown as SceneNode
    stubFigma({
      boundNodes: [boundNode],
      localVariables: [local],
      localCollections: [{ id: 'collection:1', name: 'Dimensions' } as VariableCollection],
      remoteVariables: new Map([[remote.id, remote]]),
      remoteCollections: new Map([
        ['collection:2', { id: 'collection:2', name: 'Brand' } as VariableCollection]
      ])
    })

    const result = await handleGetDesignSystem()

    expect(result.variables).toEqual([
      {
        id: 'variable:2',
        key: 'variable:2-key',
        name: 'Color / Primary',
        collectionName: 'Brand',
        description: 'Brand foreground',
        remote: true,
        resolvedType: 'COLOR',
        scopes: ['ALL_FILLS']
      },
      {
        id: 'variable:1',
        key: 'variable:1-key',
        name: 'Spacing / Small',
        collectionName: 'Dimensions',
        remote: false,
        resolvedType: 'FLOAT',
        scopes: ['GAP']
      }
    ])
  })

  it('returns concise warnings when components or variables are unavailable', async () => {
    const brokenInstance = {
      getMainComponentAsync: vi.fn().mockRejectedValue(new Error('unavailable'))
    } as unknown as InstanceNode
    stubFigma({ instances: [brokenInstance] })
    const variables = (
      figma as PluginAPI & {
        variables: { getLocalVariablesAsync: ReturnType<typeof vi.fn> }
      }
    ).variables
    variables.getLocalVariablesAsync.mockRejectedValue(new Error('no variables API'))

    const result = await handleGetDesignSystem({ query: 'missing' })

    expect(result.components).toEqual([])
    expect(result.variables).toEqual([])
    expect(result.warnings).toEqual([
      'No components were found on the current page.',
      'Variables could not be read in the current Figma context.'
    ])
  })

  it('caps broad discovery responses deterministically', async () => {
    const components = Array.from({ length: 45 }, (_, index) =>
      component(`component:${index}`, `Component ${String(index).padStart(2, '0')}`)
    )
    const variables = Array.from({ length: 65 }, (_, index) =>
      variable(`variable:${index}`, `Variable ${String(index).padStart(2, '0')}`, 'collection:1')
    )
    stubFigma({
      components,
      localVariables: variables,
      localCollections: [{ id: 'collection:1', name: 'Tokens' } as VariableCollection]
    })

    const result = await handleGetDesignSystem()

    expect(result.components).toHaveLength(40)
    expect(result.variables).toHaveLength(60)
    expect(result.components[0]?.name).toBe('Component 00')
    expect(result.variables[0]?.name).toBe('Variable 00')
  })
})
