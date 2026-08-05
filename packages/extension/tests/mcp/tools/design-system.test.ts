import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGetDesignSystem } from '@/mcp/tools/design-system'
import {
  registerDesignSystemCatalog,
  requireDesignSystemCatalog
} from '@/mcp/tools/design-system-catalog'

function component(
  id: string,
  name: string,
  overrides: Partial<ComponentNode> = {}
): ComponentNode {
  return {
    id,
    type: 'COMPONENT',
    key: `${id}-key`,
    name,
    description: '',
    documentationLinks: [],
    width: 120,
    height: 40,
    children: [],
    layoutMode: 'NONE',
    variantProperties: null,
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
    valuesByMode: {},
    ...overrides
  } as Variable
}

function collection(
  id: string,
  name: string,
  overrides: Partial<VariableCollection> = {}
): VariableCollection {
  return {
    id,
    key: `${id}-key`,
    name,
    remote: false,
    variableIds: [],
    modes: [
      { modeId: `${id}:light`, name: 'Light' },
      { modeId: `${id}:dark`, name: 'Dark' }
    ],
    defaultModeId: `${id}:light`,
    ...overrides
  } as VariableCollection
}

function style(
  id: string,
  name: string,
  type: StyleType,
  overrides: Partial<BaseStyle> = {}
): BaseStyle {
  const definition =
    type === 'PAINT'
      ? { paints: [] }
      : type === 'TEXT'
        ? {
            fontName: { family: 'Inter', style: 'Medium' },
            fontSize: 16,
            textDecoration: 'NONE',
            letterSpacing: { unit: 'PIXELS', value: 0 },
            lineHeight: { unit: 'PIXELS', value: 24 },
            leadingTrim: 'NONE',
            paragraphIndent: 0,
            paragraphSpacing: 0,
            listSpacing: 0,
            hangingPunctuation: false,
            hangingList: false,
            textCase: 'ORIGINAL'
          }
        : type === 'EFFECT'
          ? { effects: [] }
          : { layoutGrids: [] }
  return {
    id,
    key: `${id}-key`,
    name,
    type,
    description: '',
    descriptionMarkdown: '',
    documentationLinks: [],
    remote: false,
    ...definition,
    ...overrides
  } as BaseStyle
}

function stubFigma({
  components = [],
  fileKey,
  localCollections = [],
  localStyles = [],
  localVariables = [],
  pages,
  shaders = []
}: {
  components?: ComponentNode[]
  fileKey?: string
  localCollections?: VariableCollection[]
  localStyles?: BaseStyle[]
  localVariables?: Variable[]
  pages?: Array<{
    id: string
    name: string
    components?: ComponentNode[]
    loaded?: boolean
  }>
  shaders?: Shader[]
} = {}): void {
  const pageNodes = (pages ?? [{ id: 'page:current', name: 'Current', components }]).map(
    (page) =>
      ({
        id: page.id,
        type: 'PAGE',
        name: page.name,
        findAllWithCriteria: vi.fn(() => {
          if (page.loaded === false) throw new Error('Page is not loaded')
          return page.components ?? []
        })
      }) as unknown as PageNode
  )
  const nodes = new Map<string, BaseNode>()
  for (const page of pageNodes) nodes.set(page.id, page)
  for (const component of (pages ?? [{ components }]).flatMap((page) => page.components ?? [])) {
    nodes.set(component.id, component)
    if (component.parent?.type === 'COMPONENT_SET') nodes.set(component.parent.id, component.parent)
  }
  vi.stubGlobal('figma', {
    fileKey,
    loadAllPagesAsync: vi.fn().mockResolvedValue(undefined),
    root: { children: pageNodes },
    currentPage: pageNodes[0],
    getNodeByIdAsync: vi.fn((id: string) => Promise.resolve(nodes.get(id) ?? null)),
    getLocalPaintStylesAsync: vi
      .fn()
      .mockResolvedValue(localStyles.filter((item) => item.type === 'PAINT')),
    getLocalTextStylesAsync: vi
      .fn()
      .mockResolvedValue(localStyles.filter((item) => item.type === 'TEXT')),
    getLocalEffectStylesAsync: vi
      .fn()
      .mockResolvedValue(localStyles.filter((item) => item.type === 'EFFECT')),
    getLocalGridStylesAsync: vi
      .fn()
      .mockResolvedValue(localStyles.filter((item) => item.type === 'GRID')),
    listAvailableShaders: vi.fn().mockResolvedValue(shaders),
    variables: {
      getLocalVariablesAsync: vi.fn().mockResolvedValue(localVariables),
      getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue(localCollections),
      getVariableByIdAsync: vi.fn().mockResolvedValue(null),
      getVariableCollectionByIdAsync: vi.fn().mockResolvedValue(null)
    }
  } as unknown as PluginAPI)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/design-system', () => {
  it('returns one custom tag per component family', async () => {
    const set = {
      id: 'set:button',
      key: 'set:button-key',
      type: 'COMPONENT_SET',
      name: 'Action Button',
      description: 'Primary actions',
      documentationLinks: [],
      componentPropertyDefinitions: {
        Size: {
          type: 'VARIANT',
          defaultValue: 'Medium',
          variantOptions: ['Small', 'Medium', 'Large']
        },
        'Show icon#1:2': { type: 'BOOLEAN', defaultValue: true },
        Label: { type: 'TEXT', defaultValue: 'Continue' },
        Content: { type: 'SLOT', defaultValue: '' }
      }
    } as unknown as ComponentSetNode
    const primary = component('component:primary', 'Primary', {
      parent: set,
      width: 144,
      height: 48,
      variantProperties: { State: 'Default' }
    })
    const hover = component('component:hover', 'Hover', {
      parent: set,
      variantProperties: { State: 'Hover' }
    })
    Object.assign(set, { defaultVariant: primary, children: [primary, hover] })
    stubFigma({ components: [hover, primary] })

    const result = await handleGetDesignSystem({})

    expect(result.components).toEqual([
      {
        ref: 'c1',
        tag: 'ActionButton',
        name: 'Action Button',
        summary: 'Primary actions',
        page: 'Current',
        variantCount: 2,
        nativeSize: { width: 144, height: 48 },
        props: {
          size: {
            type: 'variant',
            default: 'Medium',
            options: ['Small', 'Medium', 'Large']
          },
          showIcon: { type: 'boolean', default: true },
          label: { type: 'text', default: 'Continue' }
        }
      }
    ])
    expect(result.catalogId).toMatch(/^ds_/)

    const detail = await handleGetDesignSystem({
      catalogId: result.catalogId,
      ref: 'c1'
    })
    expect(detail.details).toMatchObject({
      ref: 'c1',
      kind: 'component',
      definition: {
        id: 'component:primary',
        componentSetId: 'set:button',
        isDefaultVariant: true,
        variantCount: 2,
        variants: [
          expect.objectContaining({ id: 'component:primary', default: true }),
          expect.objectContaining({ id: 'component:hover' })
        ],
        anatomy: { nodes: [] },
        previewNodeId: 'component:primary'
      }
    })
    expect(detail.components).toEqual([])
  })

  it('returns bounded component anatomy only when its exact ref is requested', async () => {
    const icon = component('component:icon', 'Icon')
    const label = {
      id: 'text:label',
      type: 'TEXT',
      name: 'Label',
      characters: 'Continue',
      componentPropertyReferences: { characters: 'Label#1:2' }
    } as unknown as TextNode
    const unnamed = {
      id: 'text:unnamed',
      type: 'TEXT',
      name: '',
      characters: 'Fallback path'
    } as unknown as TextNode
    const nestedIcon = {
      id: 'instance:icon',
      type: 'INSTANCE',
      name: 'Leading icon',
      children: [
        {
          id: 'text:private-icon-label',
          type: 'TEXT',
          name: 'Private icon label',
          characters: 'Hidden implementation detail'
        }
      ],
      isExposedInstance: true,
      componentPropertyReferences: { mainComponent: 'Icon#1:3' },
      getMainComponentAsync: vi.fn().mockResolvedValue(icon)
    } as unknown as InstanceNode
    stubFigma({
      components: [
        component('component:button', 'Button', {
          children: [label, unnamed, nestedIcon],
          layoutMode: 'HORIZONTAL',
          layoutWrap: 'NO_WRAP',
          primaryAxisAlignItems: 'CENTER',
          counterAxisAlignItems: 'CENTER',
          primaryAxisSizingMode: 'AUTO',
          counterAxisSizingMode: 'AUTO',
          itemSpacing: 8,
          counterAxisSpacing: 0,
          paddingTop: 8,
          paddingRight: 12,
          paddingBottom: 8,
          paddingLeft: 12
        })
      ]
    })

    const catalog = await handleGetDesignSystem({})
    expect(catalog.components[0]).not.toHaveProperty('anatomy')

    const result = await handleGetDesignSystem({ catalogId: catalog.catalogId, ref: 'c1' })
    expect(result.details?.definition).toMatchObject({
      layout: { mode: 'HORIZONTAL', itemSpacing: 8 },
      anatomy: {
        nodes: [
          {
            type: 'text',
            path: 'Label',
            text: 'Continue',
            propertyReferences: { characters: 'Label#1:2' }
          },
          {
            type: 'text',
            path: 'TEXT',
            text: 'Fallback path'
          },
          {
            type: 'instance',
            path: 'Leading icon',
            component: { name: 'Icon', key: 'component:icon-key' },
            exposed: true,
            propertyReferences: { mainComponent: 'Icon#1:3' }
          }
        ]
      },
      previewNodeId: 'component:button'
    })
    expect(
      (result.details?.definition as { anatomy: { nodes: unknown[] } }).anatomy.nodes
    ).toHaveLength(3)
  })

  it('returns short variable, collection, and mode refs with the default value', async () => {
    const foreground = variable('variable:foreground', 'Text / Foreground', 'collection:colors', {
      valuesByMode: {
        'collection:colors:light': { r: 0.1, g: 0.2, b: 0.3 },
        'collection:colors:dark': { r: 0.9, g: 0.9, b: 0.9 }
      }
    })
    const colors = collection('collection:colors', 'Semantic colors', {
      variableIds: [foreground.id]
    })
    stubFigma({
      localCollections: [colors],
      localVariables: [foreground]
    })

    const result = await handleGetDesignSystem({})

    expect(result.variables).toEqual([
      {
        ref: 'v1',
        name: 'Text / Foreground',
        collection: 'Semantic colors',
        type: 'color',
        scopes: ['ALL_FILLS'],
        defaultValue: '#1A334D'
      }
    ])
    expect(result.collections).toEqual([
      {
        ref: 'k1',
        name: 'Semantic colors',
        modes: [
          { ref: 'm1_1', name: 'Light' },
          { ref: 'm1_2', name: 'Dark' }
        ],
        defaultModeRef: 'm1_1'
      }
    ])

    const modeDetail = await handleGetDesignSystem({
      catalogId: result.catalogId,
      ref: 'm1_2'
    })
    expect(modeDetail.details).toEqual({
      ref: 'm1_2',
      kind: 'mode',
      definition: { id: 'collection:colors:dark', name: 'Dark' }
    })
  })

  it('clamps out-of-range native color channels in compact summaries', async () => {
    const accent = variable('variable:accent', 'Accent', 'collection:colors', {
      valuesByMode: {
        'collection:colors:light': { r: -1, g: 2, b: 0.5, a: 1.5 }
      }
    })
    stubFigma({
      localCollections: [collection('collection:colors', 'Colors', { variableIds: [accent.id] })],
      localVariables: [accent]
    })

    const result = await handleGetDesignSystem({})

    expect(result.variables[0]?.defaultValue).toBe('#00FF80FF')
  })

  it('summarizes styles and shaders while keeping exact definitions on demand', async () => {
    stubFigma({
      localStyles: [
        style('style:heading', 'Typography / Heading', 'TEXT', {
          descriptionMarkdown: 'Page **heading**',
          fontSize: 32
        }),
        style('style:shadow', 'Elevation / Floating', 'EFFECT', {
          effects: [
            {
              type: 'DROP_SHADOW',
              color: { r: 0, g: 0, b: 0, a: 0.2 },
              offset: { x: 0, y: 4 },
              radius: 12,
              spread: 0,
              visible: true,
              blendMode: 'NORMAL'
            }
          ]
        })
      ],
      shaders: [
        {
          id: 'shader:aurora',
          name: 'Aurora',
          type: 'fill',
          imported: false
        } as Shader
      ]
    })

    const result = await handleGetDesignSystem({})

    expect(result.styles).toEqual([
      {
        ref: 's1',
        name: 'Elevation / Floating',
        type: 'effect',
        signature: 'drop_shadow'
      },
      {
        ref: 's2',
        name: 'Typography / Heading',
        type: 'text',
        signature: 'Inter Medium, 32px',
        summary: 'Page **heading**'
      }
    ])
    expect(result.shaders).toEqual([{ ref: 'h1', name: 'Aurora', type: 'fill' }])

    const detail = await handleGetDesignSystem({
      catalogId: result.catalogId,
      ref: 's1'
    })
    expect(detail.details).toMatchObject({
      ref: 's1',
      kind: 'style',
      definition: {
        id: 'style:shadow',
        effects: [{ type: 'DROP_SHADOW', radius: 12 }]
      }
    })
  })

  it('preserves semantic labels for non-English component properties', async () => {
    stubFigma({
      components: [
        component('component:settings', '设置按钮', {
          componentPropertyDefinitions: {
            文本: { type: 'TEXT', defaultValue: '保存' }
          }
        }),
        component('component:checkout', '结账操作')
      ]
    })

    const result = await handleGetDesignSystem({})

    const settings = result.components.find(({ name }) => name === '设置按钮')
    expect(settings?.props).toEqual({
      property1: { type: 'text', label: '文本', default: '保存' }
    })
    expect(result.warnings).toBeUndefined()
  })

  it('returns a deterministic catalog of definitions', async () => {
    stubFigma({
      components: [component('component:button', 'Action Button')],
      localCollections: [collection('collection:spacing', 'Spacing')],
      localVariables: [
        variable('variable:spacing', 'Spacing / Medium', 'collection:spacing', {
          resolvedType: 'FLOAT'
        })
      ],
      localStyles: [style('style:heading', 'Typography / Heading', 'TEXT')]
    })

    const result = await handleGetDesignSystem({})

    expect(result.components.map(({ name }) => name)).toEqual(['Action Button'])
    expect(result.variables.map(({ name }) => name)).toEqual(['Spacing / Medium'])
    expect(result.collections.map(({ name }) => name)).toEqual(['Spacing'])
    expect(result.styles.map(({ name }) => name)).toEqual(['Typography / Heading'])
    expect(result.warnings).toBeUndefined()
  })

  it('discovers definitions on accessible pages without loading the document', async () => {
    stubFigma({
      pages: [
        {
          id: 'page:current',
          name: 'Screens',
          components: [component('component:button', 'Button')]
        },
        {
          id: 'page:components',
          name: 'Components',
          components: [component('component:field', 'Text field')]
        },
        { id: 'page:archive', name: 'Archive', loaded: false }
      ]
    })

    const result = await handleGetDesignSystem({})

    expect(result.components.map(({ name }) => name)).toEqual(['Button', 'Text field'])
    expect(result.components.map(({ page }) => page)).toEqual(['Screens', 'Components'])
    expect(result.warnings).toEqual([
      'Component definitions were read from 2 accessible pages; 1 page was skipped rather than loaded.'
    ])
    expect(figma.root.children[0]!.findAllWithCriteria).toHaveBeenCalledWith({
      types: ['COMPONENT']
    })
    expect(figma.root.children[1]!.findAllWithCriteria).toHaveBeenCalledWith({
      types: ['COMPONENT']
    })
    expect(figma.loadAllPagesAsync).not.toHaveBeenCalled()
  })

  it('reports truncated component props and options', async () => {
    stubFigma({
      components: [
        component('component:dense', 'Dense', {
          componentPropertyDefinitions: Object.fromEntries([
            [
              'State',
              {
                type: 'VARIANT',
                defaultValue: 'Option 1',
                variantOptions: Array.from({ length: 140 }, (_, index) => `Option ${index + 1}`)
              }
            ],
            ...Array.from({ length: 32 }, (_, index) => [
              `Label ${index + 1}`,
              { type: 'TEXT', defaultValue: `Label ${index + 1}` }
            ])
          ])
        })
      ]
    })

    const result = await handleGetDesignSystem({})

    expect(result.components[0]).toMatchObject({
      omittedProps: 1,
      props: {
        state: {
          options: Array.from({ length: 32 }, (_, index) => `Option ${index + 1}`),
          omittedOptions: 108
        }
      }
    })
  })

  it('shares concurrent catalog discovery', async () => {
    stubFigma({ components: [component('component:button', 'Button')] })

    const [first, second] = await Promise.all([
      handleGetDesignSystem({}),
      handleGetDesignSystem({})
    ])

    expect(first.catalogId).toBe(second.catalogId)
    expect(figma.currentPage.findAllWithCriteria).toHaveBeenCalledOnce()
  })

  it('paginates a balanced catalog within the byte budget', async () => {
    const components = Array.from({ length: 200 }, (_, index) =>
      component(`component:${index}`, `Card ${index}`, {
        description: 'x'.repeat(300),
        componentPropertyDefinitions: Object.fromEntries(
          Array.from({ length: 10 }, (_value, propertyIndex) => [
            `Property ${propertyIndex}`,
            { type: 'TEXT', defaultValue: 'x'.repeat(60) }
          ])
        )
      })
    )
    stubFigma({
      pages: [
        { id: 'page:current', name: 'Current', components },
        { id: 'page:archive', name: 'Archive', loaded: false }
      ],
      localCollections: [collection('collection:spacing', 'Spacing')],
      localVariables: [
        variable('variable:spacing', 'Spacing / Medium', 'collection:spacing', {
          resolvedType: 'FLOAT'
        })
      ],
      localStyles: [style('style:heading', 'Typography / Heading', 'TEXT')]
    })

    const result = await handleGetDesignSystem({})

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16 * 1024)
    expect(result.components.length).toBeGreaterThan(0)
    expect(result.variables).toHaveLength(1)
    expect(result.styles).toHaveLength(1)
    expect(result.omitted?.collections).toBe(1)
    expect(result.omitted?.components).toBeGreaterThan(0)
    expect(result.nextCursor).toBeGreaterThan(0)
    const warnings = [
      'Component definitions were read from 1 accessible page; 1 page was skipped rather than loaded.'
    ]
    expect(result.warnings).toEqual(warnings)

    const refs = new Set(result.components.map(({ ref }) => ref))
    const collections = new Set(result.collections.map(({ ref }) => ref))
    let cursor = result.nextCursor
    while (cursor !== undefined) {
      const page = await handleGetDesignSystem({ catalogId: result.catalogId, cursor })
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(16 * 1024)
      expect(page.warnings).toEqual(warnings)
      page.components.forEach(({ ref }) => refs.add(ref))
      page.collections.forEach(({ ref }) => collections.add(ref))
      cursor = page.nextCursor
    }
    expect(refs.size).toBe(200)
    expect(collections).toEqual(new Set(['k1']))
  })

  it('returns an empty catalog when no definitions are available', async () => {
    stubFigma()

    const result = await handleGetDesignSystem({})

    expect(result.components).toEqual([])
    expect(result.variables).toEqual([])
    expect(result.collections).toEqual([])
    expect(result.styles).toEqual([])
  })

  it('tolerates missing optional descriptions from the Figma runtime', async () => {
    const accent = variable('variable:accent', 'Accent', 'collection:colors')
    const heading = style('style:heading', 'Heading', 'TEXT')
    Reflect.deleteProperty(accent, 'description')
    Reflect.deleteProperty(heading, 'description')
    Reflect.deleteProperty(heading, 'descriptionMarkdown')
    stubFigma({
      localCollections: [collection('collection:colors', 'Colors', { variableIds: [accent.id] })],
      localStyles: [heading],
      localVariables: [accent]
    })

    const result = await handleGetDesignSystem({})

    expect(result.variables[0]).toMatchObject({ name: 'Accent' })
    expect(result.variables[0]).not.toHaveProperty('description')
    expect(result.styles[0]).toMatchObject({ name: 'Heading' })
    expect(result.styles[0]).not.toHaveProperty('description')
    expect(result.styles[0]).not.toHaveProperty('descriptionMarkdown')
  })

  it('rejects unknown or expired exact refs', async () => {
    stubFigma()

    await expect(handleGetDesignSystem({ catalogId: 'ds_missing', ref: 'c1' })).rejects.toThrow(
      'Unknown or expired design-system catalog'
    )

    const result = await handleGetDesignSystem({})
    await expect(handleGetDesignSystem({ catalogId: result.catalogId, ref: 'c1' })).rejects.toThrow(
      'Unknown design-system ref'
    )
  })

  it('expires catalogs when the active Figma file changes', async () => {
    stubFigma({
      fileKey: 'file-a',
      components: [component('component:1', 'Button')]
    })
    const result = await handleGetDesignSystem({})
    Object.assign(figma, { fileKey: 'file-b' })

    await expect(handleGetDesignSystem({ catalogId: result.catalogId, ref: 'c1' })).rejects.toThrow(
      'Unknown or expired'
    )
  })

  it('bounds verbose component details instead of failing the inline result', async () => {
    stubFigma({
      components: [
        component('component:large', 'Large', {
          description: 'x'.repeat(70 * 1024)
        })
      ]
    })
    const result = await handleGetDesignSystem({})
    const detail = await handleGetDesignSystem({ catalogId: result.catalogId, ref: 'c1' })

    expect(JSON.stringify(detail).length).toBeLessThan(64 * 1024)
    expect((detail.details?.definition as { description: string }).description).toHaveLength(2000)
    expect((detail.details?.definition as { description: string }).description).toMatch(/…$/)
  })

  it('evicts inactive catalogs by least-recently-used order', () => {
    const catalogs = Array.from({ length: 8 }, () => registerDesignSystemCatalog([]))
    requireDesignSystemCatalog(catalogs[0]!.id)
    registerDesignSystemCatalog([])

    expect(requireDesignSystemCatalog(catalogs[0]!.id)).toBe(catalogs[0])
    expect(() => requireDesignSystemCatalog(catalogs[1]!.id)).toThrow('Unknown or expired')
  })
})
