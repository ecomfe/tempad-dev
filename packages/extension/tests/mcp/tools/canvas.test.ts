import type { CanvasFigmaProperties, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resetAssetCache,
  setAssetDownloader,
  setAssetServerUrl,
  setAssetUploader
} from '@/mcp/assets'
import {
  applyResolvedCanvas as applyCanvas,
  handleApplyCanvas as applyCanvasFromTool
} from '@/mcp/tools/canvas'

const MIXED = Symbol('mixed')
const SHARED_PLUGIN_DATA_NAMESPACE_PATTERN = /^[A-Za-z0-9_.]+$/

function assertSharedPluginDataNamespace(namespace: string): void {
  if (!SHARED_PLUGIN_DATA_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error('The namespace can only consist of alphanumeric characters, _ or .')
  }
}

function withSharedPluginData<T extends object>(value: T): T & PluginDataMixin {
  const shared = new Map<string, string>()
  return Object.assign(value, {
    getPluginData: vi.fn(() => ''),
    getPluginDataKeys: vi.fn(() => []),
    getSharedPluginData(namespace: string, key: string) {
      assertSharedPluginDataNamespace(namespace)
      return shared.get(`${namespace}:${key}`) ?? ''
    },
    getSharedPluginDataKeys: vi.fn(() => []),
    setPluginData: vi.fn(),
    setSharedPluginData(namespace: string, key: string, data: string) {
      assertSharedPluginDataNamespace(namespace)
      if (data) shared.set(`${namespace}:${key}`, data)
      else shared.delete(`${namespace}:${key}`)
    }
  }) as T & PluginDataMixin
}

function defaultPageBackground(): Paint[] {
  return [
    {
      type: 'SOLID',
      color: { r: 0.9, g: 0.9, b: 0.9 },
      opacity: 1
    }
  ]
}

function createMockPage(id: string, name: string) {
  const page = {
    id,
    name,
    type: 'PAGE' as const,
    removed: false,
    parent: null as BaseNode | null,
    children: [] as SceneNode[],
    guides: [] as Guide[],
    backgrounds: defaultPageBackground(),
    explicitVariableModes: {} as Record<string, string>,
    isPageDivider: false,
    loadAsync: vi.fn().mockResolvedValue(undefined),
    clearExplicitVariableModeForCollection(collection: VariableCollection) {
      delete page.explicitVariableModes[collection.id]
    },
    setExplicitVariableModeForCollection(collection: VariableCollection, modeId: string) {
      page.explicitVariableModes[collection.id] = modeId
    },
    insertChild(index: number, child: SceneNode) {
      const mutable = child as SceneNode & { parent: BaseNode | null }
      const oldParent = mutable.parent as (BaseNode & { children?: SceneNode[] }) | null
      if (oldParent?.children) {
        const oldIndex = oldParent.children.indexOf(child)
        if (oldIndex >= 0) oldParent.children.splice(oldIndex, 1)
      }
      mutable.parent = page as unknown as PageNode
      page.children.splice(index, 0, child)
    },
    appendChild(child: SceneNode) {
      page.insertChild(page.children.length, child)
    }
  }
  return withSharedPluginData(page)
}

function containingPage(node: BaseNode): PageNode {
  let current: BaseNode | null = node
  while (current) {
    if (current.type === 'PAGE') return current
    current = current.parent
  }
  throw new Error(`Mock node ${node.id} is not attached to a page`)
}

const PAGE = createMockPage('0:1', 'Page 1')

type Mutable<T> = T extends unknown ? { -readonly [Key in keyof T]: T[Key] } : never
type MockNodeType =
  | 'BOOLEAN_OPERATION'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'ELLIPSE'
  | 'FRAME'
  | 'GROUP'
  | 'INSTANCE'
  | 'LINE'
  | 'POLYGON'
  | 'RECTANGLE'
  | 'SECTION'
  | 'SLOT'
  | 'STAR'
  | 'TEXT'
  | 'VECTOR'

function isMockFrameType(
  type: MockNodeType
): type is 'COMPONENT' | 'COMPONENT_SET' | 'FRAME' | 'SLOT' {
  return type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'FRAME' || type === 'SLOT'
}

type MutableNode = Mutable<SupportedMockNode> & {
  appendChild: (child: SceneNode) => void
  booleanOperation: BooleanOperationNode['booleanOperation']
  boundVariables: Record<string, unknown>
  children: SceneNode[]
  componentPropertyReferences: {
    visible?: string
    characters?: string
    mainComponent?: string
  } | null
  componentProperties: Record<
    string,
    {
      type: ComponentPropertyType
      value: string | boolean
      boundVariables?: { value?: VariableAlias }
    }
  >
  effectStyleId: string
  effects: readonly Effect[]
  fillStyleId: string
  fills: readonly Paint[]
  gridColumnAnchorIndex: number
  gridColumnSpan: number
  gridRowAnchorIndex: number
  gridRowSpan: number
  isMask: boolean
  insertChild: (index: number, child: SceneNode) => void
  layoutGrow: number
  layoutPositioning: 'ABSOLUTE' | 'AUTO'
  mainComponent?: ComponentNode
  parent: BaseNode | null
  setGridChildPosition: (row: number, column: number) => void
  strokeStyleId: string
  strokes: readonly Paint[]
}

type SupportedMockNode = Extract<SceneNode, { type: MockNodeType }>

type FigmaFixture = {
  commitUndo: ReturnType<typeof vi.fn>
  createImage: ReturnType<typeof vi.fn>
  createImageAsync: ReturnType<typeof vi.fn>
  createNodeFromSvg: ReturnType<typeof vi.fn>
  createVideoAsync: ReturnType<typeof vi.fn>
  createNode: (type: MockNodeType) => MutableNode
  getNode: (id: string) => MutableNode
  importComponentByKeyAsync: ReturnType<typeof vi.fn>
  importShaderById: ReturnType<typeof vi.fn>
  importStyleByKeyAsync: ReturnType<typeof vi.fn>
  loadFontAsync: ReturnType<typeof vi.fn>
  nodes: Map<string, BaseNode>
  pages: Array<ReturnType<typeof createMockPage>>
  styles: Map<string, BaseStyle>
  triggerUndo: ReturnType<typeof vi.fn>
  variableCollections: Map<string, VariableCollection>
  variables: Map<string, Variable>
}

function transformNextFrame(fixture: FigmaFixture, transform: (node: MutableNode) => void): void {
  vi.mocked(figma.createFrame).mockImplementationOnce(() => {
    const node = fixture.createNode('FRAME')
    transform(node)
    return node as unknown as FrameNode
  })
}

function transformNextFrameEffects(
  fixture: FigmaFixture,
  transform: (effects: readonly Effect[]) => readonly Effect[]
): void {
  transformNextFrame(fixture, (node) => {
    const descriptor = Object.getOwnPropertyDescriptor(node, 'effects')!
    Object.defineProperty(node, 'effects', {
      configurable: true,
      get: descriptor.get,
      set(value: readonly Effect[]) {
        descriptor.set!.call(node, transform(value))
      }
    })
  })
}

function solidPaint(color = { r: 1, g: 1, b: 1 }, opacity = 1): SolidPaint {
  return {
    type: 'SOLID',
    color,
    opacity,
    visible: true,
    blendMode: 'NORMAL'
  }
}

function normalizePaint(paint: Paint): Paint {
  return paint.type === 'SOLID'
    ? {
        ...paint,
        opacity: paint.opacity ?? 1,
        visible: paint.visible ?? true,
        blendMode: paint.blendMode ?? 'NORMAL'
      }
    : paint
}

function mockVariableCollection(
  id: string,
  name: string,
  modes = [{ modeId: `${id}:mode:1`, name: 'Mode 1' }]
): VariableCollection {
  let nextMode = modes.length + 1
  const collection = withSharedPluginData({
    id,
    key: `${id}:key`,
    name,
    hiddenFromPublishing: false,
    remote: false,
    isExtension: false,
    modes: [...modes],
    variableIds: [] as string[],
    defaultModeId: modes[0]!.modeId,
    addMode(modeName: string) {
      const modeId = `${id}:mode:${nextMode++}`
      collection.modes.push({ modeId, name: modeName })
      return modeId
    },
    renameMode(modeId: string, modeName: string) {
      const mode = collection.modes.find((candidate) => candidate.modeId === modeId)
      if (!mode) throw new Error(`Missing mode ${modeId}`)
      mode.name = modeName
    },
    remove: vi.fn(),
    removeMode: vi.fn()
  })
  return collection as unknown as VariableCollection
}

function mockVariable(
  id: string,
  name: string,
  collection: VariableCollection,
  resolvedType: VariableResolvedDataType
): Variable {
  const codeSyntax: Partial<Record<CodeSyntaxPlatform, string>> = {}
  const valuesByMode: Record<string, VariableValue> = {}
  const variable = withSharedPluginData({
    id,
    key: `${id}:key`,
    name,
    description: '',
    hiddenFromPublishing: false,
    remote: false,
    variableCollectionId: collection.id,
    resolvedType,
    scopes: [] as VariableScope[],
    codeSyntax,
    valuesByMode,
    setValueForMode(modeId: string, value: VariableValue) {
      valuesByMode[modeId] = value
    },
    setVariableCodeSyntax(platform: CodeSyntaxPlatform, value: string) {
      codeSyntax[platform] = value
    },
    removeVariableCodeSyntax(platform: CodeSyntaxPlatform) {
      delete codeSyntax[platform]
    },
    resolveForConsumer: vi.fn(),
    remove: vi.fn()
  })
  return variable as unknown as Variable
}

function createFixture(): FigmaFixture {
  let nextId = 1
  let nextComponentPropertyId = 1
  let nextPageId = 2
  let nextStyleId = 1
  const nodes = new Map<string, BaseNode>()
  const styles = new Map<string, BaseStyle>()
  const pages = [PAGE]
  const root = {
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT' as const,
    parent: null,
    children: pages,
    insertChild(index: number, page: ReturnType<typeof createMockPage>) {
      const current = pages.indexOf(page)
      if (current >= 0) pages.splice(current, 1)
      pages.splice(index, 0, page)
      page.parent = root as unknown as DocumentNode
    }
  }
  PAGE.parent = root as unknown as DocumentNode
  PAGE.children.length = 0
  PAGE.name = 'Page 1'
  PAGE.guides = []
  PAGE.backgrounds = defaultPageBackground()
  PAGE.explicitVariableModes = {}
  PAGE.setSharedPluginData('tempad_dev', 'page-key', '')
  PAGE.loadAsync.mockReset().mockResolvedValue(undefined)

  function styleConsumers(styleId: string): StyleConsumers[] {
    const fields = [
      'backgroundStyleId',
      'fillStyleId',
      'strokeStyleId',
      'textStyleId',
      'effectStyleId',
      'gridStyleId'
    ] as const
    return [...nodes.values()].flatMap((node) => {
      if (!('x' in node)) return []
      const record = node as unknown as Record<string, unknown>
      const used = fields.filter((field) => record[field] === styleId)
      return used.length ? [{ node: node as SceneNode, fields: used }] : []
    })
  }

  function createStyle(type: StyleType): BaseStyle {
    const id = `style:authored:${nextStyleId++}`
    const base = withSharedPluginData({
      id,
      key: `${id}:key`,
      name: '',
      type,
      description: '',
      descriptionMarkdown: '',
      documentationLinks: [] as DocumentationLink[],
      remote: false,
      getStyleConsumersAsync: vi.fn(() => Promise.resolve(styleConsumers(id))),
      remove: vi.fn(() => styles.delete(id))
    })
    let style: BaseStyle
    switch (type) {
      case 'PAINT':
        style = Object.assign(base, { paints: [] as Paint[] }) as unknown as PaintStyle
        break
      case 'TEXT': {
        const boundVariables: Partial<Record<VariableBindableTextField, VariableAlias>> = {}
        style = Object.assign(base, {
          fontSize: 12,
          textDecoration: 'NONE' as TextDecoration,
          fontName: { family: 'Inter', style: 'Regular' },
          letterSpacing: { unit: 'PIXELS', value: 0 } as LetterSpacing,
          lineHeight: { unit: 'AUTO' } as LineHeight,
          leadingTrim: 'NONE' as LeadingTrim,
          paragraphIndent: 0,
          paragraphSpacing: 0,
          listSpacing: 0,
          hangingPunctuation: false,
          hangingList: false,
          textCase: 'ORIGINAL' as TextCase,
          boundVariables,
          setBoundVariable(field: VariableBindableTextField, variable: Variable | null) {
            if (variable) {
              boundVariables[field] = { type: 'VARIABLE_ALIAS', id: variable.id }
            } else {
              delete boundVariables[field]
            }
          }
        }) as unknown as TextStyle
        break
      }
      case 'EFFECT':
        style = Object.assign(base, { effects: [] as Effect[] }) as unknown as EffectStyle
        break
      case 'GRID':
        style = Object.assign(base, { layoutGrids: [] as LayoutGrid[] }) as unknown as GridStyle
        break
    }
    styles.set(style.id, style)
    return style
  }

  function createNode(type: MockNodeType): MutableNode {
    const id = `node:${nextId++}`
    const pluginData = new Map<string, string>()
    const boundVariables: Record<string, unknown> = {}
    const explicitVariableModes: Record<string, string> = {}
    let fills: readonly Paint[] = [solidPaint()]
    let strokes: readonly Paint[] = []
    let effects: readonly Effect[] = []
    let x = 0
    let y = 0
    let rotation = 0
    let relativeTransform: Transform = [
      [1, 0, 0],
      [0, 1, 0]
    ]
    let targetAspectRatio: Vector | null = null
    const node = {
      id,
      type,
      removed: false,
      name: '',
      visible: true,
      locked: false,
      isMask: false,
      maskType: 'ALPHA' as MaskType,
      blendMode: 'NORMAL' as BlendMode,
      width: 100,
      height: type === 'LINE' ? 0 : 100,
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
      parent: PAGE,
      opacity: 1,
      clipsContent: false,
      fillStyleId: '',
      strokeStyleId: '',
      effectStyleId: '',
      strokeWeight: 1,
      strokeAlign: 'CENTER',
      strokeCap: 'NONE',
      strokeJoin: 'MITER',
      strokeMiterLimit: 4,
      dashPattern: [],
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      layoutGrow: 0,
      layoutPositioning: 'AUTO',
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 0,
      gridRowSpan: 1,
      gridColumnSpan: 1,
      gridChildHorizontalAlign: 'AUTO',
      gridChildVerticalAlign: 'AUTO',
      boundVariables,
      componentPropertyReferences: null,
      explicitVariableModes,
      exportAsync: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
      getSharedPluginData(namespace: string, key: string) {
        assertSharedPluginDataNamespace(namespace)
        return pluginData.get(`${namespace}:${key}`) ?? ''
      },
      setSharedPluginData(namespace: string, key: string, value: string) {
        assertSharedPluginDataNamespace(namespace)
        pluginData.set(`${namespace}:${key}`, value)
      },
      remove: vi.fn(() => {
        if (node.removed) return
        const parent = node.parent as (BaseNode & { children?: SceneNode[] }) | null
        if (parent?.children) {
          const index = parent.children.indexOf(node)
          if (index >= 0) parent.children.splice(index, 1)
        }
        const stack: BaseNode[] = [node]
        while (stack.length) {
          const current = stack.pop()!
          if ('children' in current) stack.push(...current.children)
          nodes.delete(current.id)
          const mutable = current as unknown as {
            parent: BaseNode | null
            removed: boolean
          }
          mutable.removed = true
          mutable.parent = null
        }
      }),
      resize(width: number, height: number) {
        node.width = width
        node.height = height
      },
      rescale(scale: number) {
        node.width *= scale
        node.height *= scale
        node.x *= scale
        node.y *= scale
        for (const child of node.children ?? []) {
          ;(child as unknown as { rescale: (value: number) => void }).rescale(scale)
        }
      },
      setGridChildPosition: vi.fn((row: number, column: number) => {
        node.gridRowAnchorIndex = row
        node.gridColumnAnchorIndex = column
      }),
      lockAspectRatio: vi.fn(() => {
        targetAspectRatio = { x: node.width, y: node.height }
      }),
      unlockAspectRatio: vi.fn(() => {
        targetAspectRatio = null
      }),
      setFillStyleIdAsync: vi.fn(async (styleId: string) => {
        if (!styleId) {
          node.fillStyleId = ''
          return
        }
        const style = styles.get(styleId)
        if (style?.type !== 'PAINT') throw new Error('invalid fill style')
        node.fillStyleId = styleId
        fills = style.paints.map(normalizePaint)
      }),
      setStrokeStyleIdAsync: vi.fn(async (styleId: string) => {
        if (!styleId) {
          node.strokeStyleId = ''
          return
        }
        const style = styles.get(styleId)
        if (style?.type !== 'PAINT') throw new Error('invalid stroke style')
        node.strokeStyleId = styleId
        strokes = style.paints.map(normalizePaint)
      }),
      setEffectStyleIdAsync: vi.fn(async (styleId: string) => {
        if (!styleId) {
          node.effectStyleId = ''
          return
        }
        const style = styles.get(styleId)
        if (style?.type !== 'EFFECT') throw new Error('invalid effect style')
        node.effectStyleId = styleId
        effects = style.effects
      }),
      clearExplicitVariableModeForCollection: vi.fn((collection: VariableCollection) => {
        delete explicitVariableModes[collection.id]
      }),
      setExplicitVariableModeForCollection: vi.fn(
        (collection: VariableCollection, modeId: string) => {
          explicitVariableModes[collection.id] = modeId
        }
      ),
      setBoundVariable: vi.fn((field: string, variable: Variable | null) => {
        if (variable === null) {
          if (
            field === 'cornerRadius' &&
            (isMockFrameType(type) ||
              type === 'INSTANCE' ||
              type === 'SECTION' ||
              type === 'RECTANGLE')
          ) {
            delete boundVariables.topLeftRadius
            delete boundVariables.topRightRadius
            delete boundVariables.bottomLeftRadius
            delete boundVariables.bottomRightRadius
          } else {
            delete boundVariables[field]
          }
          return
        }
        const alias = { type: 'VARIABLE_ALIAS', id: variable.id }
        if (
          field === 'cornerRadius' &&
          (isMockFrameType(type) ||
            type === 'INSTANCE' ||
            type === 'SECTION' ||
            type === 'RECTANGLE')
        ) {
          boundVariables.topLeftRadius = alias
          boundVariables.topRightRadius = alias
          boundVariables.bottomLeftRadius = alias
          boundVariables.bottomRightRadius = alias
        } else {
          boundVariables[field] = alias
        }
      })
    } as unknown as MutableNode

    function normalizePaints(
      value: readonly Paint[],
      field: 'fills' | 'strokes'
    ): readonly Paint[] {
      const paints = value.map(normalizePaint)
      const aliases = paints
        .map((paint) => ('boundVariables' in paint ? paint.boundVariables?.color : undefined))
        .filter((alias): alias is VariableAlias => !!alias)
      if (aliases.length) boundVariables[field] = aliases
      else delete boundVariables[field]
      return paints
    }

    Object.defineProperties(node, {
      x: {
        get: () => x,
        set: (value: number) => {
          x = value
          relativeTransform[0][2] = value
        }
      },
      y: {
        get: () => y,
        set: (value: number) => {
          y = value
          relativeTransform[1][2] = value
        }
      },
      rotation: {
        get: () => rotation,
        set: (value: number) => {
          rotation = ((((value + 180) % 360) + 360) % 360) - 180
          const radians = (rotation * Math.PI) / 180
          relativeTransform = [
            [Math.cos(radians), Math.sin(radians), x],
            [-Math.sin(radians), Math.cos(radians), y]
          ]
        }
      },
      relativeTransform: {
        get: () => relativeTransform,
        set: (value: Transform) => {
          relativeTransform = value.map((row) => [...row]) as Transform
          x = value[0][2]
          y = value[1][2]
          rotation = (Math.atan2(-value[1][0], value[0][0]) * 180) / Math.PI
        }
      },
      targetAspectRatio: {
        get: () => targetAspectRatio
      },
      fills: {
        configurable: true,
        get: () => fills,
        set: (value: readonly Paint[]) => {
          fills = normalizePaints(value, 'fills')
          node.fillStyleId = ''
        }
      },
      strokes: {
        configurable: true,
        get: () => strokes,
        set: (value: readonly Paint[]) => {
          strokes = normalizePaints(value, 'strokes')
          node.strokeStyleId = ''
        }
      },
      effects: {
        configurable: true,
        get: () => effects,
        set: (value: readonly Effect[]) => {
          effects = value
          node.effectStyleId = ''
        }
      }
    })

    if (isMockFrameType(type) || type === 'INSTANCE') {
      let layoutGrids: readonly LayoutGrid[] = []
      let guides: readonly Guide[] = []
      const frame = node as unknown as {
        gridStyleId: string
        layoutGrids: readonly LayoutGrid[]
      }
      Object.assign(node, {
        gridStyleId: '',
        setGridStyleIdAsync: vi.fn(async (styleId: string) => {
          if (!styleId) {
            frame.gridStyleId = ''
            return
          }
          const style = styles.get(styleId)
          if (style?.type !== 'GRID') throw new Error('invalid grid style')
          frame.gridStyleId = styleId
          layoutGrids = style.layoutGrids
        })
      })
      Object.defineProperties(node, {
        layoutGrids: {
          configurable: true,
          get: () => layoutGrids,
          set: (value: readonly LayoutGrid[]) => {
            layoutGrids = value
            frame.gridStyleId = ''
          }
        },
        guides: {
          configurable: true,
          get: () => guides,
          set: (value: readonly Guide[]) => {
            guides = value
          }
        }
      })
    }

    if (isMockFrameType(type) || type === 'INSTANCE' || type === 'RECTANGLE') {
      Object.assign(node, {
        strokeTopWeight: 1,
        strokeRightWeight: 1,
        strokeBottomWeight: 1,
        strokeLeftWeight: 1,
        topLeftRadius: 0,
        topRightRadius: 0,
        bottomRightRadius: 0,
        bottomLeftRadius: 0
      })
    }
    if (
      type === 'BOOLEAN_OPERATION' ||
      isMockFrameType(type) ||
      type === 'INSTANCE' ||
      type === 'SECTION' ||
      type === 'RECTANGLE' ||
      type === 'ELLIPSE' ||
      type === 'POLYGON' ||
      type === 'STAR' ||
      type === 'VECTOR'
    ) {
      Object.assign(node, {
        cornerRadius: 0,
        cornerSmoothing: 0
      })
    }

    if (
      type === 'BOOLEAN_OPERATION' ||
      isMockFrameType(type) ||
      type === 'GROUP' ||
      type === 'INSTANCE' ||
      type === 'SECTION'
    ) {
      Object.assign(node, {
        children: [] as SceneNode[],
        insertChild(index: number, child: MutableNode) {
          const oldParent = child.parent as (BaseNode & { children?: SceneNode[] }) | null
          let targetIndex = index
          if (oldParent?.children) {
            const oldIndex = oldParent.children.indexOf(child)
            if (oldIndex >= 0) {
              oldParent.children.splice(oldIndex, 1)
              if (oldParent === node && oldIndex < targetIndex) targetIndex -= 1
            }
          }
          child.parent = node as unknown as
            | BooleanOperationNode
            | ComponentNode
            | ComponentSetNode
            | FrameNode
            | GroupNode
            | InstanceNode
            | SectionNode
            | SlotNode
          node.children.splice(targetIndex, 0, child)
        },
        appendChild(child: MutableNode) {
          node.insertChild(node.children.length, child)
        }
      })
    }

    if (type === 'SECTION') {
      Object.assign(node, {
        sectionContentsHidden: false,
        topLeftRadius: 0,
        topRightRadius: 0,
        bottomRightRadius: 0,
        bottomLeftRadius: 0
      })
    }
    if (type === 'BOOLEAN_OPERATION') {
      Object.assign(node, { booleanOperation: 'UNION' })
    }
    if (type === 'COMPONENT' || type === 'COMPONENT_SET') {
      const definitions: ComponentPropertyDefinitions = {}
      const definition = (
        propertyType: ComponentPropertyType,
        defaultValue: string | boolean | VariableAlias,
        options: ComponentPropertyOptions = {}
      ): ComponentPropertyDefinitions[string] => ({
        type: propertyType,
        defaultValue:
          typeof defaultValue === 'object'
            ? propertyType === 'BOOLEAN'
              ? false
              : ''
            : defaultValue,
        ...options,
        ...(typeof defaultValue === 'object' ? { boundVariables: { defaultValue } } : {})
      })
      Object.assign(node, {
        remote: false,
        key: `${type.toLowerCase()}:${id}`,
        description: '',
        descriptionMarkdown: '',
        documentationLinks: [] as DocumentationLink[],
        componentPropertyDefinitions: definitions,
        getInstancesAsync: vi.fn(async () =>
          [...nodes.values()].filter(
            (candidate): candidate is InstanceNode =>
              candidate.type === 'INSTANCE' && candidate.mainComponent?.id === node.id
          )
        ),
        addComponentProperty: vi.fn(
          (
            propertyName: string,
            propertyType: ComponentPropertyType,
            defaultValue: string | boolean | VariableAlias,
            options?: ComponentPropertyOptions
          ) => {
            const name = `${propertyName}#${nextComponentPropertyId++}`
            definitions[name] = definition(propertyType, defaultValue, options)
            return name
          }
        ),
        editComponentProperty: vi.fn(
          (
            propertyName: string,
            edit: {
              name?: string
              defaultValue?: string | boolean | VariableAlias
              preferredValues?: InstanceSwapPreferredValue[]
              description?: string
              slotSettings?: SlotSettings
            }
          ) => {
            const current = definitions[propertyName]
            if (!current) throw new Error(`Missing component property ${propertyName}`)
            const name =
              edit.name === undefined ? propertyName : `${edit.name}#${nextComponentPropertyId++}`
            const { boundVariables: _boundVariables, ...unbound } = current
            const next = {
              ...(edit.defaultValue === undefined ? current : unbound),
              ...(edit.defaultValue === undefined
                ? {}
                : definition(current.type, edit.defaultValue)),
              ...('preferredValues' in edit ? { preferredValues: edit.preferredValues } : {}),
              ...('description' in edit ? { description: edit.description } : {}),
              ...('slotSettings' in edit ? { slotSettings: edit.slotSettings } : {})
            }
            if (name !== propertyName) {
              delete definitions[propertyName]
              for (const candidate of nodes.values()) {
                if (!('componentPropertyReferences' in candidate)) continue
                const references = candidate.componentPropertyReferences
                if (!references) continue
                for (const field of ['characters', 'mainComponent', 'visible'] as const) {
                  if (references[field] === propertyName) references[field] = name
                }
              }
            }
            definitions[name] = next
            return name
          }
        ),
        deleteComponentProperty: vi.fn((propertyName: string) => {
          delete definitions[propertyName]
        })
      })
      if (type === 'COMPONENT') {
        Object.assign(node, {
          createInstance: vi.fn(() => createInstance(node as unknown as ComponentNode)),
          createSlot: vi.fn(() => {
            const owner =
              node.parent?.type === 'COMPONENT_SET'
                ? node.parent
                : (node as unknown as ComponentNode)
            owner.addComponentProperty('Slot', 'SLOT', '')
            const slot = createNode('SLOT')
            node.insertChild(node.children.length, slot)
            return slot
          })
        })
      }
    }
    if (type === 'SLOT') {
      Object.assign(node, {
        limitViolations: [] as Array<'BELOW_MIN' | 'ABOVE_MAX' | 'HAS_NON_PREFERRED'>,
        resetSlot: vi.fn()
      })
    }
    if (type === 'COMPONENT_SET') {
      Object.defineProperty(node, 'defaultVariant', {
        get: () => node.children[0]
      })
    }

    if (type === 'VECTOR') {
      let vectorPaths: VectorPaths = []
      let vectorNetwork: VectorNetwork = { vertices: [], segments: [] }
      let handleMirroring: HandleMirroring = 'NONE'
      Object.assign(node, {
        setVectorNetworkAsync: vi.fn(async (network: VectorNetwork) => {
          vectorNetwork = {
            ...network,
            segments: network.segments.map((segment) => ({
              ...segment,
              tangentStart: segment.tangentStart ?? { x: 0, y: 0 },
              tangentEnd: segment.tangentEnd ?? { x: 0, y: 0 }
            })),
            regions: (network.regions ?? []).map((region) => ({
              ...region,
              ...(region.fillStyleId
                ? { fills: (styles.get(region.fillStyleId) as PaintStyle).paints }
                : {})
            }))
          }
          vectorPaths = []
          node.width = 12
          node.height = 12
        })
      })
      Object.defineProperties(node, {
        vectorPaths: {
          get: () => vectorPaths,
          set: (paths: VectorPaths) => {
            vectorPaths = paths
            node.width = 6
            node.height = 6
          }
        },
        vectorNetwork: {
          get: () => vectorNetwork
        },
        handleMirroring: {
          get: () => handleMirroring,
          set: (value: HandleMirroring) => {
            handleMirroring = value
          }
        }
      })
    }

    if (isMockFrameType(type)) {
      let itemSpacing = 0
      let counterAxisSpacing = 0
      let counterAxisSpacingSynced = false
      let gridRowCount = 1
      let gridColumnCount = 1
      let gridRowSizes: GridTrackSize[] = [{ type: 'FLEX', value: 1 }]
      let gridColumnSizes: GridTrackSize[] = [{ type: 'FLEX', value: 1 }]
      const resizeTracks = (tracks: GridTrackSize[], count: number): GridTrackSize[] =>
        Array.from({ length: count }, (_, index) => tracks[index] ?? { type: 'FLEX', value: 1 })
      Object.assign(node, {
        layoutMode: 'NONE',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        itemReverseZIndex: false,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        counterAxisAlignContent: 'AUTO',
        layoutWrap: 'NO_WRAP',
        strokesIncludedInLayout: false,
        gridRowGap: 0,
        gridColumnGap: 0,
        gridAutoTracks: 'NONE',
        gridItemsPositioning: 'MANUAL',
        clipsContent: false,
        paddingTop: 10,
        paddingRight: 11,
        paddingBottom: 12,
        paddingLeft: 13
      })
      Object.defineProperties(node, {
        itemSpacing: {
          get: () => itemSpacing,
          set: (value: number) => {
            itemSpacing = value
            if (counterAxisSpacingSynced) counterAxisSpacing = value
          }
        },
        counterAxisSpacing: {
          get: () => counterAxisSpacing,
          set: (value: number | null) => {
            counterAxisSpacingSynced = value === null
            counterAxisSpacing = value ?? itemSpacing
          }
        },
        gridRowCount: {
          get: () => gridRowCount,
          set: (value: number) => {
            gridRowCount = value
            gridRowSizes = resizeTracks(gridRowSizes, value)
          }
        },
        gridColumnCount: {
          get: () => gridColumnCount,
          set: (value: number) => {
            gridColumnCount = value
            gridColumnSizes = resizeTracks(gridColumnSizes, value)
          }
        },
        gridRowSizes: {
          get: () => gridRowSizes
        },
        gridColumnSizes: {
          get: () => gridColumnSizes
        }
      })
    }

    if (type === 'TEXT') {
      const text = node as unknown as TextNode
      let layerName = node.name
      let characters = ''
      let autoRename = true
      let textAutoResize: TextNode['textAutoResize'] = 'NONE'
      let textTruncation: TextNode['textTruncation'] = 'DISABLED'
      let maxLines: TextNode['maxLines'] = null
      let layoutSizingHorizontal = text.layoutSizingHorizontal
      const rangeValues = new Map<string, unknown>()
      const rangeKey = (start: number, end: number, field: string) => `${start}:${end}:${field}`
      const rangeValue = <T>(start: number, end: number, field: string, fallback: T): T => {
        const key = rangeKey(start, end, field)
        return rangeValues.has(key) ? (rangeValues.get(key) as T) : fallback
      }
      const setRangeValue = (start: number, end: number, field: string, value: unknown) => {
        rangeValues.set(rangeKey(start, end, field), value)
      }
      const rangeGetter = <T>(field: string, fallback: () => T) =>
        vi.fn((start: number, end: number) => rangeValue(start, end, field, fallback()))
      const rangeSetter = <T>(field: string) =>
        vi.fn((start: number, end: number, value: T) => setRangeValue(start, end, field, value))
      Object.assign(node, {
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 12,
        fontWeight: 400,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        textDecorationStyle: null,
        textDecorationOffset: null,
        textDecorationThickness: null,
        textDecorationColor: null,
        textDecorationSkipInk: null,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        listSpacing: 0,
        hangingPunctuation: false,
        hangingList: false,
        leadingTrim: 'NONE',
        hyperlink: null,
        textStyleId: '',
        setTextStyleIdAsync: vi.fn(async (styleId: string) => {
          if (!styleId) {
            text.textStyleId = ''
            return
          }
          const style = styles.get(styleId)
          if (style?.type !== 'TEXT') throw new Error('invalid text style')
          text.textStyleId = styleId
          text.fontName = style.fontName
          text.fontSize = style.fontSize
          text.lineHeight = style.lineHeight
          text.letterSpacing = style.letterSpacing
          Object.assign(text, {
            textCase: style.textCase,
            textDecoration: style.textDecoration,
            paragraphIndent: style.paragraphIndent,
            paragraphSpacing: style.paragraphSpacing,
            listSpacing: style.listSpacing,
            hangingPunctuation: style.hangingPunctuation,
            hangingList: style.hangingList,
            leadingTrim: style.leadingTrim
          })
        }),
        getRangeAllFontNames: vi.fn(() => [{ family: 'Inter', style: 'Regular' } as FontName]),
        getRangeFontName: rangeGetter('fontName', () => text.fontName),
        setRangeFontName: rangeSetter<FontName>('fontName'),
        getRangeFontSize: rangeGetter('fontSize', () => text.fontSize),
        setRangeFontSize: rangeSetter<number>('fontSize'),
        getRangeTextCase: rangeGetter('textCase', () => text.textCase),
        setRangeTextCase: rangeSetter<TextCase>('textCase'),
        getRangeLetterSpacing: rangeGetter('letterSpacing', () => text.letterSpacing),
        setRangeLetterSpacing: rangeSetter<LetterSpacing>('letterSpacing'),
        getRangeLineHeight: rangeGetter('lineHeight', () => text.lineHeight),
        setRangeLineHeight: rangeSetter<LineHeight>('lineHeight'),
        getRangeTextDecoration: rangeGetter('textDecoration', () => text.textDecoration),
        setRangeTextDecoration: rangeSetter<TextDecoration>('textDecoration'),
        getRangeTextDecorationStyle: rangeGetter(
          'textDecorationStyle',
          () => text.textDecorationStyle
        ),
        setRangeTextDecorationStyle: rangeSetter<TextDecorationStyle>('textDecorationStyle'),
        getRangeTextDecorationOffset: rangeGetter(
          'textDecorationOffset',
          () => text.textDecorationOffset
        ),
        setRangeTextDecorationOffset: rangeSetter<TextDecorationOffset>('textDecorationOffset'),
        getRangeTextDecorationThickness: rangeGetter(
          'textDecorationThickness',
          () => text.textDecorationThickness
        ),
        setRangeTextDecorationThickness:
          rangeSetter<TextDecorationThickness>('textDecorationThickness'),
        getRangeTextDecorationColor: rangeGetter(
          'textDecorationColor',
          () => text.textDecorationColor
        ),
        setRangeTextDecorationColor: rangeSetter<TextDecorationColor>('textDecorationColor'),
        getRangeTextDecorationSkipInk: rangeGetter(
          'textDecorationSkipInk',
          () => text.textDecorationSkipInk
        ),
        setRangeTextDecorationSkipInk: rangeSetter<boolean>('textDecorationSkipInk'),
        getRangeFills: rangeGetter('fills', () => text.fills),
        setRangeFills: vi.fn((start: number, end: number, value: Paint[]) => {
          setRangeValue(start, end, 'fills', value)
          setRangeValue(start, end, 'fillStyleId', '')
        }),
        getRangeTextStyleId: rangeGetter('textStyleId', () => text.textStyleId),
        setRangeTextStyleIdAsync: vi.fn(async (start: number, end: number, styleId: string) => {
          if (styleId && styles.get(styleId)?.type !== 'TEXT') throw new Error('invalid text style')
          setRangeValue(start, end, 'textStyleId', styleId)
        }),
        getRangeFillStyleId: rangeGetter('fillStyleId', () => text.fillStyleId),
        setRangeFillStyleIdAsync: vi.fn(async (start: number, end: number, styleId: string) => {
          if (styleId && styles.get(styleId)?.type !== 'PAINT')
            throw new Error('invalid fill style')
          setRangeValue(start, end, 'fillStyleId', styleId)
          if (styleId)
            setRangeValue(start, end, 'fills', (styles.get(styleId) as PaintStyle).paints)
        }),
        getRangeListOptions: rangeGetter(
          'listOptions',
          () => ({ type: 'NONE' }) as TextListOptions
        ),
        setRangeListOptions: rangeSetter<TextListOptions>('listOptions'),
        getRangeListSpacing: rangeGetter('listSpacing', () => text.listSpacing),
        setRangeListSpacing: rangeSetter<number>('listSpacing'),
        getRangeIndentation: rangeGetter('indentation', () => 0),
        setRangeIndentation: rangeSetter<number>('indentation'),
        getRangeParagraphIndent: rangeGetter('paragraphIndent', () => text.paragraphIndent),
        setRangeParagraphIndent: rangeSetter<number>('paragraphIndent'),
        getRangeParagraphSpacing: rangeGetter('paragraphSpacing', () => text.paragraphSpacing),
        setRangeParagraphSpacing: rangeSetter<number>('paragraphSpacing'),
        getRangeHyperlink: rangeGetter('hyperlink', () => text.hyperlink),
        setRangeHyperlink: rangeSetter<HyperlinkTarget | null>('hyperlink'),
        getStyledTextSegments: vi.fn((fields: string[]) => {
          const ranges = new Set([...rangeValues.keys()].map((key) => key.split(':', 2).join(':')))
          if (!ranges.size) ranges.add(`0:${characters.length}`)
          return [...ranges].map((range) => {
            const [start, end] = range.split(':').map(Number) as [number, number]
            const segment: Record<string, unknown> = {
              start,
              end,
              characters: characters.slice(start, end)
            }
            if (fields.includes('fills')) {
              segment.fills = rangeValue(start, end, 'fills', text.fills)
            }
            if (fields.includes('hyperlink')) {
              segment.hyperlink = rangeValue(start, end, 'hyperlink', text.hyperlink)
            }
            if (fields.includes('boundVariables')) {
              const variables = { ...text.boundVariables } as Record<string, VariableAlias>
              const prefix = `${start}:${end}:variable:`
              for (const [key, value] of rangeValues) {
                if (!key.startsWith(prefix) || !value) continue
                variables[key.slice(prefix.length)] = value as VariableAlias
              }
              segment.boundVariables = variables
            }
            return segment
          })
        }),
        getRangeBoundVariable: vi.fn((start: number, end: number, field: string) =>
          rangeValue<VariableAlias | null>(start, end, `variable:${field}`, null)
        ),
        setRangeBoundVariable: vi.fn(
          (start: number, end: number, field: string, variable: Variable | null) =>
            setRangeValue(
              start,
              end,
              `variable:${field}`,
              variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : null
            )
        )
      })
      Object.defineProperties(node, {
        name: {
          get: () => layerName,
          set: (value: string) => {
            layerName = value
            autoRename = false
          }
        },
        characters: {
          get: () => characters,
          set: (value: string) => {
            characters = value
            if (autoRename) layerName = value
          }
        },
        autoRename: {
          get: () => autoRename,
          set: (value: boolean) => {
            autoRename = value
            if (value) layerName = characters
          }
        },
        layoutSizingHorizontal: {
          configurable: true,
          get: () => layoutSizingHorizontal,
          set: (value: TextNode['layoutSizingHorizontal']) => {
            layoutSizingHorizontal = value
            const parent = text.parent
            if (value === 'FILL' && parent && 'layoutMode' in parent) {
              if (parent.layoutMode === 'VERTICAL') {
                ;(text as unknown as { width: number }).width = Math.max(
                  0,
                  parent.width - parent.paddingLeft - parent.paddingRight
                )
              }
            }
          }
        },
        textAutoResize: {
          get: () => textAutoResize,
          set: (value: TextNode['textAutoResize']) => {
            textAutoResize = value
            if (value === 'HEIGHT' && layoutSizingHorizontal === 'FILL') {
              ;(text as unknown as { width: number }).width = 0
            }
          }
        },
        textTruncation: {
          get: () => textTruncation,
          set: (value: TextNode['textTruncation']) => {
            textTruncation = value
          }
        },
        maxLines: {
          get: () => maxLines,
          set: (value: TextNode['maxLines']) => {
            maxLines = value
            if (value !== null && textTruncation === 'ENDING') textAutoResize = 'HEIGHT'
          }
        }
      })
    }
    if (type === 'ELLIPSE') {
      Object.assign(node, {
        arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 }
      })
    }
    if (type === 'POLYGON') {
      Object.assign(node, { pointCount: 3 })
    }
    if (type === 'STAR') {
      Object.assign(node, { pointCount: 5, innerRadius: 0.5 })
    }

    PAGE.children.push(node)
    nodes.set(id, node)
    return node
  }

  function createInstance(component: ComponentNode): InstanceNode {
    const instance = createNode('INSTANCE')
    let mainComponent = component
    let scaleFactor = 1
    const overrides: Array<{ id: string; overriddenFields: NodeChangeProperty[] }> = []
    const definitions =
      component.parent?.type === 'COMPONENT_SET'
        ? component.parent.componentPropertyDefinitions
        : component.componentPropertyDefinitions
    Object.defineProperties(instance, {
      mainComponent: {
        get: () => mainComponent,
        set: (value: ComponentNode) => {
          mainComponent = value
          overrides.splice(0)
        }
      },
      overrides: { get: () => overrides },
      scaleFactor: {
        get: () => scaleFactor,
        set: (value: number) => {
          const ratio = value / scaleFactor
          scaleFactor = value
          instance.width *= ratio
          instance.height *= ratio
        }
      }
    })
    const getOwnSharedPluginData = instance.getSharedPluginData.bind(instance)
    Object.assign(instance, {
      getSharedPluginData: vi.fn(
        (namespace: string, key: string) =>
          getOwnSharedPluginData(namespace, key) ||
          mainComponent.getSharedPluginData(namespace, key)
      ),
      isExposedInstance: false,
      componentProperties: Object.fromEntries(
        Object.entries(definitions)
          .filter(([, property]) => property.type !== 'SLOT')
          .map(([name, property]) => [
            name,
            {
              type: property.type,
              value: property.defaultValue,
              ...(property.boundVariables
                ? { boundVariables: { value: property.boundVariables.defaultValue } }
                : {})
            }
          ])
      ),
      getMainComponentAsync: vi.fn(async () => mainComponent),
      swapComponent: vi.fn((next: ComponentNode) => {
        mainComponent = next
      }),
      setProperties: vi.fn((properties: Record<string, string | boolean | VariableAlias>) => {
        for (const [name, value] of Object.entries(properties)) {
          const current = instance.componentProperties[name]
          instance.componentProperties[name] =
            typeof value === 'object'
              ? {
                  type: current?.type ?? 'TEXT',
                  value: current?.value ?? '',
                  boundVariables: { value }
                }
              : { type: current?.type ?? 'TEXT', value }
        }
        const componentSet = mainComponent.parent
        if (componentSet?.type !== 'COMPONENT_SET' || !('children' in componentSet)) return
        const variantProperties = Object.fromEntries(
          Object.entries(instance.componentProperties)
            .filter(([, property]) => property.type === 'VARIANT')
            .map(([name, property]) => [name.split('#')[0], property.value])
        )
        const variant = componentSet.children.find((child): child is ComponentNode => {
          if (child.type !== 'COMPONENT') return false
          const values = Object.fromEntries(
            child.name.split(',').map((part) => {
              const [name, ...value] = part.split('=')
              return [name?.trim(), value.join('=').trim()]
            })
          )
          return Object.entries(variantProperties).every(([name, value]) => values[name] === value)
        })
        if (variant) mainComponent = variant
      })
    })
    return instance as unknown as InstanceNode
  }

  function wrapNodes(
    type: 'BOOLEAN_OPERATION' | 'GROUP',
    children: readonly MutableNode[],
    parent: BaseNode & ChildrenMixin,
    index: number | undefined,
    operation: BooleanOperationNode['booleanOperation'] = 'UNION'
  ): MutableNode {
    const minX = Math.min(...children.map((child) => child.x))
    const minY = Math.min(...children.map((child) => child.y))
    const maxX = Math.max(...children.map((child) => child.x + child.width))
    const maxY = Math.max(...children.map((child) => child.y + child.height))
    const wrapper = createNode(type)
    wrapper.x = minX
    wrapper.y = minY
    wrapper.resize(maxX - minX, maxY - minY)
    if (type === 'BOOLEAN_OPERATION') wrapper.booleanOperation = operation
    parent.insertChild(index ?? parent.children.length, wrapper)
    for (const [childIndex, child] of children.entries()) {
      const x = child.x
      const y = child.y
      wrapper.insertChild(childIndex, child)
      child.x = x - minX
      child.y = y - minY
    }
    return wrapper
  }

  function combineVariants(
    children: readonly MutableNode[],
    parent: BaseNode & ChildrenMixin,
    index: number | undefined
  ): MutableNode {
    const set = createNode('COMPONENT_SET')
    parent.insertChild(index ?? parent.children.length, set)
    for (const [childIndex, child] of children.entries()) {
      set.insertChild(childIndex, child)
    }
    return set
  }

  const componentPropertyDefinitions = {
    Label: { type: 'TEXT', defaultValue: 'Default' },
    Disabled: { type: 'BOOLEAN', defaultValue: false },
    State: {
      type: 'VARIANT',
      defaultValue: 'Default',
      variantOptions: ['Default', 'Hover']
    },
    Icon: { type: 'INSTANCE_SWAP', defaultValue: 'component:1' },
    Content: { type: 'SLOT', defaultValue: '' }
  } satisfies ComponentPropertyDefinitions
  const componentSet = withSharedPluginData({
    id: 'component-set:1',
    type: 'COMPONENT_SET',
    parent: PAGE,
    componentPropertyDefinitions
  }) as unknown as ComponentSetNode
  const component = withSharedPluginData({
    id: 'component:1',
    type: 'COMPONENT',
    key: 'component-key',
    parent: componentSet,
    componentPropertyDefinitions: Object.fromEntries(
      Object.entries(componentPropertyDefinitions).filter(
        ([, definition]) => definition.type !== 'VARIANT'
      )
    ),
    createInstance: () => createInstance(component)
  }) as unknown as ComponentNode
  nodes.set(componentSet.id, componentSet)
  nodes.set(component.id, component)

  const colorVariable = {
    id: 'variable:color',
    key: 'color-key',
    resolvedType: 'COLOR'
  } as unknown as Variable
  const spacingVariable = {
    id: 'variable:spacing',
    key: 'spacing-key',
    resolvedType: 'FLOAT'
  } as Variable
  const fontVariable = {
    id: 'variable:font',
    key: 'font-key',
    resolvedType: 'STRING',
    resolveForConsumer: () => ({ value: 'Inter', resolvedType: 'STRING' })
  } as unknown as Variable
  const variablesById = new Map([
    [spacingVariable.id, spacingVariable],
    [
      'variable:range-size',
      {
        id: 'variable:range-size',
        key: 'range-size-key',
        resolvedType: 'FLOAT'
      } as unknown as Variable
    ],
    [
      'variable:range-family',
      {
        id: 'variable:range-family',
        key: 'range-family-key',
        resolvedType: 'STRING',
        resolveForConsumer: (consumer: SceneNode) => ({
          value:
            consumer.explicitVariableModes['collection:tokens'] === 'mode:dark'
              ? 'Roboto'
              : 'Inter',
          resolvedType: 'STRING'
        })
      } as unknown as Variable
    ],
    [
      'variable:range-style',
      {
        id: 'variable:range-style',
        key: 'range-style-key',
        resolvedType: 'STRING',
        resolveForConsumer: () => ({ value: 'Bold', resolvedType: 'STRING' })
      } as unknown as Variable
    ],
    [fontVariable.id, fontVariable],
    [
      'variable:visible',
      {
        id: 'variable:visible',
        key: 'visible-key',
        resolvedType: 'BOOLEAN'
      } as Variable
    ],
    [
      'variable:component-label',
      {
        id: 'variable:component-label',
        key: 'component-label-key',
        resolvedType: 'STRING'
      } as Variable
    ]
  ])
  const variableCollection = {
    id: 'collection:tokens',
    key: 'collection-key',
    name: 'Tokens',
    remote: false,
    modes: [
      { modeId: 'mode:light', name: 'Light' },
      { modeId: 'mode:dark', name: 'Dark' }
    ],
    defaultModeId: 'mode:light',
    variableIds: []
  } as unknown as VariableCollection
  const variableCollectionsById = new Map([[variableCollection.id, variableCollection]])
  const localCollectionIds = new Set<string>()
  const localVariableIds = new Set<string>()
  const extendedModes = new Map<string, ExtendedVariableCollection>()
  const registeredVariables = new WeakSet<object>()
  let nextVariableCollectionId = 1
  let nextVariableId = 1

  function registerVariable(variable: Variable): Variable {
    if (registeredVariables.has(variable)) return variable
    registeredVariables.add(variable)
    const setValueForMode = variable.setValueForMode.bind(variable)
    variable.setValueForMode = (modeId, value) => {
      const collection = extendedModes.get(modeId)
      if (!collection) {
        setValueForMode(modeId, value)
        return
      }
      ;(collection.variableOverrides[variable.id] ??= {})[modeId] = value
    }
    variable.removeOverrideForMode = vi.fn((modeId: string) => {
      const collection = extendedModes.get(modeId)
      if (!collection) return
      const values = collection.variableOverrides[variable.id]
      if (!values) return
      delete values[modeId]
      if (!Object.keys(values).length) delete collection.variableOverrides[variable.id]
    })
    variable.remove = vi.fn(() => {
      variablesById.delete(variable.id)
      localVariableIds.delete(variable.id)
      const collection = variableCollectionsById.get(variable.variableCollectionId)
      if (!collection || collection.isExtension) return
      const index = (collection.variableIds as string[]).indexOf(variable.id)
      if (index >= 0) (collection.variableIds as string[]).splice(index, 1)
    })
    return variable
  }

  function registerCollection(collection: VariableCollection): VariableCollection {
    variableCollectionsById.set(collection.id, collection)
    localCollectionIds.add(collection.id)
    collection.removeMode = vi.fn((modeId: string) => {
      const index = collection.modes.findIndex((mode) => mode.modeId === modeId)
      if (index < 0) throw new Error(`Missing mode ${modeId}`)
      collection.modes.splice(index, 1)
      if (collection.isExtension) {
        const extended = collection as unknown as ExtendedVariableCollection
        extendedModes.delete(modeId)
        for (const values of Object.values(extended.variableOverrides)) {
          delete values[modeId]
        }
      } else {
        for (const variableId of collection.variableIds) {
          const variable = variablesById.get(variableId)
          if (variable) delete (variable.valuesByMode as Record<string, VariableValue>)[modeId]
        }
      }
      if (collection.defaultModeId === modeId) {
        ;(collection as unknown as { defaultModeId: string }).defaultModeId =
          collection.modes[0]!.modeId
      }
    })
    collection.remove = vi.fn(() => {
      if (!collection.isExtension) {
        for (const variableId of [...collection.variableIds]) {
          variablesById.get(variableId)?.remove()
        }
      }
      for (const mode of collection.modes) extendedModes.delete(mode.modeId)
      variableCollectionsById.delete(collection.id)
      localCollectionIds.delete(collection.id)
    })
    return collection
  }

  function extendCollection(parent: VariableCollection, name: string): ExtendedVariableCollection {
    const id = `collection:extended:${nextVariableCollectionId++}`
    const modes = parent.modes.map((mode, index) => ({
      modeId: `${id}:mode:${index + 1}`,
      name: mode.name,
      parentModeId: mode.modeId
    }))
    const collection = withSharedPluginData({
      id,
      key: `${id}:key`,
      name,
      hiddenFromPublishing: false,
      remote: false,
      isExtension: true as const,
      parentVariableCollectionId: parent.id,
      rootVariableCollectionId: parent.isExtension
        ? (parent as unknown as ExtendedVariableCollection).rootVariableCollectionId
        : parent.id,
      modes,
      get variableIds() {
        return parent.variableIds
      },
      defaultModeId:
        modes.find((mode) => mode.parentModeId === parent.defaultModeId)?.modeId ??
        modes[0]!.modeId,
      variableOverrides: {} as Record<string, Record<string, VariableValue>>,
      removeOverridesForVariable(variable: Variable) {
        delete collection.variableOverrides[variable.id]
      },
      extend: vi.fn((childName: string) =>
        extendCollection(collection as unknown as VariableCollection, childName)
      )
    }) as unknown as ExtendedVariableCollection
    for (const mode of modes) extendedModes.set(mode.modeId, collection)
    return registerCollection(
      collection as unknown as VariableCollection
    ) as unknown as ExtendedVariableCollection
  }

  function enableExtension(collection: VariableCollection): void {
    collection.extend = vi.fn((name: string) => extendCollection(collection, name))
  }

  enableExtension(variableCollection)
  const commitUndo = vi.fn()
  const triggerUndo = vi.fn()
  const images = new Map<string, Image>()
  const createImage = vi.fn((bytes: Uint8Array) => {
    const hash = `image:${Array.from(bytes).join(',')}`
    const image = { hash } as Image
    images.set(hash, image)
    return image
  })
  const createImageAsync = vi.fn(async (url: string) => ({
    hash: `image:${url}`
  }))
  const createNodeFromSvg = vi.fn(() => {
    const node = createNode('FRAME')
    node.resize(24, 24)
    return node
  })
  const createVideoAsync = vi.fn(async (bytes: Uint8Array) => ({
    hash: `video:${Array.from(bytes).join(',')}`
  }))
  const loadFontAsync = vi.fn().mockResolvedValue(undefined)
  const importComponentByKeyAsync = vi.fn().mockResolvedValue(component)
  const shaders = new Map<string, Shader>([
    [
      'shader:effect',
      {
        id: 'shader:effect',
        name: 'Aurora',
        type: 'effect',
        imported: true,
        propertyDefinitions: {
          strength: {
            name: 'Strength',
            type: 'NUMBER',
            defaultValue: 0.5
          },
          tint: {
            name: 'Tint',
            type: 'COLOR',
            defaultValue: { r: 1, g: 1, b: 1 }
          },
          origin: {
            name: 'Origin',
            type: 'COLOR_POINT',
            defaultValue: { x: 0.5, y: 0.5, color: { r: 1, g: 1, b: 1 } }
          },
          ramp: {
            name: 'Ramp',
            type: 'GRADIENT',
            defaultValue: {
              stops: [
                { position: 0, color: { r: 0, g: 0, b: 0 } },
                { position: 1, color: { r: 1, g: 1, b: 1 } }
              ]
            }
          },
          swap: {
            name: 'Swap',
            type: 'INSTANCE_SWAP',
            defaultValue: 'component:1'
          }
        }
      }
    ],
    [
      'shader:fill',
      {
        id: 'shader:fill',
        name: 'Fill only',
        type: 'fill',
        imported: true,
        propertyDefinitions: {
          strength: {
            name: 'Strength',
            type: 'NUMBER',
            defaultValue: 0.5
          },
          tint: {
            name: 'Tint',
            type: 'COLOR',
            defaultValue: { r: 1, g: 1, b: 1 }
          },
          swap: {
            name: 'Swap',
            type: 'INSTANCE_SWAP',
            defaultValue: 'component:1'
          }
        }
      }
    ]
  ])
  const importShaderById = vi.fn(async (id: string) => {
    const shader = shaders.get(id)
    if (!shader) throw new Error('missing shader')
    return shader
  })
  const importStyleByKeyAsync = vi.fn((key: string) =>
    Promise.resolve([...styles.values()].find((style) => style.key === key) ?? null)
  )
  const fillStyle = {
    id: 'style:fill',
    key: 'fill-style-key',
    name: 'Surface',
    type: 'PAINT',
    paints: [
      {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0]
        ],
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
        ]
      }
    ]
  } as unknown as PaintStyle
  const strokeStyle = {
    id: 'style:stroke',
    key: 'stroke-style-key',
    name: 'Border',
    type: 'PAINT',
    paints: [solidPaint({ r: 0, g: 0.5, b: 1 })]
  } as unknown as PaintStyle
  const textStyle = {
    id: 'style:text',
    key: 'text-style-key',
    name: 'Heading',
    type: 'TEXT',
    fontName: { family: 'Inter', style: 'Bold' },
    fontSize: 24,
    lineHeight: { unit: 'PIXELS', value: 32 },
    letterSpacing: { unit: 'PIXELS', value: -0.25 },
    textCase: 'TITLE',
    textDecoration: 'UNDERLINE',
    paragraphIndent: 4,
    paragraphSpacing: 20,
    listSpacing: 6,
    hangingPunctuation: true,
    hangingList: false,
    leadingTrim: 'CAP_HEIGHT'
  } as TextStyle
  const effectStyle = {
    id: 'style:effect',
    key: 'effect-style-key',
    name: 'Raised',
    type: 'EFFECT',
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 4 },
        radius: 8,
        spread: 0,
        visible: true,
        blendMode: 'NORMAL'
      }
    ]
  } as unknown as EffectStyle
  const gridStyle = {
    id: 'style:grid',
    key: 'grid-style-key',
    name: 'Columns',
    type: 'GRID',
    layoutGrids: [
      {
        pattern: 'COLUMNS',
        alignment: 'STRETCH',
        gutterSize: 16,
        count: 12,
        offset: 24
      }
    ]
  } as unknown as GridStyle
  for (const style of [fillStyle, strokeStyle, textStyle, effectStyle, gridStyle]) {
    Object.assign(style, {
      description: '',
      descriptionMarkdown: '',
      documentationLinks: [] as DocumentationLink[],
      remote: false,
      getStyleConsumersAsync: vi.fn(() => Promise.resolve(styleConsumers(style.id))),
      remove: vi.fn(() => styles.delete(style.id))
    })
    styles.set(style.id, withSharedPluginData(style))
  }

  vi.stubGlobal('figma', {
    editorType: 'figma',
    mixed: MIXED,
    root,
    currentPage: PAGE,
    viewport: { center: { x: 500, y: 400 } },
    commitUndo,
    triggerUndo,
    getNodeById: vi.fn((id: string) => nodes.get(id) ?? null),
    getNodeByIdAsync: vi.fn((id: string) => Promise.resolve(nodes.get(id) ?? null)),
    getImageByHash: vi.fn((hash: string) =>
      hash === 'image:existing'
        ? ({
            hash,
            getBytesAsync: vi.fn(),
            getSizeAsync: vi.fn()
          } as unknown as Image)
        : (images.get(hash) ?? null)
    ),
    createImage,
    createImageAsync,
    createNodeFromSvg,
    createVideoAsync,
    createPage: vi.fn(() => {
      const number = nextPageId++
      const page = createMockPage(`0:${number}`, `Page ${number}`)
      page.parent = root as unknown as DocumentNode
      pages.push(page)
      return page
    }),
    getStyleByIdAsync: vi.fn((id: string) => Promise.resolve(styles.get(id) ?? null)),
    getLocalPaintStylesAsync: vi.fn(() =>
      Promise.resolve(
        [...styles.values()].filter((style) => style.type === 'PAINT') as PaintStyle[]
      )
    ),
    getLocalTextStylesAsync: vi.fn(() =>
      Promise.resolve([...styles.values()].filter((style) => style.type === 'TEXT') as TextStyle[])
    ),
    getLocalEffectStylesAsync: vi.fn(() =>
      Promise.resolve(
        [...styles.values()].filter((style) => style.type === 'EFFECT') as EffectStyle[]
      )
    ),
    getLocalGridStylesAsync: vi.fn(() =>
      Promise.resolve([...styles.values()].filter((style) => style.type === 'GRID') as GridStyle[])
    ),
    createPaintStyle: vi.fn(() => createStyle('PAINT') as PaintStyle),
    createTextStyle: vi.fn(() => createStyle('TEXT') as TextStyle),
    createEffectStyle: vi.fn(() => createStyle('EFFECT') as EffectStyle),
    createGridStyle: vi.fn(() => createStyle('GRID') as GridStyle),
    createComponent: vi.fn(() => createNode('COMPONENT')),
    createEllipse: vi.fn(() => createNode('ELLIPSE')),
    createFrame: vi.fn(() => createNode('FRAME')),
    createLine: vi.fn(() => createNode('LINE')),
    createPolygon: vi.fn(() => createNode('POLYGON')),
    createRectangle: vi.fn(() => createNode('RECTANGLE')),
    createSection: vi.fn(() => createNode('SECTION')),
    createStar: vi.fn(() => createNode('STAR')),
    createText: vi.fn(() => createNode('TEXT')),
    createVector: vi.fn(() => createNode('VECTOR')),
    combineAsVariants: vi.fn(
      (children: readonly MutableNode[], parent: BaseNode & ChildrenMixin, index?: number) => {
        const page = containingPage(parent)
        if (children.some((child) => containingPage(child).id !== page.id)) {
          throw new Error('Components and their destination must be on the same page')
        }
        return combineVariants(children, parent, index)
      }
    ),
    group: vi.fn(
      (children: readonly MutableNode[], parent: BaseNode & ChildrenMixin, index?: number) =>
        wrapNodes('GROUP', children, parent, index)
    ),
    union: vi.fn(
      (children: readonly MutableNode[], parent: BaseNode & ChildrenMixin, index?: number) =>
        wrapNodes('BOOLEAN_OPERATION', children, parent, index, 'UNION')
    ),
    subtract: vi.fn(
      (children: readonly MutableNode[], parent: BaseNode & ChildrenMixin, index?: number) =>
        wrapNodes('BOOLEAN_OPERATION', children, parent, index, 'SUBTRACT')
    ),
    intersect: vi.fn(
      (children: readonly MutableNode[], parent: BaseNode & ChildrenMixin, index?: number) =>
        wrapNodes('BOOLEAN_OPERATION', children, parent, index, 'INTERSECT')
    ),
    exclude: vi.fn(
      (children: readonly MutableNode[], parent: BaseNode & ChildrenMixin, index?: number) =>
        wrapNodes('BOOLEAN_OPERATION', children, parent, index, 'EXCLUDE')
    ),
    importComponentByKeyAsync,
    importShaderById,
    importStyleByKeyAsync,
    listAvailableShaders: vi.fn(() => Promise.resolve([...shaders.values()])),
    loadFontAsync,
    util: {
      solidPaint: vi.fn((color: string) => {
        const hex = color.slice(1)
        return {
          type: 'SOLID',
          color: {
            r: Number.parseInt(hex.slice(0, 2), 16) / 255,
            g: Number.parseInt(hex.slice(2, 4), 16) / 255,
            b: Number.parseInt(hex.slice(4, 6), 16) / 255
          },
          opacity: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
        } as SolidPaint
      })
    },
    variables: {
      createVariable: vi.fn(
        (name: string, collection: VariableCollection, resolvedType: VariableResolvedDataType) => {
          const variable = mockVariable(
            `variable:authored:${nextVariableId++}`,
            name,
            collection,
            resolvedType
          )
          variablesById.set(variable.id, registerVariable(variable))
          localVariableIds.add(variable.id)
          ;(collection.variableIds as string[]).push(variable.id)
          return variable
        }
      ),
      createVariableCollection: vi.fn((name: string) => {
        const collection = mockVariableCollection(
          `collection:authored:${nextVariableCollectionId++}`,
          name
        )
        enableExtension(collection)
        return registerCollection(collection)
      }),
      extendLibraryCollectionByKeyAsync: vi.fn((key: string, name: string) => {
        const parent = [...variableCollectionsById.values()].find(
          (collection) => collection.key === key
        )
        if (!parent) throw new Error(`Missing collection ${key}`)
        return Promise.resolve(extendCollection(parent, name))
      }),
      getLocalVariablesAsync: vi.fn(() =>
        Promise.resolve([...localVariableIds].map((id) => variablesById.get(id)!))
      ),
      getLocalVariableCollectionsAsync: vi.fn(() =>
        Promise.resolve([...localCollectionIds].map((id) => variableCollectionsById.get(id)!))
      ),
      getVariableByIdAsync: vi.fn((id: string) => Promise.resolve(variablesById.get(id) ?? null)),
      getVariableCollectionByIdAsync: vi.fn((id: string) =>
        Promise.resolve(variableCollectionsById.get(id) ?? null)
      ),
      importVariableByKeyAsync: vi.fn((key: string) =>
        Promise.resolve(
          [...variablesById.values()].find((variable) => variable.key === key) ??
            (key === colorVariable.key ? colorVariable : null)
        )
      ),
      setBoundVariableForPaint: vi.fn(
        (paint: SolidPaint, _field: string, variable: Variable | null) => {
          if (variable === null) {
            const { boundVariables: _boundVariables, ...unbound } = paint
            return unbound
          }
          return {
            ...paint,
            boundVariables: {
              color: { type: 'VARIABLE_ALIAS', id: variable.id }
            }
          }
        }
      ),
      setBoundVariableForEffect: vi.fn(
        (effect: Effect, field: string, variable: Variable) =>
          ({
            ...effect,
            boundVariables: {
              ...('boundVariables' in effect ? effect.boundVariables : {}),
              [field]: { type: 'VARIABLE_ALIAS', id: variable.id }
            }
          }) as Effect
      ),
      setBoundVariableForLayoutGrid: vi.fn(
        (layoutGrid: LayoutGrid, field: string, variable: Variable) =>
          ({
            ...layoutGrid,
            boundVariables: {
              ...layoutGrid.boundVariables,
              [field]: { type: 'VARIABLE_ALIAS', id: variable.id }
            }
          }) as LayoutGrid
      ),
      createVariableAlias: vi.fn(
        (variable: Variable) => ({ type: 'VARIABLE_ALIAS', id: variable.id }) as VariableAlias
      )
    }
  } as unknown as PluginAPI)
  vi.stubGlobal('window', {
    INITIAL_OPTIONS: { editor_type: 'design' }
  } as unknown as Window)

  return {
    commitUndo,
    createImage,
    createImageAsync,
    createNodeFromSvg,
    createVideoAsync,
    createNode,
    getNode(id: string) {
      const node = nodes.get(id)
      if (!node || !('resize' in node)) throw new Error(`Missing mock node ${id}`)
      return node as MutableNode
    },
    importComponentByKeyAsync,
    importShaderById,
    importStyleByKeyAsync,
    loadFontAsync,
    nodes,
    pages,
    styles,
    triggerUndo,
    variableCollections: variableCollectionsById,
    variables: variablesById
  }
}

function createSpec(text = 'Hello'): CanvasResolvedApplyParameters {
  return {
    mode: 'create',
    markup: `
      <div
        data-key="card"
        class="flex flex-row w-[320px] h-[200px] gap-[8px] pt-[16px] items-center justify-between bg-[#336699] border-[2px] border-[#112233] rounded-[12px] opacity-[0.8]"
      >
        <span data-key="card/title" class="grow w-fit h-fit min-w-[1px] font-semibold text-[18px] leading-[24px] tracking-[0.5px] text-center">${text}</span>
        <div data-key="card/body" class="w-[80px] h-[40px] bg-[#ABCDEF] rounded-[8px]"></div>
        <div data-key="card/dot" class="w-[12px] h-[12px]"></div>
        <div data-key="card/divider" class="w-[120px] h-[1px] bg-[#000000]"></div>
        <div data-key="card/action" class="w-fit h-fit"></div>
      </div>
    `,
    bindings: {
      card: {
        variables: {
          fill: { key: 'color-key' },
          stroke: { key: 'color-key' },
          gap: { id: 'variable:spacing' },
          paddingRight: { id: 'variable:spacing' }
        }
      },
      'card/action': {
        component: { key: 'component-key' },
        componentProperties: { Label: 'Save', Disabled: true }
      }
    }
  }
}

function videoUrlSpec(videoUrl: string): CanvasResolvedApplyParameters {
  return {
    mode: 'create',
    markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
    bindings: {
      root: {
        figma: {
          fills: [{ type: 'VIDEO', videoUrl, scaleMode: 'FILL' }]
        }
      }
    }
  }
}

afterEach(() => {
  PAGE.children.length = 0
  resetAssetCache()
  setAssetDownloader(null)
  setAssetServerUrl(null)
  setAssetUploader(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/canvas', () => {
  it('accepts a public primitive result without a catalog', async () => {
    createFixture()

    const result = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[120px] h-[80px]"><span data-key="label" class="w-fit h-fit">Hello</span></div>'
    })

    expect(Object.keys(result.nodeIdsByKey)).toEqual(['root', 'label'])
    expect(result.verification).toEqual({
      status: 'passed',
      nodesChecked: 2,
      referencesChecked: 0,
      nativeFieldsChecked: 0,
      warnings: []
    })
  })

  it('rejects unsupported and read-only editors before accepting a desired result', async () => {
    const fixture = createFixture()
    const input = {
      mode: 'create' as const,
      markup: '<div data-key="root" class="w-[120px] h-[80px]"></div>'
    }

    vi.stubGlobal('window', {} as Window)
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_UNSUPPORTED_EDITOR
    })

    vi.stubGlobal('window', {
      INITIAL_OPTIONS: { editor_type: 'whiteboard' }
    } as unknown as Window)
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_UNSUPPORTED_EDITOR
    })

    vi.stubGlobal('window', {
      INITIAL_OPTIONS: { editor_type: 'design' }
    } as unknown as Window)
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      throw Object.setPrototypeOf(new Error('Cannot write to internal and read-only nodes'), null)
    })
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_READ_ONLY,
      message: expect.stringContaining('requires edit access')
    })
    expect(fixture.commitUndo).toHaveBeenCalledOnce()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()

    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      throw 'Cannot write to internal and read-only nodes'
    })
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_READ_ONLY,
      message: expect.stringContaining('requires edit access')
    })

    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      throw Object.setPrototypeOf(
        new Error('in set_layoutSizingHorizontal: unsupported node'),
        null
      )
    })
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('set_layoutSizingHorizontal')
    })

    await expect(applyCanvasFromTool()).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
  })

  it('creates one result tree, applies design-system references, and centers the root', async () => {
    const fixture = createFixture()
    const result = await applyCanvas(createSpec())

    expect(result.createdNodeIds).toHaveLength(6)
    expect(result.updatedNodeIds).toEqual([])
    expect(Object.keys(result.nodeIdsByKey)).toEqual([
      'card',
      'card/title',
      'card/body',
      'card/dot',
      'card/divider',
      'card/action'
    ])
    expect(fixture.commitUndo).toHaveBeenCalledTimes(2)
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(fixture.importComponentByKeyAsync).toHaveBeenCalledWith('component-key')
    expect(result.verification).toMatchObject({
      status: 'passed',
      nodesChecked: 6,
      referencesChecked: 5
    })

    const root = fixture.getNode(result.rootNodeId) as unknown as FrameNode
    expect(root.children).toHaveLength(5)
    expect(root.x).toBe(340)
    expect(root.y).toBe(300)
    expect(root.layoutMode).toBe('HORIZONTAL')
    expect(root.strokesIncludedInLayout).toBe(true)
    expect(root.paddingTop).toBe(16)
    expect(root.paddingRight).toBe(11)
    expect(root.paddingBottom).toBe(0)
    expect(root.paddingLeft).toBe(0)
    expect(root.boundVariables).toMatchObject({
      fills: [{ id: 'variable:color' }],
      strokes: [{ id: 'variable:color' }],
      itemSpacing: { id: 'variable:spacing' },
      paddingRight: { id: 'variable:spacing' }
    })

    const title = fixture.getNode(result.nodeIdsByKey['card/title'] ?? '') as unknown as TextNode
    expect(title.characters).toBe('Hello')
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' })
    expect(title.layoutGrow).toBe(1)
    expect(title.layoutSizingHorizontal).toBe('FILL')
    expect(title.textAutoResize).toBe('HEIGHT')
    expect(title.width).toBeGreaterThan(0)
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({
      family: 'Inter',
      style: 'Semi Bold'
    })

    const action = fixture.getNode(
      result.nodeIdsByKey['card/action'] ?? ''
    ) as unknown as InstanceNode
    expect(action.componentProperties.Label?.value).toBe('Save')
    expect(action.componentProperties.Disabled?.value).toBe(true)
  })

  it('does not apply Auto Layout sizing fields to freeform children', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const child = fixture.createNode('FRAME') as unknown as FrameNode
    root.appendChild(child)
    const copy = fixture.createNode('TEXT') as unknown as TextNode
    root.appendChild(copy)
    for (const node of [child, copy]) {
      Object.defineProperties(node, {
        layoutSizingHorizontal: {
          configurable: true,
          get: () => 'FIXED',
          set: () => {
            throw new Error('layoutSizingHorizontal is unavailable outside Auto Layout')
          }
        },
        layoutSizingVertical: {
          configurable: true,
          get: () => 'FIXED',
          set: () => {
            throw new Error('layoutSizingVertical is unavailable outside Auto Layout')
          }
        }
      })
    }

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `<div data-key="root" class="w-[320px] h-[200px]"><div data-key="art" data-node-id="${child.id}" class="absolute left-[24px] top-[20px] w-[150px] h-[150px]"></div><span data-key="copy" data-node-id="${copy.id}" class="absolute left-[24px] top-[178px] w-[150px] h-fit">Caption</span></div>`
    })

    expect(updated.nodeIdsByKey.art).toBe(child.id)
    expect(child).toMatchObject({ x: 24, y: 20, width: 150, height: 150 })
    expect(updated.nodeIdsByKey.copy).toBe(copy.id)
    expect(copy).toMatchObject({ x: 24, y: 178, width: 150, characters: 'Caption' })
  })

  it('auto-places every create root and preserves only explicit transform axes', async () => {
    const fixture = createFixture()
    const create = (key: string) =>
      applyCanvas({
        mode: 'create',
        markup: `<div data-key="${key}" class="w-[100px] h-[100px]"></div>`
      })

    const firstResult = await create('first')
    const secondResult = await create('second')
    const thirdResult = await create('third')
    const first = fixture.getNode(firstResult.rootNodeId)
    const second = fixture.getNode(secondResult.rootNodeId)
    const third = fixture.getNode(thirdResult.rootNodeId)

    expect(first).toMatchObject({ x: 450, y: 350 })
    expect(second).toMatchObject({ x: 630, y: 350 })
    expect(third).toMatchObject({ x: 810, y: 350 })

    const transformedResult = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="transformed" class="w-[100px] h-[100px]"></div>',
      bindings: {
        transformed: {
          figma: {
            relativeTransform: [
              [1, 0.25, 40],
              [0, 1, 60]
            ]
          }
        }
      }
    })
    expect(fixture.getNode(transformedResult.rootNodeId).relativeTransform).toEqual([
      [1, 0.25, 990],
      [0, 1, 350]
    ])
  })

  it('does not reject placement when Figma render bounds lag behind a root move', async () => {
    const fixture = createFixture()
    figma.viewport.center = { x: 50, y: 50 }
    const first = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="first" class="w-[100px] h-[100px]"></div>'
    })
    const stale = fixture.createNode('FRAME')
    Object.defineProperty(stale, 'absoluteRenderBounds', {
      get: () => ({ x: 0, y: 0, width: stale.width, height: stale.height })
    })
    vi.mocked(figma.createFrame).mockImplementationOnce(() => stale as unknown as FrameNode)

    const second = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="second" class="w-[100px] h-[100px]"></div>'
    })

    expect(fixture.getNode(first.rootNodeId)).toMatchObject({ x: 0, y: 0 })
    expect(fixture.getNode(second.rootNodeId)).toMatchObject({ x: 180, y: 0 })
  })

  it('stabilizes nested fill geometry after height-auto-resizing text reflows', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[620px] p-[20px]">
          <div data-key="home-hero" class="flex flex-col w-full h-[172px] gap-[12px] p-[18px] rounded-[22px] bg-[#1B2733]">
            <span data-key="home-hero/title" class="w-full h-fit text-[24px] leading-[28px] font-semibold text-[#F8EFE6]">A quieter way to listen</span>
            <span data-key="home-hero/body" class="w-full h-fit text-[12px] leading-[18px] text-[#B8C0C2]">Made from your late-night favourites.</span>
          </div>
        </div>
      `
    }

    const created = await applyCanvas(input)
    const hero = fixture.getNode(created.nodeIdsByKey['home-hero']!) as unknown as FrameNode
    const title = fixture.getNode(created.nodeIdsByKey['home-hero/title']!) as unknown as TextNode
    const body = fixture.getNode(created.nodeIdsByKey['home-hero/body']!) as unknown as TextNode

    expect(hero.width).toBe(280)
    expect(title.width).toBe(244)
    expect(body.layoutSizingHorizontal).toBe('FILL')
    expect(body.layoutSizingVertical).toBe('HUG')
    expect(body.textAutoResize).toBe('HEIGHT')
    expect(body.width).toBe(244)

    const updated = await applyCanvas({
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId
    })
    expect(updated.mutationCount).toBe(0)
  })

  it('repairs stale cross-axis fill geometry even when sizing properties already match', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[320px] h-[200px] p-[20px]">
          <div data-key="child" class="w-[80px] h-full max-h-[120px]"></div>
        </div>
      `
    }
    const created = await applyCanvas(input)
    const child = fixture.getNode(created.nodeIdsByKey.child!) as unknown as FrameNode
    expect(child.height).toBe(120)

    child.resize(child.width, 0)
    expect(child.layoutSizingVertical).toBe('FILL')

    const updated = await applyCanvas({
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId
    })
    expect(child.height).toBe(120)
    expect(updated.updatedNodeIds).toContain(child.id)
  })

  it('does not restabilize healthy newly created cross-axis fill geometry', async () => {
    const fixture = createFixture()
    let frameCount = 0
    let childResize: ReturnType<typeof vi.spyOn> | undefined
    vi.mocked(figma.createFrame).mockImplementation(() => {
      const node = fixture.createNode('FRAME')
      frameCount += 1
      if (frameCount === 2) childResize = vi.spyOn(node, 'resize')
      return node as unknown as FrameNode
    })

    await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="child" class="w-full h-[80px]"></div></div>'
    })

    expect(childResize).toHaveBeenCalledTimes(2)
  })

  it('floors stale fill recovery at Figma minimum geometry', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[4px] h-[40px] border-[2px] border-[#000000]"><div data-key="child" class="w-full h-[20px]"></div></div>',
      bindings: { root: { figma: { stroke: { align: 'INSIDE' } } } }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    root.strokeLeftWeight = 2
    root.strokeRightWeight = 2
    const child = fixture.getNode(created.nodeIdsByKey.child!) as unknown as FrameNode
    child.resize(0, child.height)
    const nativeResize = child.resize.bind(child)
    vi.spyOn(child, 'resize').mockImplementation((width, height) => {
      if (width < 0.01) throw new Error('Figma requires width >= 0.01')
      nativeResize(width, height)
    })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ updatedNodeIds: expect.arrayContaining([child.id]) })
    expect(child.width).toBe(0.01)
  })

  it.each([
    ['INSIDE', 126],
    ['CENTER', 128],
    ['OUTSIDE', 128]
  ] as const)(
    'seeds fill geometry using only included inside strokes: %s',
    async (align, height) => {
      const fixture = createFixture()
      const created = await applyCanvas({
        mode: 'create',
        markup: `
        <div data-key="root" class="flex flex-row w-[320px] h-[128px] border border-[#DAD5C9]">
          <div data-key="child" class="w-[128px] h-full"></div>
        </div>
      `,
        bindings: { root: { figma: { stroke: { align } } } }
      })

      expect(fixture.getNode(created.nodeIdsByKey.child!).height).toBe(height)
    }
  )

  it('accepts nonzero Figma-derived fill geometry in a stroked Auto Layout', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[320px] h-[128px] border border-[#DAD5C9]">
          <div data-key="child" class="w-[128px] h-full"></div>
        </div>
      `,
      bindings: { root: { figma: { stroke: { align: 'INSIDE' } } } }
    }
    const created = await applyCanvas(input)
    const child = fixture.getNode(created.nodeIdsByKey.child!) as unknown as FrameNode
    expect(child.height).toBe(126)
    child.resize(child.width, 125)

    const updated = await applyCanvas({
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId
    })

    expect(child.height).toBe(125)
    expect(updated.mutationCount).toBe(0)
  })

  it('rejects the patch when Figma cannot resolve declared fill geometry', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px] p-[20px]">
          <div data-key="child" class="w-full h-[80px]"></div>
        </div>
      `
    }
    const created = await applyCanvas(input)
    const child = fixture.getNode(created.nodeIdsByKey.child!) as unknown as FrameNode
    child.resize(0, child.height)
    vi.spyOn(child, 'resize').mockImplementation(() => undefined)

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('fill geometry does not match')
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('reports declared and applied sizing modes when Figma rejects a sizing change', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <div data-key="child" class="w-[100px] h-[80px]"></div>
        </div>
      `
    })
    const child = fixture.getNode(created.nodeIdsByKey.child!) as unknown as FrameNode
    Object.defineProperty(child, 'layoutSizingHorizontal', {
      get: () => 'FIXED',
      set: () => undefined
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `
          <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
            <div data-key="child" class="w-full h-[80px]"></div>
          </div>
        `
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining(
        'declared horizontal=FILL, vertical=FIXED, grow=false; applied horizontal=FIXED'
      )
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('auto-places a transformed root and updates exact native transforms idempotently', async () => {
    const fixture = createFixture()
    const rootTransform: Transform = [
      [0, 1, 40],
      [-1, 0, 60]
    ]
    const childTransform: Transform = [
      [1, 0.6, 24],
      [0, 0.8, -12]
    ]
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="w-[400px] h-[240px]">
          <div data-key="offset" class="absolute left-[-4px] top-[8px] w-[24px] h-[24px]"></div>
          <div data-key="transformed" class="w-[80px] h-[48px]"></div>
        </div>
      `,
      bindings: {
        root: { figma: { relativeTransform: rootTransform } },
        transformed: { figma: { relativeTransform: childTransform } }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    const offset = fixture.getNode(created.nodeIdsByKey.offset!)
    const transformed = fixture.getNode(created.nodeIdsByKey.transformed!)

    expect(root.relativeTransform).toEqual([
      [0, 1, 300],
      [-1, 0, 280]
    ])
    expect(offset).toMatchObject({ layoutPositioning: 'AUTO', x: -4, y: 8 })
    expect(transformed.relativeTransform).toEqual(childTransform)

    const update = {
      ...input,
      mode: 'update' as const,
      targetNodeId: created.rootNodeId
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 1 })
    expect(root.relativeTransform).toEqual(rootTransform)
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('reconciles Auto Layout transform axes without owning derived translation', async () => {
    const fixture = createFixture()
    const initialTransform: Transform = [
      [1, 0.6, 0],
      [0, 0.8, 0]
    ]
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[400px] h-[240px]">
          <div data-key="child" class="w-[80px] h-[48px]"></div>
          <div data-key="overlay" class="absolute left-[120px] top-[18px] w-[40px] h-[40px]"></div>
        </div>
      `,
      bindings: {
        child: { figma: { relativeTransform: initialTransform } },
        overlay: { figma: { relativeTransform: initialTransform } }
      }
    }

    const created = await applyCanvas(input)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    const overlay = fixture.getNode(created.nodeIdsByKey.overlay!)
    expect(child.relativeTransform).toEqual(initialTransform)
    expect(overlay.relativeTransform).toEqual([
      [1, 0.6, 120],
      [0, 0.8, 18]
    ])

    child.x = 32
    child.y = 18
    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updatedTransform: Transform = [
      [0.8, 0.6, 0],
      [-0.6, 0.8, 0]
    ]
    const update: CanvasResolvedApplyParameters = {
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId,
      bindings: {
        child: { figma: { relativeTransform: updatedTransform } },
        overlay: { figma: { relativeTransform: updatedTransform } }
      }
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 2 })
    expect(child.relativeTransform).toEqual([
      [0.8, 0.6, 32],
      [-0.6, 0.8, 18]
    ])
    expect(overlay.relativeTransform).toEqual([
      [0.8, 0.6, 120],
      [-0.6, 0.8, 18]
    ])
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('reconciles native sections and nested content idempotently', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="review" class="w-[1200px] h-[900px] bg-[#F5F5F5] border-[2px] border-[#CCCCCC] rounded-[24px]">
          <div data-key="screen" class="absolute left-[80px] top-[120px] w-[320px] h-[240px] bg-[#FFFFFF]"></div>
          <div data-key="variants" class="absolute left-[480px] top-[80px] w-[600px] h-[700px]">
            <div data-key="variant" class="absolute left-[40px] top-[80px] w-[320px] h-[240px]"></div>
          </div>
        </div>
      `,
      bindings: {
        review: {
          variables: {
            fill: { key: 'color-key' },
            stroke: { key: 'color-key' },
            visible: { id: 'variable:visible' }
          },
          variableModes: {
            'collection:tokens': 'mode:dark'
          },
          figma: {
            aspectRatioLocked: true,
            locked: true,
            name: 'Review',
            section: { contentsHidden: true }
          }
        },
        variants: {
          figma: {
            name: 'Variants',
            section: {}
          }
        }
      }
    }

    const created = await applyCanvas(input)
    expect(created.createdNodeIds).toHaveLength(4)

    const review = fixture.getNode(created.rootNodeId) as unknown as SectionNode
    const screen = fixture.getNode(created.nodeIdsByKey.screen!)
    const variants = fixture.getNode(created.nodeIdsByKey.variants!) as unknown as SectionNode
    const variant = fixture.getNode(created.nodeIdsByKey.variant!)
    expect(review).toMatchObject({
      name: 'Review',
      sectionContentsHidden: true,
      locked: true,
      width: 1200,
      height: 900,
      x: -100,
      y: -50,
      strokeWeight: 2,
      cornerRadius: 24
    })
    expect(review.targetAspectRatio).toEqual({ x: 1200, y: 900 })
    expect(review.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:dark' })
    expect(review.boundVariables).toMatchObject({
      fills: [{ id: 'variable:color' }],
      strokes: [{ id: 'variable:color' }],
      visible: { id: 'variable:visible' }
    })
    expect(review.children).toEqual([screen, variants])
    expect(screen).toMatchObject({ parent: review, x: 80, y: 120 })
    expect(variants).toMatchObject({
      name: 'Variants',
      parent: review,
      x: 480,
      y: 80,
      sectionContentsHidden: false
    })
    expect(variants.children).toEqual([variant])
    expect(variant).toMatchObject({ parent: variants, x: 40, y: 80 })

    const update = {
      ...input,
      mode: 'update' as const,
      targetNodeId: created.rootNodeId
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })

    await expect(
      applyCanvas({
        ...update,
        bindings: {
          ...input.bindings,
          review: {
            figma: {
              name: 'Review',
              section: { contentsHidden: false }
            }
          }
        }
      })
    ).resolves.toMatchObject({ mutationCount: 1 })
    expect(review.sectionContentsHidden).toBe(false)
  })

  it('reconciles intrinsic groups and boolean operations idempotently', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="icon" class="w-fit h-fit opacity-[0.8] mix-blend-multiply">
          <div data-key="cutout" class="absolute left-[0px] top-[0px] w-fit h-fit bg-[#112233] border-[2px] border-[#445566] rounded-[8px]">
            <div data-key="base" class="absolute left-[0px] top-[0px] w-[120px] h-[120px]"></div>
            <div data-key="hole" class="absolute left-[40px] top-[24px] w-[64px] h-[72px]"></div>
          </div>
          <span data-key="label" class="absolute left-[144px] top-[48px] w-[80px] h-[24px]">Icon</span>
        </div>
      `,
      bindings: {
        icon: {
          figma: {
            group: true,
            effects: [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 2 }]
          }
        },
        cutout: {
          variables: {
            fill: { key: 'color-key' }
          },
          figma: {
            booleanOperation: 'SUBTRACT',
            name: 'Cutout'
          }
        },
        base: { figma: { shape: { type: 'RECTANGLE' } } },
        hole: { figma: { shape: { type: 'ELLIPSE' } } }
      }
    }

    const created = await applyCanvas(input)
    expect(created.createdNodeIds).toHaveLength(5)
    expect(Object.keys(created.nodeIdsByKey)).toEqual(['icon', 'cutout', 'base', 'hole', 'label'])
    expect(figma.subtract).toHaveBeenCalledTimes(1)
    expect(figma.group).toHaveBeenCalledTimes(1)

    const icon = fixture.getNode(created.rootNodeId) as unknown as GroupNode
    const cutout = fixture.getNode(created.nodeIdsByKey.cutout!) as unknown as BooleanOperationNode
    const base = fixture.getNode(created.nodeIdsByKey.base!)
    const hole = fixture.getNode(created.nodeIdsByKey.hole!)
    const label = fixture.getNode(created.nodeIdsByKey.label!)
    expect(icon).toMatchObject({
      type: 'GROUP',
      x: 388,
      y: 340,
      width: 224,
      height: 120,
      opacity: 0.8,
      blendMode: 'MULTIPLY'
    })
    expect(icon.children).toEqual([cutout, label])
    expect(icon.effects).toMatchObject([{ type: 'LAYER_BLUR', radius: 2 }])
    expect(cutout).toMatchObject({
      type: 'BOOLEAN_OPERATION',
      name: 'Cutout',
      booleanOperation: 'SUBTRACT',
      parent: icon,
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      strokeWeight: 2,
      cornerRadius: 8
    })
    expect(cutout.children).toEqual([base, hole])
    expect(base).toMatchObject({ parent: cutout, x: 0, y: 0 })
    expect(hole).toMatchObject({ parent: cutout, x: 40, y: 24 })
    expect(label).toMatchObject({ parent: icon, x: 144, y: 48 })
    expect(cutout.boundVariables).toMatchObject({
      fills: [{ id: 'variable:color' }]
    })

    const update = {
      ...input,
      mode: 'update' as const,
      targetNodeId: created.rootNodeId
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })

    const excluded = {
      ...update,
      bindings: {
        ...input.bindings,
        cutout: {
          ...input.bindings!.cutout,
          figma: {
            booleanOperation: 'EXCLUDE' as const,
            name: 'Cutout'
          }
        }
      }
    }
    await expect(applyCanvas(excluded)).resolves.toMatchObject({ mutationCount: 1 })
    expect(cutout.booleanOperation).toBe('EXCLUDE')
    await expect(applyCanvas(excluded)).resolves.toMatchObject({ mutationCount: 0 })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="icon" class="w-fit h-fit opacity-[0.8] mix-blend-multiply"></div>',
        bindings: {
          icon: { figma: { group: true } }
        }
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(icon.children).toEqual([cutout, label])

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `
          <div data-key="icon" class="w-fit h-fit">
            <div data-key="cutout" class="absolute left-[0px] top-[0px] w-fit h-fit"></div>
            <span data-key="label" class="absolute left-[144px] top-[48px] w-[80px] h-[24px]">Icon</span>
            <div data-key="empty" class="absolute left-[240px] top-[0px] w-fit h-fit"></div>
          </div>
        `,
        bindings: {
          icon: { figma: { group: true } },
          cutout: { figma: { booleanOperation: 'EXCLUDE' } },
          empty: { figma: { group: true } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
    expect(figma.group).toHaveBeenCalledTimes(1)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup:
          '<div data-key="icon" class="w-fit h-fit"><div data-key="cutout" class="absolute left-[0px] top-[0px] w-fit h-fit"></div></div>',
        bindings: {
          icon: { figma: { group: true } },
          cutout: { figma: { booleanOperation: 'EXCLUDE' } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
  })

  it('authors reusable components and variant sets idempotently', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="button-set" class="flex flex-row gap-[24px] p-[24px] w-[480px] h-[160px]">
          <div data-key="default" class="flex flex-row items-center justify-center w-[200px] h-[48px]">
            <span data-key="default-label" class="w-fit h-fit">Continue</span>
          </div>
          <div data-key="hover" class="flex flex-row items-center justify-center w-[200px] h-[48px]">
            <span data-key="hover-label" class="w-fit h-fit">Continue</span>
          </div>
        </div>
      `,
      bindings: {
        'button-set': {
          figma: {
            component: {
              type: 'COMPONENT_SET',
              descriptionMarkdown: '**Button** variants',
              documentationLink: 'https://example.com/button'
            }
          }
        },
        default: {
          figma: {
            name: 'State=Default',
            component: { type: 'COMPONENT' }
          }
        },
        hover: {
          figma: {
            name: 'State=Hover',
            component: { type: 'COMPONENT' }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    expect(created.createdNodeIds).toHaveLength(5)
    expect(Object.keys(created.nodeIdsByKey)).toEqual([
      'button-set',
      'default',
      'default-label',
      'hover',
      'hover-label'
    ])
    expect(figma.createComponent).toHaveBeenCalledTimes(2)
    expect(figma.combineAsVariants).toHaveBeenCalledTimes(1)

    const variants = fixture.getNode(created.rootNodeId) as unknown as ComponentSetNode
    const defaultVariant = fixture.getNode(
      created.nodeIdsByKey.default!
    ) as unknown as ComponentNode
    const hoverVariant = fixture.getNode(created.nodeIdsByKey.hover!) as unknown as ComponentNode
    expect(variants).toMatchObject({
      type: 'COMPONENT_SET',
      x: 260,
      y: 320,
      width: 480,
      height: 160,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 24,
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 24,
      paddingLeft: 24,
      descriptionMarkdown: '**Button** variants',
      documentationLinks: [{ uri: 'https://example.com/button' }]
    })
    expect(variants.children).toEqual([defaultVariant, hoverVariant])
    expect(defaultVariant).toMatchObject({
      parent: variants,
      name: 'State=Default',
      width: 200,
      height: 48,
      layoutMode: 'HORIZONTAL'
    })
    expect(hoverVariant).toMatchObject({
      parent: variants,
      name: 'State=Hover',
      width: 200,
      height: 48,
      layoutMode: 'HORIZONTAL'
    })

    const update = {
      ...input,
      mode: 'update' as const,
      targetNodeId: created.rootNodeId
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: defaultVariant.id,
        markup: `
          <div data-key="default" class="flex flex-row items-center justify-center w-[200px] h-[48px]">
            <span data-key="default-label" class="w-fit h-fit">Proceed</span>
          </div>
        `
      })
    ).resolves.toMatchObject({ mutationCount: 1 })
    expect(fixture.getNode(created.nodeIdsByKey['default-label']!)).toMatchObject({
      characters: 'Proceed'
    })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: defaultVariant.id,
        markup: `
          <div data-key="default" class="flex flex-row items-center justify-center w-[200px] h-[48px]">
            <span data-key="default-label" class="w-fit h-fit">Continue</span>
          </div>
        `
      })
    ).resolves.toMatchObject({ mutationCount: 1 })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: variants.id,
        markup:
          '<div data-key="button-set" class="flex flex-row gap-[24px] p-[24px] w-[480px] h-[160px]"></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    const buttonSetBinding = input.bindings?.['button-set']
    if (!buttonSetBinding) throw new Error('Expected button-set binding')
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup:
          '<div data-key="button-set" class="flex flex-row gap-[24px] p-[24px] w-[480px] h-[160px]"></div>',
        bindings: {
          'button-set': buttonSetBinding
        }
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(variants.children).toEqual([defaultVariant, hoverVariant])

    const metadataUpdate = {
      ...update,
      bindings: {
        ...input.bindings,
        'button-set': {
          figma: {
            component: {
              type: 'COMPONENT_SET' as const,
              descriptionMarkdown: 'Updated variants',
              documentationLink: null
            }
          }
        }
      }
    }
    await expect(applyCanvas(metadataUpdate)).resolves.toMatchObject({ mutationCount: 2 })
    expect(variants.descriptionMarkdown).toBe('Updated variants')
    expect(variants.documentationLinks).toEqual([])
    await expect(applyCanvas(metadataUpdate)).resolves.toMatchObject({ mutationCount: 0 })

    Object.assign(variants, { remote: true })
    await expect(applyCanvas(metadataUpdate)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
  })

  it('finalizes grid layout on a newly authored component set', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="set" class="grid grid-cols-[1fr_160px] grid-rows-1 w-[360px] h-[80px]">
          <div data-key="default" class="w-[160px] h-[48px]"></div>
          <div data-key="hover" class="w-[160px] h-[48px]"></div>
        </div>
      `,
      bindings: {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        default: {
          figma: { name: 'State=Default', component: { type: 'COMPONENT' } }
        },
        hover: {
          figma: { name: 'State=Hover', component: { type: 'COMPONENT' } }
        }
      }
    }

    const created = await applyCanvas(input)
    const set = fixture.getNode(created.rootNodeId) as unknown as ComponentSetNode
    const hover = fixture.getNode(created.nodeIdsByKey.hover!)

    expect(set).toMatchObject({
      layoutMode: 'GRID',
      gridAutoTracks: 'NONE',
      gridItemsPositioning: 'MANUAL',
      gridColumnCount: 2,
      gridRowCount: 1
    })
    expect(set.gridColumnSizes).toEqual([
      { type: 'FLEX', value: 1 },
      { type: 'FIXED', value: 160 }
    ])
    expect(hover).toMatchObject({
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 1
    })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('authors component properties, sublayer references, and native slots idempotently', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="card" class="flex flex-col gap-[12px] p-[16px] w-[320px] h-[240px]">
          <span data-key="title" class="w-fit h-fit">Card title</span>
          <div data-key="icon" class="w-[24px] h-[24px]"></div>
          <div data-key="content" class="flex flex-col grow gap-[8px] p-[12px] w-full h-fit">
            <span data-key="body" class="w-fit h-fit">Default content</span>
          </div>
        </div>
      `,
      bindings: {
        card: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: {
                title: {
                  type: 'TEXT',
                  name: 'Title',
                  defaultValue: { variable: { id: 'variable:component-label' } }
                },
                'show-title': {
                  type: 'BOOLEAN',
                  name: 'Show title',
                  defaultValue: true
                },
                icon: {
                  type: 'INSTANCE_SWAP',
                  name: 'Icon',
                  defaultValue: { id: 'component:1' },
                  preferredValues: [{ type: 'COMPONENT', key: 'component-key' }]
                }
              }
            }
          }
        },
        title: {
          figma: {
            componentPropertyReferences: {
              characters: 'title',
              visible: 'show-title'
            }
          }
        },
        icon: {
          component: { id: 'component:1' },
          figma: {
            componentPropertyReferences: { mainComponent: 'icon' }
          }
        },
        content: {
          figma: {
            slot: {
              property: {
                name: 'Content',
                description: 'Place card content here.',
                preferredValues: [{ type: 'COMPONENT', key: 'component-key' }],
                settings: {
                  stretchChildOnInsert: true,
                  displayEmptyByDefault: false,
                  minChildren: 0,
                  maxChildren: 4,
                  allowPreferredValuesOnly: true
                }
              }
            }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const card = fixture.getNode(created.rootNodeId) as unknown as ComponentNode
    const title = fixture.getNode(created.nodeIdsByKey.title!) as unknown as TextNode
    const icon = fixture.getNode(created.nodeIdsByKey.icon!) as unknown as InstanceNode
    const content = fixture.getNode(created.nodeIdsByKey.content!) as unknown as SlotNode
    const entries = Object.entries(card.componentPropertyDefinitions)
    const propertyName = (displayName: string) =>
      entries.find(([name]) => name.startsWith(`${displayName}#`))?.[0]
    const titleProperty = propertyName('Title')
    const visibleProperty = propertyName('Show title')
    const iconProperty = propertyName('Icon')
    const slotProperty = propertyName('Content')

    expect(card.children).toEqual([title, icon, content])
    expect(content.children).toEqual([fixture.getNode(created.nodeIdsByKey.body!)])
    expect(content).toMatchObject({
      type: 'SLOT',
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12
    })
    expect(card.componentPropertyDefinitions[titleProperty!]).toMatchObject({
      type: 'TEXT',
      boundVariables: {
        defaultValue: { type: 'VARIABLE_ALIAS', id: 'variable:component-label' }
      }
    })
    expect(card.componentPropertyDefinitions[iconProperty!]).toMatchObject({
      type: 'INSTANCE_SWAP',
      defaultValue: 'component:1',
      preferredValues: [{ type: 'COMPONENT', key: 'component-key' }]
    })
    expect(card.componentPropertyDefinitions[slotProperty!]).toMatchObject({
      type: 'SLOT',
      description: 'Place card content here.',
      preferredValues: [{ type: 'COMPONENT', key: 'component-key' }],
      slotSettings: {
        stretchChildOnInsert: true,
        displayEmptyByDefault: false,
        minChildren: 0,
        maxChildren: 4,
        allowPreferredValuesOnly: true
      }
    })
    expect(title.componentPropertyReferences).toEqual({
      characters: titleProperty,
      visible: visibleProperty
    })
    expect(icon.componentPropertyReferences).toEqual({ mainComponent: iconProperty })

    const update = {
      ...input,
      mode: 'update' as const,
      targetNodeId: created.rootNodeId
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(
      applyCanvas({
        ...update,
        bindings: {
          ...input.bindings,
          content: {
            figma: {
              slot: {
                property: {
                  name: 'Content',
                  settings: { minChildren: 5 }
                }
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('cannot exceed maxChildren')
    })

    const changed = {
      ...update,
      bindings: {
        ...input.bindings,
        card: {
          figma: {
            component: {
              type: 'COMPONENT' as const,
              properties: {
                title: {
                  type: 'TEXT' as const,
                  name: 'Label',
                  defaultValue: 'Default label'
                },
                'show-title': {
                  type: 'BOOLEAN' as const,
                  name: 'Show title',
                  defaultValue: false
                },
                icon: {
                  type: 'INSTANCE_SWAP' as const,
                  name: 'Icon',
                  defaultValue: { id: 'component:1' },
                  preferredValues: []
                }
              }
            }
          }
        },
        content: {
          figma: {
            slot: {
              property: {
                name: 'Children',
                description: '',
                preferredValues: [],
                settings: { maxChildren: null }
              }
            }
          }
        }
      }
    } satisfies CanvasResolvedApplyParameters
    await applyCanvas(changed)
    expect(
      Object.entries(card.componentPropertyDefinitions).find(([name]) =>
        name.startsWith('Label#')
      )?.[1]
    ).toMatchObject({
      type: 'TEXT',
      defaultValue: 'Default label'
    })
    expect(
      Object.entries(card.componentPropertyDefinitions).find(([name]) =>
        name.startsWith('Children#')
      )?.[1]
    ).toMatchObject({
      description: '',
      preferredValues: [],
      slotSettings: { maxChildren: null }
    })
    await expect(applyCanvas(changed)).resolves.toMatchObject({ mutationCount: 0 })

    const deleted = {
      ...changed,
      bindings: {
        ...changed.bindings,
        card: {
          figma: {
            component: {
              type: 'COMPONENT' as const,
              properties: { 'show-title': null }
            }
          }
        },
        title: {
          figma: {
            componentPropertyReferences: { visible: null }
          }
        }
      }
    } satisfies CanvasResolvedApplyParameters
    await applyCanvas(deleted)
    expect(
      Object.values(card.componentPropertyDefinitions).some(
        (definition) => definition.type === 'BOOLEAN'
      )
    ).toBe(false)
    expect(title.componentPropertyReferences).toEqual({
      characters: expect.stringMatching(/^Label#/)
    })
    await expect(applyCanvas(deleted)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each([
    {
      name: 'a direct flow child with a sibling',
      markup:
        '<div data-key="nav" class="flex flex-col items-center justify-center w-[108px] h-[56px] gap-[6px]"><span data-key="nav/label" class="w-fit h-fit">Home</span><div data-key="nav/indicator" class="size-[4px]"></div></div>',
      warning: true
    },
    {
      name: 'the only child of a fixed slot',
      markup:
        '<div data-key="nav" class="flex flex-col items-center justify-center w-[108px] h-[56px] gap-[6px]"><span data-key="nav/label" class="w-fit h-fit">Home</span><div data-key="nav/slot" class="flex flex-row items-center justify-center size-[4px]"><div data-key="nav/indicator" class="size-[4px]"></div></div></div>',
      warning: false
    },
    {
      name: 'an absolute child',
      markup:
        '<div data-key="nav" class="flex flex-row items-center justify-center w-[108px] h-[56px]"><span data-key="nav/label" class="w-fit h-fit">Home</span><div data-key="nav/indicator" class="absolute left-[52px] top-[40px] size-[4px]"></div></div>',
      warning: false
    },
    {
      name: 'the only child of a hugging parent',
      markup:
        '<div data-key="nav" class="flex flex-col w-[108px] h-[56px]"><div data-key="nav/hug" class="flex flex-col w-fit h-fit"><div data-key="nav/indicator" class="size-[4px]"></div></div></div>',
      warning: true
    }
  ])('reports whether visibility affects Auto Layout for $name', async (testCase) => {
    createFixture()
    const indicatorKey = 'nav/indicator'
    const result = await applyCanvasFromTool({
      mode: 'create',
      markup: testCase.markup,
      native: {
        nav: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: {
                active: {
                  type: 'BOOLEAN',
                  name: 'Active',
                  defaultValue: true
                }
              }
            }
          }
        },
        [indicatorKey]: {
          figma: {
            componentPropertyReferences: { visible: 'active' }
          }
        }
      }
    })

    expect(result.verification).toMatchObject(
      testCase.warning
        ? {
            status: 'warning',
            warnings: [
              {
                code: 'layout-affecting-visibility-property',
                key: indicatorKey,
                message: expect.stringContaining('move siblings')
              }
            ]
          }
        : { status: 'passed', warnings: [] }
    )
  })

  it('replaces a primitive draft with an instance of a freshly authored component', async () => {
    const fixture = createFixture()
    const draft = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action-draft" class="flex flex-row items-center justify-center w-[160px] h-[48px]"><span data-key="screen/action-draft/label" class="w-fit h-fit">Continue</span></div></div>'
    })
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="button" class="flex flex-row items-center justify-center w-[160px] h-[48px]"><span data-key="button/label" class="w-fit h-fit">Continue</span></div>',
      native: {
        button: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: {
                label: {
                  type: 'TEXT',
                  name: 'Label',
                  defaultValue: 'Continue'
                }
              }
            }
          }
        },
        'button/label': {
          figma: {
            componentPropertyReferences: { characters: 'label' }
          }
        }
      }
    })

    const replaced = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: draft.rootNodeId,
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>',
      native: {
        'screen/action': {
          component: { id: authored.rootNodeId },
          componentProperties: { label: 'Save' }
        }
      },
      removeKeys: ['screen/action-draft']
    })

    const action = fixture.getNode(replaced.nodeIdsByKey['screen/action']!) as InstanceNode
    const mainComponent = await action.getMainComponentAsync()
    expect(mainComponent?.id).toBe(authored.rootNodeId)
    expect(action.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('screen/action')
    expect(Object.values(action.componentProperties)).toContainEqual({
      type: 'TEXT',
      value: 'Save'
    })
    expect((fixture.getNode(draft.rootNodeId) as FrameNode).children).toEqual([action])
  })

  it('creates multiple instances of a freshly authored keyed component', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="track" class="flex flex-row items-center w-[280px] h-[56px]"><span data-key="track/title" class="w-fit h-fit">Track</span></div>',
      native: {
        track: {
          figma: {
            component: { type: 'COMPONENT' }
          }
        }
      }
    })

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px] gap-[8px]"><div data-key="screen/track-1" class="w-[280px] h-[56px]"></div><div data-key="screen/track-2" class="w-[280px] h-[56px]"></div></div>',
      native: {
        'screen/track-1': { component: { id: authored.rootNodeId } },
        'screen/track-2': { component: { id: authored.rootNodeId } }
      }
    })

    const first = fixture.getNode(screen.nodeIdsByKey['screen/track-1']!) as InstanceNode
    const second = fixture.getNode(screen.nodeIdsByKey['screen/track-2']!) as InstanceNode
    expect(first.type).toBe('INSTANCE')
    expect(second.type).toBe('INSTANCE')
    expect(first.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('screen/track-1')
    expect(second.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('screen/track-2')
  })

  it('warns when managed content overflows a clipping parent', async () => {
    createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="button" class="w-[136px] h-[40px]"></div>',
      native: {
        button: { figma: { component: { type: 'COMPONENT' } } }
      }
    })

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="w-[200px] h-[80px]"><div data-key="screen/actions" class="absolute left-[0px] top-[0px] overflow-hidden w-[160px] h-[28px]"><div data-key="screen/send" class="absolute left-[12px] top-[-6px] w-[136px] h-[40px]"></div></div></div>',
      native: {
        'screen/send': { component: { id: authored.rootNodeId } }
      }
    })

    expect(screen.verification).toMatchObject({
      status: 'warning',
      warnings: [
        {
          code: 'managed-content-overflow',
          key: 'screen/send',
          message: expect.stringMatching(
            /screen\/actions.*top 6px, bottom 6px.*clipping is enabled/
          )
        }
      ]
    })
  })

  it('preserves an existing instance in a partial ancestor update', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="track" class="w-[280px] h-[56px]"></div>',
      native: {
        track: { figma: { component: { type: 'COMPONENT' } } }
      }
    })
    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/track" class="w-[280px] h-[56px]"></div></div>',
      native: {
        'screen/track': { component: { id: authored.rootNodeId } }
      }
    })

    const update = {
      mode: 'update' as const,
      targetNodeId: screen.rootNodeId,
      markup:
        '<div data-key="screen" class="flex flex-col w-[340px] h-[200px]"><div data-key="screen/track" class="w-[300px] h-[56px]"></div></div>'
    }
    const updated = await applyCanvasFromTool(update)
    expect(updated).toMatchObject({
      createdNodeIds: [],
      removedNodeIds: [],
      nodeIdsByKey: { 'screen/track': screen.nodeIdsByKey['screen/track'] }
    })
    expect(fixture.getNode(screen.nodeIdsByKey['screen/track']!)).toMatchObject({
      type: 'INSTANCE',
      width: 300
    })
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('creates and selects variants from exact variant and component-set ids', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="set" class="flex flex-row w-[280px] h-[80px]"><div data-key="default" class="w-[120px] h-[40px]"></div><div data-key="active" class="w-[120px] h-[40px]"></div></div>',
      native: {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        default: {
          figma: { name: 'State=Default', component: { type: 'COMPONENT' } }
        },
        active: {
          figma: { name: 'State=Active', component: { type: 'COMPONENT' } }
        }
      }
    })
    const variant = fixture.getNode(authored.nodeIdsByKey.default!) as ComponentNode
    const active = fixture.getNode(authored.nodeIdsByKey.active!) as ComponentNode
    const componentSet = fixture.getNode(authored.rootNodeId) as unknown as ComponentSetNode
    Object.assign(componentSet.componentPropertyDefinitions, {
      State: {
        type: 'VARIANT',
        defaultValue: 'Default',
        variantOptions: ['Default', 'Active']
      }
    })
    Object.defineProperty(variant, 'componentPropertyDefinitions', {
      configurable: true,
      get: () => {
        throw new Error('Variant definitions belong to the component set')
      }
    })

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/direct" class="w-[120px] h-[40px]"></div><div data-key="screen/default" class="w-[120px] h-[40px]"></div><div data-key="screen/active" class="w-[120px] h-[40px]"></div></div>',
      native: {
        'screen/direct': { component: { id: variant.id } },
        'screen/default': { component: { id: authored.rootNodeId } },
        'screen/active': {
          component: { id: authored.rootNodeId },
          componentProperties: { State: 'Active' }
        }
      }
    })

    const direct = fixture.getNode(screen.nodeIdsByKey['screen/direct']!) as InstanceNode
    const fromSet = fixture.getNode(screen.nodeIdsByKey['screen/default']!) as InstanceNode
    const selected = fixture.getNode(screen.nodeIdsByKey['screen/active']!) as InstanceNode
    expect((await direct.getMainComponentAsync())?.id).toBe(variant.id)
    expect((await fromSet.getMainComponentAsync())?.id).toBe(variant.id)
    expect((await selected.getMainComponentAsync())?.id).toBe(active.id)
  })

  it('claims instance ownership when its key matches the inherited definition key', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="track" class="w-[280px] h-[56px]"></div>',
      native: {
        track: { figma: { component: { type: 'COMPONENT' } } }
      }
    })

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="track" class="w-[280px] h-[56px]"></div></div>',
      native: {
        track: { component: { id: authored.rootNodeId } }
      }
    })

    const instance = fixture.getNode(screen.nodeIdsByKey.track!) as InstanceNode
    expect(instance.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('track')
    expect(instance.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(instance.id)
  })

  it('resolves an exact component id through the async dynamic-page lookup', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="button" class="w-[160px] h-[48px]"></div>',
      native: {
        button: { figma: { component: { type: 'COMPONENT' } } }
      }
    })
    vi.mocked(figma.getNodeById).mockImplementation((id: string) =>
      id === authored.rootNodeId ? null : (fixture.nodes.get(id) ?? null)
    )

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>',
      native: {
        'screen/action': { component: { id: authored.rootNodeId } }
      }
    })

    expect(fixture.getNode(screen.nodeIdsByKey['screen/action']!).type).toBe('INSTANCE')
  })

  it('resolves update targets and adopted descendants through async dynamic-page lookups', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const adopted = fixture.createNode('FRAME')
    root.appendChild(adopted)
    vi.mocked(figma.getNodeById).mockImplementation((id: string) =>
      id === created.rootNodeId || id === adopted.id ? null : (fixture.nodes.get(id) ?? null)
    )

    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/adopted" data-node-id="${adopted.id}" class="w-[100px] h-[100px]"></div></div>`
    })

    expect(updated.nodeIdsByKey['screen/adopted']).toBe(adopted.id)
  })

  it('falls back to the synchronous current-page lookup when the async backend is unavailable', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"></div>'
    })
    vi.mocked(figma.getNodeByIdAsync).mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'getNodeByIdAsync')")
    )

    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/child" class="w-[100px] h-[80px]"></div></div>'
    })

    expect(fixture.getNode(updated.nodeIdsByKey['screen/child']!).type).toBe('FRAME')
  })

  it('makes newly added frames transparent when update markup omits a background', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"></div>'
    })

    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/overlay" class="w-[120px] h-[80px]"></div></div>'
    })

    const overlay = fixture.getNode(updated.nodeIdsByKey['screen/overlay']!) as FrameNode
    expect(overlay.fills).toEqual([])
  })

  it.each([
    [
      'a component property with the wrong variable type',
      {
        mode: 'create',
        markup: '<div data-key="card" class="w-[320px] h-[240px]"></div>',
        bindings: {
          card: {
            figma: {
              component: {
                type: 'COMPONENT',
                properties: {
                  title: {
                    type: 'TEXT',
                    name: 'Title',
                    defaultValue: { variable: { id: 'variable:spacing' } }
                  }
                }
              }
            }
          }
        }
      },
      'expected STRING'
    ],
    [
      'an unknown component property reference',
      {
        mode: 'create',
        markup:
          '<div data-key="card" class="flex flex-col w-[320px] h-[240px]"><span data-key="title" class="w-fit h-fit">Title</span></div>',
        bindings: {
          card: { figma: { component: { type: 'COMPONENT' } } },
          title: {
            figma: {
              componentPropertyReferences: { characters: 'missing' }
            }
          }
        }
      },
      'is missing, expected TEXT'
    ],
    [
      'override preservation controlled by a component property reference',
      {
        mode: 'create',
        markup:
          '<div data-key="card" class="flex flex-row w-[320px] h-[240px]"><div data-key="icon" class="w-[24px] h-[24px]"></div></div>',
        bindings: {
          card: {
            figma: {
              component: {
                type: 'COMPONENT',
                properties: {
                  icon: {
                    type: 'INSTANCE_SWAP',
                    name: 'Icon',
                    defaultValue: { id: 'component:1' }
                  }
                }
              }
            }
          },
          icon: {
            component: { id: 'component:1' },
            figma: {
              instance: { preserveOverrides: false },
              componentPropertyReferences: { mainComponent: 'icon' }
            }
          }
        }
      },
      'cannot be combined with a mainComponent property reference'
    ],
    [
      'a slot without property metadata',
      {
        mode: 'create',
        markup:
          '<div data-key="card" class="flex flex-col w-[320px] h-[240px]"><div data-key="content" class="w-full h-[100px]"></div></div>',
        bindings: {
          card: { figma: { component: { type: 'COMPONENT' } } },
          content: { figma: { slot: {} } }
        }
      },
      'requires property metadata'
    ],
    [
      'component properties declared on a variant',
      {
        mode: 'create',
        markup:
          '<div data-key="set" class="flex flex-row w-[320px] h-[240px]"><div data-key="variant" class="w-[100px] h-[40px]"></div></div>',
        bindings: {
          set: { figma: { component: { type: 'COMPONENT_SET' } } },
          variant: {
            figma: {
              component: {
                type: 'COMPONENT',
                properties: {
                  label: {
                    type: 'TEXT',
                    name: 'Label',
                    defaultValue: 'Label'
                  }
                }
              }
            }
          }
        }
      },
      'belong on its component set'
    ]
  ])('preflights %s before applying', async (_name, input, message) => {
    const fixture = createFixture()
    await expect(applyCanvas(input as CanvasResolvedApplyParameters)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining(message)
    })
    expect(PAGE.children).toEqual([])
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('stages new variants on the page containing their destination', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[400px] h-[240px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId)
    const otherPage = createMockPage('0:2', 'Page 2')
    otherPage.appendChild(root)

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: root.id,
      markup: `
        <div data-key="root" class="w-[400px] h-[240px]">
          <div data-key="set" class="absolute left-[24px] top-[24px] flex flex-row w-[200px] h-[80px]">
            <div data-key="variant" class="w-[120px] h-[40px]"></div>
          </div>
        </div>
      `,
      bindings: {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        variant: {
          figma: {
            name: 'State=Default',
            component: { type: 'COMPONENT' }
          }
        }
      }
    })

    const set = fixture.getNode(updated.nodeIdsByKey.set!)
    const variant = fixture.getNode(updated.nodeIdsByKey.variant!)
    expect(root.parent).toBe(otherPage)
    expect(set.parent).toBe(root)
    expect(variant.parent).toBe(set)
    expect(figma.combineAsVariants).toHaveBeenCalledWith([variant], root, 0)
  })

  it('reconciles variable-bound component properties and scale-tool state idempotently', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[240px] h-[120px]">
          <div data-key="action" class="w-[80px] h-[40px]"></div>
        </div>
      `,
      bindings: {
        action: {
          component: { id: 'component:1' },
          componentProperties: {
            Label: { variable: { id: 'variable:component-label' } },
            State: 'Hover',
            Icon: 'component:1'
          },
          figma: { instance: { scaleFactor: 1.5 } }
        }
      }
    }

    const created = await applyCanvas(input)
    const action = fixture.getNode(created.nodeIdsByKey.action!) as unknown as InstanceNode
    expect(action.scaleFactor).toBe(1.5)
    expect(action.width).toBe(80)
    expect(action.height).toBe(40)
    expect(action.componentProperties.Label?.boundVariables?.value?.id).toBe(
      'variable:component-label'
    )
    expect(action.componentProperties.State?.value).toBe('Hover')
    expect(action.setProperties).toHaveBeenCalledTimes(1)

    const update = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId }
    expect((await applyCanvas(update)).mutationCount).toBe(0)
    expect(action.setProperties).toHaveBeenCalledTimes(1)

    const direct = {
      ...update,
      bindings: {
        action: {
          ...input.bindings!.action,
          componentProperties: {
            Label: 'Default',
            State: 'Hover',
            Icon: 'component:1'
          }
        }
      }
    }
    await applyCanvas(direct)
    expect(action.componentProperties.Label?.value).toBe('Default')
    expect(action.componentProperties.Label?.boundVariables).toBeUndefined()
    expect(action.setProperties).toHaveBeenCalledTimes(2)
    expect((await applyCanvas(direct)).mutationCount).toBe(0)
  })

  it('updates existing instance state without repeating its component reference', async () => {
    const fixture = createFixture()
    const actionMarkup = '<div data-key="screen/action" class="w-[120px] h-[40px]"></div>'
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: `<div data-key="screen" class="flex flex-col w-[240px] h-[120px]">${actionMarkup}</div>`,
      native: {
        'screen/action': {
          component: { id: 'component:1' },
          componentProperties: { Label: 'Default' }
        }
      }
    })
    const action = fixture.getNode(
      created.nodeIdsByKey['screen/action']!
    ) as unknown as InstanceNode
    const originalComponent = await action.getMainComponentAsync()
    const update = {
      mode: 'update' as const,
      targetNodeId: action.id,
      markup: actionMarkup,
      native: {
        'screen/action': {
          componentProperties: { Label: 'Save' },
          figma: { instance: { scaleFactor: 1.25 } }
        }
      }
    }

    const updated = await applyCanvasFromTool(update)

    expect(updated.createdNodeIds).toEqual([])
    expect(updated.removedNodeIds).toEqual([])
    expect(action.componentProperties.Label?.value).toBe('Save')
    expect(action.scaleFactor).toBe(1.25)
    expect((await action.getMainComponentAsync())?.id).toBe(originalComponent?.id)
    expect((await applyCanvasFromTool(update)).mutationCount).toBe(0)
  })

  it('chooses whether a component replacement preserves existing overrides', async () => {
    const fixture = createFixture()
    const original = fixture.nodes.get('component:1') as ComponentNode
    const replacement = {
      ...original,
      id: 'component:2',
      key: 'component-key-2'
    } as ComponentNode
    fixture.nodes.set(replacement.id, replacement)

    const markup =
      '<div data-key="root" class="flex flex-row w-[240px] h-[120px]"><div data-key="action" class="w-[80px] h-[40px]"></div></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      bindings: {
        action: { component: { id: original.id } }
      }
    })
    const action = fixture.getNode(created.nodeIdsByKey.action!) as InstanceNode
    const overrides = action.overrides as Array<{
      id: string
      overriddenFields: NodeChangeProperty[]
    }>
    overrides.push({ id: action.id, overriddenFields: ['characters'] })

    const preserving: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      bindings: {
        action: { component: { id: replacement.id } }
      }
    }
    await applyCanvas(preserving)
    expect(action.swapComponent).toHaveBeenCalledWith(replacement)
    expect(action.overrides).toHaveLength(1)
    await expect(applyCanvas(preserving)).resolves.toMatchObject({ mutationCount: 0 })

    const clearing: CanvasResolvedApplyParameters = {
      ...preserving,
      bindings: {
        action: {
          component: { id: original.id },
          figma: { instance: { preserveOverrides: false } }
        }
      }
    }
    await applyCanvas(clearing)
    expect(await action.getMainComponentAsync()).toBe(original)
    expect(action.overrides).toEqual([])
    expect(action.swapComponent).toHaveBeenCalledTimes(1)
    await expect(applyCanvas(clearing)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('updates an existing primary nested instance as the declarative root', async () => {
    const fixture = createFixture()
    const component = fixture.nodes.get('component:1') as ComponentNode
    const primary = component.createInstance()
    const mutablePrimary = primary as unknown as MutableNode
    mutablePrimary.parent = component
    const input: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: primary.id,
      markup: '<div data-key="nested-icon" class="w-[100px] h-[100px]"></div>',
      bindings: {
        'nested-icon': {
          component: { id: component.id },
          figma: { instance: { exposed: true } }
        }
      }
    }

    const result = await applyCanvas(input)
    expect(result.rootNodeId).toBe(primary.id)
    expect(primary.isExposedInstance).toBe(true)
    expect((await applyCanvas(input)).mutationCount).toBe(0)

    const pageInstance = component.createInstance()
    await expect(
      applyCanvas({
        ...input,
        targetNodeId: pageInstance.id,
        bindings: {
          'nested-icon': {
            component: { id: component.id },
            figma: { instance: { exposed: true } }
          }
        }
      })
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC })
    expect(pageInstance.isExposedInstance).toBe(false)
  })

  it.each([
    ['unknown property', { Missing: 'value' }],
    ['slot property', { Content: 'value' }],
    ['wrong literal type', { Disabled: 'false' }],
    ['unknown variant', { State: 'Pressed' }],
    ['invalid instance swap', { Icon: 'missing:component' }],
    ['missing variable', { Label: { variable: { id: 'variable:missing-component-label' } } }],
    ['wrong variable type', { Label: { variable: { id: 'variable:spacing' } } }],
    ['variable-bound variant', { State: { variable: { id: 'variable:component-label' } } }],
    ['variable-bound instance swap', { Icon: { variable: { id: 'variable:component-label' } } }]
  ])('preflights invalid component properties: %s', async (_name, componentProperties) => {
    createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-row w-[240px] h-[120px]"><div data-key="action" class="w-[80px] h-[40px]"></div></div>',
        bindings: {
          action: {
            component: { id: 'component:1' },
            componentProperties
          }
        }
      })
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('normalizes rejected component imports as invalid desired state', async () => {
    const fixture = createFixture()
    fixture.importComponentByKeyAsync.mockRejectedValueOnce(new Error('library unavailable'))

    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-row w-[240px] h-[120px]"><div data-key="action" class="w-[80px] h-[40px]"></div></div>',
        bindings: {
          action: { component: { key: 'missing-library-component' } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('could not be imported')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('creates and incrementally reconciles all native basic shape nodes', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[400px] h-[400px]">
          <div data-key="rectangle" class="w-[80px] h-[40px] bg-[#FF0000] border-[2px] border-[#000000] rounded-[8px]"></div>
          <div data-key="line" class="w-[120px] h-[0px] border-[3px]"></div>
          <div data-key="ellipse" class="w-[80px] h-[80px]"></div>
          <div data-key="polygon" class="w-[80px] h-[80px] bg-[#00FF00]"></div>
          <div data-key="star" class="w-[80px] h-[80px] bg-[#0000FF]"></div>
        </div>
      `,
      bindings: {
        rectangle: {
          variables: {
            fill: { key: 'color-key' },
            stroke: { key: 'color-key' },
            cornerRadius: { id: 'variable:spacing' }
          },
          figma: { shape: { type: 'RECTANGLE' } }
        },
        line: {
          styles: { stroke: { id: 'style:stroke' } },
          figma: { shape: { type: 'LINE' } }
        },
        ellipse: {
          styles: { fill: { id: 'style:fill' }, effect: { id: 'style:effect' } },
          figma: {
            shape: {
              type: 'ELLIPSE',
              arc: { startAngle: -45, endAngle: 270, innerRadius: 0.5 }
            }
          }
        },
        polygon: {
          figma: { shape: { type: 'POLYGON', pointCount: 6 } }
        },
        star: {
          figma: { shape: { type: 'STAR', pointCount: 7, innerRadius: 0.6 } }
        }
      }
    }

    const created = await applyCanvas(input)
    expect(created.createdNodeIds).toHaveLength(6)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    expect(root.children.map((node) => node.type)).toEqual([
      'RECTANGLE',
      'LINE',
      'ELLIPSE',
      'POLYGON',
      'STAR'
    ])

    const rectangle = fixture.getNode(created.nodeIdsByKey.rectangle ?? '')
    const line = fixture.getNode(created.nodeIdsByKey.line ?? '')
    const ellipse = fixture.getNode(created.nodeIdsByKey.ellipse ?? '') as unknown as EllipseNode
    const polygon = fixture.getNode(created.nodeIdsByKey.polygon ?? '') as unknown as PolygonNode
    const star = fixture.getNode(created.nodeIdsByKey.star ?? '') as unknown as StarNode

    expect(rectangle).toMatchObject({
      width: 80,
      height: 40,
      strokeWeight: 2,
      boundVariables: {
        fills: [{ id: 'variable:color' }],
        strokes: [{ id: 'variable:color' }],
        topLeftRadius: { id: 'variable:spacing' },
        topRightRadius: { id: 'variable:spacing' },
        bottomLeftRadius: { id: 'variable:spacing' },
        bottomRightRadius: { id: 'variable:spacing' }
      }
    })
    expect(line).toMatchObject({
      width: 120,
      height: 0,
      strokeStyleId: 'style:stroke',
      strokeWeight: 3
    })
    expect(ellipse).toMatchObject({
      arcData: {
        startingAngle: -Math.PI / 4,
        endingAngle: (Math.PI * 3) / 2,
        innerRadius: 0.5
      },
      fillStyleId: 'style:fill',
      effectStyleId: 'style:effect'
    })
    expect(polygon.pointCount).toBe(6)
    expect(star).toMatchObject({ pointCount: 7, innerRadius: 0.6 })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId,
      bindings: {
        ...input.bindings,
        ellipse: {
          ...input.bindings!.ellipse,
          figma: {
            shape: {
              type: 'ELLIPSE',
              arc: { startAngle: 0, endAngle: 180, innerRadius: 0 }
            }
          }
        },
        polygon: {
          figma: { shape: { type: 'POLYGON', pointCount: 8 } }
        },
        star: {
          figma: { shape: { type: 'STAR', pointCount: 9, innerRadius: 1 } }
        }
      }
    }
    await applyCanvas(updated)
    expect(ellipse.arcData).toEqual({
      startingAngle: 0,
      endingAngle: Math.PI,
      innerRadius: 0
    })
    expect(polygon.pointCount).toBe(8)
    expect(star).toMatchObject({ pointCount: 9, innerRadius: 1 })
    await expect(applyCanvas(updated)).resolves.toMatchObject({ mutationCount: 0 })

    const preservingGeometry: CanvasResolvedApplyParameters = {
      ...updated,
      bindings: {
        ...updated.bindings,
        ellipse: {
          ...input.bindings!.ellipse,
          figma: { shape: { type: 'ELLIPSE' } }
        },
        polygon: { figma: { shape: { type: 'POLYGON' } } },
        star: { figma: { shape: { type: 'STAR' } } }
      }
    }
    await expect(applyCanvas(preservingGeometry)).resolves.toMatchObject({
      mutationCount: 0
    })
    expect(ellipse.arcData.endingAngle).toBe(Math.PI)
    expect(polygon.pointCount).toBe(8)
    expect(star).toMatchObject({ pointCount: 9, innerRadius: 1 })

    await expect(
      applyCanvas({
        ...preservingGeometry,
        bindings: {
          ...preservingGeometry.bindings,
          polygon: { figma: { shape: { type: 'STAR' } } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expects STAR')
    })
  })

  it('creates and reconciles native vector paths and complete vector networks', async () => {
    const fixture = createFixture()
    const markup =
      '<div data-key="root" class="flex flex-row w-[100px] h-[100px]"><div data-key="icon" class="w-[24px] h-[24px] bg-[#336699]"></div></div>'
    const paths: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup,
      bindings: {
        icon: {
          figma: {
            shape: {
              type: 'VECTOR',
              paths: [{ windingRule: 'EVENODD', data: 'M 0 0 Q 3 3 6 0 Z' }],
              handleMirroring: 'ANGLE'
            }
          }
        }
      }
    }
    const created = await applyCanvas(paths)
    const icon = fixture.getNode(created.nodeIdsByKey.icon ?? '') as unknown as VectorNode

    expect(icon).toMatchObject({
      type: 'VECTOR',
      width: 24,
      height: 24,
      handleMirroring: 'ANGLE',
      vectorPaths: [
        {
          windingRule: 'EVENODD',
          data: 'M 0 0 C 2 2 4 2 6 0 Z'
        }
      ]
    })
    await expect(
      applyCanvas({ ...paths, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const preserving: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      bindings: {
        icon: {
          figma: { shape: { type: 'VECTOR' } }
        }
      }
    }
    await expect(applyCanvas(preserving)).resolves.toMatchObject({ mutationCount: 0 })
    expect(icon.vectorPaths[0]?.data).toBe('M 0 0 C 2 2 4 2 6 0 Z')

    icon.vectorPaths = [{ windingRule: 'EVENODD', data: 'm 0 0 l 6 0 z' }]
    const repaired = await applyCanvas({
      ...paths,
      mode: 'update',
      targetNodeId: created.rootNodeId
    })
    expect(repaired.mutationCount).toBeGreaterThan(0)
    expect(icon.vectorPaths[0]?.data).toBe('M 0 0 C 2 2 4 2 6 0 Z')

    const clearedPaths: CanvasResolvedApplyParameters = {
      ...preserving,
      bindings: {
        icon: {
          figma: { shape: { type: 'VECTOR', paths: [] } }
        }
      }
    }
    await applyCanvas(clearedPaths)
    expect(icon.vectorPaths).toEqual([])
    await expect(applyCanvas(clearedPaths)).resolves.toMatchObject({ mutationCount: 0 })

    const network: CanvasResolvedApplyParameters = {
      ...preserving,
      bindings: {
        icon: {
          figma: {
            shape: {
              type: 'VECTOR',
              network: {
                vertices: [
                  { x: 0, y: 24 },
                  { x: 24, y: 24 },
                  { x: 12, y: 0 }
                ],
                segments: [
                  { start: 0, end: 1 },
                  { start: 1, end: 2 },
                  { start: 2, end: 0 }
                ],
                regions: [
                  {
                    windingRule: 'NONZERO',
                    loops: [[0, 1, 2]],
                    fillStyle: { id: 'style:fill' }
                  }
                ]
              },
              handleMirroring: 'ANGLE_AND_LENGTH'
            }
          }
        }
      }
    }
    await applyCanvas(network)
    expect(icon).toMatchObject({
      width: 24,
      height: 24,
      handleMirroring: 'ANGLE_AND_LENGTH',
      vectorNetwork: {
        vertices: [
          { x: 0, y: 24 },
          { x: 24, y: 24 },
          { x: 12, y: 0 }
        ],
        segments: [
          { start: 0, end: 1 },
          { start: 1, end: 2 },
          { start: 2, end: 0 }
        ],
        regions: [
          {
            windingRule: 'NONZERO',
            loops: [[0, 1, 2]],
            fillStyleId: 'style:fill'
          }
        ]
      }
    })
    await expect(applyCanvas(network)).resolves.toMatchObject({ mutationCount: 0 })

    const cleared: CanvasResolvedApplyParameters = {
      ...network,
      bindings: {
        icon: {
          figma: {
            shape: {
              type: 'VECTOR',
              network: { vertices: [], segments: [] }
            }
          }
        }
      }
    }
    await applyCanvas(cleared)
    expect(icon).toMatchObject({
      width: 24,
      height: 24,
      vectorNetwork: { vertices: [], segments: [], regions: [] }
    })
    await expect(applyCanvas(cleared)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each([
    {
      shape: { type: 'VECTOR' as const },
      message: 'requires at least one path or network vertex'
    },
    {
      shape: {
        type: 'VECTOR' as const,
        paths: [{ windingRule: 'NONE' as const, data: 'm 0 0 l 1 1' }]
      },
      message: 'Unsupported vector path command'
    },
    {
      shape: {
        type: 'VECTOR' as const,
        network: {
          vertices: [{ x: 0, y: 0 }],
          segments: [{ start: 0, end: 0 }],
          regions: [
            {
              windingRule: 'NONZERO' as const,
              loops: [[0]],
              fillStyle: { id: 'style:text' }
            }
          ]
        }
      },
      message: 'expected PAINT'
    }
  ])('rejects invalid vector authoring before mutation: $message', async ({ shape, message }) => {
    createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-row w-[100px] h-[100px]"><div data-key="icon" class="w-[24px] h-[24px]"></div></div>',
        bindings: {
          icon: {
            figma: { shape }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining(message)
    })
    expect(figma.createVector).not.toHaveBeenCalled()
  })

  it('reconciles native stroke and corner geometry without repeating unchanged writes', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div
          data-key="root"
          class="w-[320px] h-[200px] border-[2px] border-t-[1px] border-l-[4px] border-[#112233] rounded-[8px] rounded-br-[16px]"
        ></div>
      `,
      bindings: {
        root: {
          figma: {
            stroke: {
              align: 'OUTSIDE',
              cap: 'ARROW_LINES',
              join: 'BEVEL',
              miterLimit: 6,
              dashPattern: [8, 4]
            },
            corners: { smoothing: 0.75 }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    expect(root).toMatchObject({
      strokeTopWeight: 1,
      strokeRightWeight: 2,
      strokeBottomWeight: 2,
      strokeLeftWeight: 4,
      strokeAlign: 'OUTSIDE',
      strokeCap: 'ARROW_LINES',
      strokeJoin: 'BEVEL',
      strokeMiterLimit: 6,
      dashPattern: [8, 4],
      topLeftRadius: 8,
      topRightRadius: 8,
      bottomRightRadius: 16,
      bottomLeftRadius: 8,
      cornerSmoothing: 0.75
    })

    const unchanged = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId }
    await expect(applyCanvas(unchanged)).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div
          data-key="root"
          class="w-[320px] h-[200px] border-[3px] border-r-[5px] border-[#112233] rounded-[10px] rounded-tl-[20px]"
        ></div>
      `,
      bindings: {
        root: {
          figma: {
            stroke: {
              align: 'INSIDE',
              cap: 'CIRCLE_FILLED',
              join: 'ROUND',
              miterLimit: 2,
              dashPattern: []
            },
            corners: { smoothing: 0 }
          }
        }
      }
    }
    await applyCanvas(updated)
    expect(root).toMatchObject({
      strokeTopWeight: 3,
      strokeRightWeight: 5,
      strokeBottomWeight: 3,
      strokeLeftWeight: 3,
      strokeAlign: 'INSIDE',
      strokeCap: 'CIRCLE_FILLED',
      strokeJoin: 'ROUND',
      strokeMiterLimit: 2,
      dashPattern: [],
      topLeftRadius: 20,
      topRightRadius: 10,
      bottomRightRadius: 10,
      bottomLeftRadius: 10,
      cornerSmoothing: 0
    })
    await expect(applyCanvas(updated)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('binds every stroke and corner variable field and preserves bound geometry', async () => {
    const fixture = createFixture()
    const sideVariables = {
      strokeTopWeight: { id: 'variable:spacing' },
      strokeRightWeight: { id: 'variable:spacing' },
      strokeBottomWeight: { id: 'variable:spacing' },
      strokeLeftWeight: { id: 'variable:spacing' },
      topLeftRadius: { id: 'variable:spacing' },
      topRightRadius: { id: 'variable:spacing' },
      bottomRightRadius: { id: 'variable:spacing' },
      bottomLeftRadius: { id: 'variable:spacing' }
    } as const
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px] border border-[#112233] rounded-[4px]">
          <div data-key="shape" class="w-[80px] h-[48px] border-[2px] border-[#445566] rounded-[8px]"></div>
        </div>
      `,
      bindings: {
        root: {
          variables: {
            strokeWeight: { id: 'variable:spacing' },
            cornerRadius: { id: 'variable:spacing' }
          }
        },
        shape: {
          variables: sideVariables,
          figma: { shape: { type: 'RECTANGLE' } }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    const shape = fixture.getNode(created.nodeIdsByKey.shape ?? '')
    expect(root.boundVariables).toMatchObject({
      strokeWeight: { id: 'variable:spacing' },
      topLeftRadius: { id: 'variable:spacing' },
      topRightRadius: { id: 'variable:spacing' },
      bottomRightRadius: { id: 'variable:spacing' },
      bottomLeftRadius: { id: 'variable:spacing' }
    })
    expect(shape.boundVariables).toMatchObject(
      Object.fromEntries(
        Object.keys(sideVariables).map((field) => [field, { id: 'variable:spacing' }])
      )
    )

    const preserving: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px] border-[9px] border-[#112233] rounded-[20px]">
          <div data-key="shape" class="w-[80px] h-[48px] border-[9px] border-[#445566] rounded-[20px]"></div>
        </div>
      `,
      bindings: {
        shape: { figma: { shape: { type: 'RECTANGLE' } } }
      }
    }
    await expect(applyCanvas(preserving)).resolves.toMatchObject({ mutationCount: 0 })
    expect(root).toMatchObject({ strokeWeight: 1, cornerRadius: 0 })
    expect(shape).toMatchObject({
      strokeTopWeight: 1,
      strokeRightWeight: 1,
      strokeBottomWeight: 1,
      strokeLeftWeight: 1,
      topLeftRadius: 0,
      topRightRadius: 0,
      bottomRightRadius: 0,
      bottomLeftRadius: 0
    })
  })

  it('applies, preserves, and explicitly unlinks native styles without flattening', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px] border-[2px]">
          <span data-key="title" class="w-full h-fit font-normal text-[12px] leading-[16px] uppercase line-through">Title</span>
        </div>
      `,
      bindings: {
        root: {
          styles: {
            fill: { id: 'style:fill' },
            stroke: { key: 'stroke-style-key' },
            effect: { id: 'style:effect' },
            grid: { id: 'style:grid' }
          }
        },
        title: {
          styles: {
            fill: { id: 'style:fill' },
            stroke: { id: 'style:stroke' },
            text: { id: 'style:text' }
          },
          figma: { text: { paragraphIndent: 12 } }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const title = fixture.getNode(created.nodeIdsByKey.title ?? '') as unknown as TextNode

    expect(root.fillStyleId).toBe('style:fill')
    expect((root.fills as readonly Paint[])[0]?.type).toBe('GRADIENT_LINEAR')
    expect(root.strokeStyleId).toBe('style:stroke')
    expect(root.strokeWeight).toBe(2)
    expect(root.effectStyleId).toBe('style:effect')
    expect(root.gridStyleId).toBe('style:grid')
    expect(title.fillStyleId).toBe('style:fill')
    expect(title.strokeStyleId).toBe('style:stroke')
    expect(title.strokeWeight).toBe(1)
    expect(title.textStyleId).toBe('style:text')
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Bold' })
    expect(title.fontSize).toBe(24)
    expect(title.textCase).toBe('TITLE')
    expect(title.textDecoration).toBe('UNDERLINE')
    expect(title.paragraphIndent).toBe(12)
    expect(title.paragraphSpacing).toBe(20)
    expect(fixture.importStyleByKeyAsync).toHaveBeenCalledWith('stroke-style-key')
    expect(fixture.loadFontAsync).toHaveBeenCalledTimes(1)

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `
          <div data-key="root" class="flex flex-col w-[320px] h-[200px] bg-[#FFFFFF] border-[2px] border-[#000000]">
            <span data-key="title" class="w-full h-fit font-normal text-[12px] leading-[16px] text-[#000000]">Title</span>
          </div>
        `
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(root.fillStyleId).toBe('style:fill')
    expect(root.strokeStyleId).toBe('style:stroke')
    expect(title.fillStyleId).toBe('style:fill')
    expect(title.strokeStyleId).toBe('style:stroke')
    expect(title.textStyleId).toBe('style:text')

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="flex flex-col w-[320px] h-[200px] border-[3px]"></div>'
      })
    ).resolves.toMatchObject({
      mutationCount: 1,
      updatedNodeIds: [created.rootNodeId]
    })
    expect(root.strokeWeight).toBe(3)
    expect(root.strokeStyleId).toBe('style:stroke')

    const detached: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="title" class="w-full h-fit">Title</span>
        </div>
      `,
      bindings: {
        root: {
          styles: {
            fill: null,
            stroke: null,
            effect: null,
            grid: null
          }
        },
        title: {
          styles: {
            fill: null,
            stroke: null,
            text: null
          }
        }
      }
    }
    fixture.loadFontAsync.mockClear()
    await applyCanvas(detached)
    expect(fixture.loadFontAsync.mock.calls).toEqual([[{ family: 'Inter', style: 'Bold' }]])
    expect(root.fillStyleId).toBe('')
    expect((root.fills as readonly Paint[])[0]?.type).toBe('GRADIENT_LINEAR')
    expect(root.strokeStyleId).toBe('')
    expect(root.effectStyleId).toBe('')
    expect(root.effects).toHaveLength(1)
    expect(root.gridStyleId).toBe('')
    expect(root.layoutGrids).toHaveLength(1)
    expect(title.fillStyleId).toBe('')
    expect((title.fills as readonly Paint[])[0]?.type).toBe('GRADIENT_LINEAR')
    expect(title.strokeStyleId).toBe('')
    expect(title.textStyleId).toBe('')
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Bold' })
    expect(title.fontSize).toBe(24)
    expect(title.lineHeight).toEqual({ unit: 'PIXELS', value: 32 })
    expect(title.letterSpacing).toEqual({ unit: 'PIXELS', value: -0.25 })
    expect(title.textCase).toBe('TITLE')
    expect(title.textDecoration).toBe('UNDERLINE')

    const unlinked: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px] bg-[#FFFFFF] border-[2px] border-[#000000]">
          <span data-key="title" class="w-full h-fit font-normal text-[12px] leading-[16px] normal-case no-underline text-[#000000]">Title</span>
        </div>
      `,
      bindings: {
        root: {
          styles: {
            fill: null,
            stroke: null,
            effect: null,
            grid: null
          }
        },
        title: {
          styles: {
            fill: null,
            stroke: null,
            text: null
          }
        }
      }
    }
    fixture.loadFontAsync.mockClear()
    await applyCanvas(unlinked)
    expect(fixture.loadFontAsync.mock.calls).toEqual([[{ family: 'Inter', style: 'Regular' }]])
    expect(root.fillStyleId).toBe('')
    expect(root.fills).toEqual([solidPaint()])
    expect(root.strokeStyleId).toBe('')
    expect(root.effectStyleId).toBe('')
    expect(root.effects).toHaveLength(1)
    expect(root.gridStyleId).toBe('')
    expect(root.layoutGrids).toHaveLength(1)
    expect(title.fillStyleId).toBe('')
    expect(title.fills).toEqual([solidPaint({ r: 0, g: 0, b: 0 })])
    expect(title.strokeStyleId).toBe('')
    expect(title.textStyleId).toBe('')
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Regular' })
    expect(title.fontSize).toBe(12)
    expect(title.lineHeight).toEqual({ unit: 'PIXELS', value: 16 })
    expect(title.textCase).toBe('ORIGINAL')
    expect(title.textDecoration).toBe('NONE')
    await expect(applyCanvas(unlinked)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('reconciles native Auto Layout spacing, ordered layout grids, variables, and guides', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px]">
          <div data-key="component" class="w-fit h-fit"></div>
        </div>
      `,
      bindings: {
        root: {
          figma: {
            autoLayout: {
              itemSpacing: -12,
              counterAxisSpacing: null,
              itemReverseZIndex: true
            },
            layoutGrids: [
              {
                pattern: 'COLUMNS',
                alignment: 'MIN',
                gutterSize: 16,
                count: 12,
                offset: 24,
                visible: false,
                color: { r: 1, g: 0, b: 0, a: 0.25 },
                variables: {
                  sectionSize: { id: 'variable:spacing' },
                  count: { id: 'variable:spacing' },
                  offset: { id: 'variable:spacing' },
                  gutterSize: { id: 'variable:spacing' }
                }
              },
              {
                pattern: 'ROWS',
                alignment: 'CENTER',
                gutterSize: 8,
                count: 'AUTO',
                sectionSize: 40
              },
              { pattern: 'GRID', sectionSize: 8 }
            ],
            guides: [
              { axis: 'X', offset: 24 },
              { axis: 'Y', offset: -8 }
            ]
          }
        },
        component: {
          component: { id: 'component:1' },
          figma: {
            layoutGrids: [{ pattern: 'GRID', sectionSize: 4 }],
            guides: [{ axis: 'Y', offset: 12 }]
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const component = fixture.getNode(
      created.nodeIdsByKey.component ?? ''
    ) as unknown as InstanceNode

    expect(root).toMatchObject({
      itemSpacing: -12,
      counterAxisSpacing: -12,
      itemReverseZIndex: true,
      guides: [
        { axis: 'X', offset: 24 },
        { axis: 'Y', offset: -8 }
      ]
    })
    expect(root.layoutGrids).toHaveLength(3)
    expect(root.layoutGrids[0]).toMatchObject({
      pattern: 'COLUMNS',
      alignment: 'MIN',
      gutterSize: 16,
      count: 12,
      offset: 24,
      visible: false,
      boundVariables: {
        sectionSize: { id: 'variable:spacing' },
        count: { id: 'variable:spacing' },
        offset: { id: 'variable:spacing' },
        gutterSize: { id: 'variable:spacing' }
      }
    })
    expect(root.layoutGrids[1]).toMatchObject({ pattern: 'ROWS', count: Infinity })
    expect(component.layoutGrids).toEqual([{ pattern: 'GRID', sectionSize: 4 }])
    expect(component.guides).toEqual([{ axis: 'Y', offset: 12 }])
    expect(created.verification.nativeFieldsChecked).toBe(4)

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const changed = structuredClone(input)
    changed.mode = 'update'
    changed.targetNodeId = created.rootNodeId
    changed.bindings!.root!.figma!.autoLayout!.itemSpacing = -20
    await applyCanvas(changed)
    expect(root).toMatchObject({ itemSpacing: -20, counterAxisSpacing: -20 })
    await expect(applyCanvas(changed)).resolves.toMatchObject({ mutationCount: 0 })

    const cleared: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px]"></div>',
      bindings: { root: { figma: { layoutGrids: [], guides: [] } } }
    }
    await applyCanvas(cleared)
    expect(root.layoutGrids).toEqual([])
    expect(root.guides).toEqual([])
    await expect(applyCanvas(cleared)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('accepts Figma defaults and color normalization in direct layout grids', async () => {
    const fixture = createFixture()
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      const node = fixture.createNode('FRAME') as unknown as FrameNode
      let layoutGrids: readonly LayoutGrid[] = []
      Object.defineProperty(node, 'layoutGrids', {
        configurable: true,
        get: () => layoutGrids,
        set: (value: readonly LayoutGrid[]) => {
          layoutGrids = value.map((grid) => ({
            ...grid,
            visible: grid.visible ?? true,
            color: grid.color
              ? {
                  r: Math.round(grid.color.r * 255) / 255,
                  g: Math.round(grid.color.g * 255) / 255,
                  b: Math.round(grid.color.b * 255) / 255,
                  a: Math.round(grid.color.a * 255) / 255
                }
              : { r: 1, g: 0, b: 0, a: 0.25 }
          }))
        }
      })
      return node
    })
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      bindings: {
        root: {
          figma: {
            layoutGrids: [
              { pattern: 'GRID', sectionSize: 8 },
              {
                pattern: 'COLUMNS',
                alignment: 'STRETCH',
                count: 12,
                gutterSize: 16,
                color: { r: 0.043, g: 0.361, b: 0.557, a: 0.09 }
              }
            ]
          }
        }
      }
    }

    const created = await applyCanvas(input)

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('replaces a grid style with direct layout grids and preflights grid variables', async () => {
    const fixture = createFixture()
    const styled: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      bindings: { root: { styles: { grid: { id: 'style:grid' } } } }
    }
    const created = await applyCanvas(styled)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    expect(root.gridStyleId).toBe('style:grid')

    const direct: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: styled.markup,
      bindings: {
        root: {
          figma: {
            layoutGrids: [{ pattern: 'GRID', sectionSize: 8 }]
          }
        }
      }
    }
    await applyCanvas(direct)
    expect(root.gridStyleId).toBe('')
    expect(root.layoutGrids).toEqual([{ pattern: 'GRID', sectionSize: 8 }])
    await expect(applyCanvas(direct)).resolves.toMatchObject({ mutationCount: 0 })

    createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: styled.markup,
        bindings: {
          root: {
            figma: {
              layoutGrids: [
                {
                  pattern: 'GRID',
                  sectionSize: 8,
                  variables: { sectionSize: { id: 'variable:visible' } }
                }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected FLOAT')
    })
    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        bindings: {
          copy: {
            figma: {
              text: {
                ranges: [{ start: 0, end: 4, textStyle: { id: 'style:fill' } }]
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected TEXT')
    })
    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        bindings: {
          copy: {
            figma: {
              text: {
                ranges: [
                  {
                    start: 0,
                    end: 4,
                    hyperlink: { type: 'NODE', value: 'missing:range-link' }
                  }
                ]
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not exist')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('reconciles complete ordered native paint stacks and paint variables', async () => {
    const fixture = createFixture()
    const patternSource = fixture.createNode('RECTANGLE')
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px] border-[2px]"></div>',
      bindings: {
        root: {
          figma: {
            fills: [
              {
                type: 'SOLID',
                color: { r: 1, g: 0, b: 0 },
                opacity: 0.5,
                variables: { color: { key: 'color-key' } }
              },
              {
                type: 'GRADIENT_LINEAR',
                gradientTransform: [
                  [1, 0, 0],
                  [0, 1, 0]
                ],
                gradientStops: [
                  {
                    position: 0,
                    color: { r: 0, g: 0, b: 0, a: 1 },
                    variables: { color: { key: 'color-key' } }
                  },
                  { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
                ]
              },
              {
                type: 'IMAGE',
                imageHash: 'image:existing',
                scaleMode: 'CROP',
                imageTransform: [
                  [1, 0, 0.25],
                  [0, 1, 0.5]
                ],
                filters: { exposure: 0.25 }
              },
              {
                type: 'VIDEO',
                videoHash: 'video:existing',
                scaleMode: 'TILE',
                scalingFactor: 0.5,
                rotation: 90
              },
              {
                type: 'PATTERN',
                sourceNodeId: patternSource.id,
                tileType: 'VERTICAL_HEXAGONAL',
                scalingFactor: 0.75,
                spacing: { x: 8, y: 12 },
                horizontalAlignment: 'END'
              },
              {
                type: 'SHADER',
                id: 'shader:fill',
                properties: {
                  strength: 0.75,
                  tint: { variable: { key: 'color-key' } }
                }
              }
            ],
            strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    expect(root.fills).not.toBe(MIXED)
    const fills = root.fills as readonly Paint[]
    expect(fills.map((paint) => paint.type)).toEqual([
      'SOLID',
      'GRADIENT_LINEAR',
      'IMAGE',
      'VIDEO',
      'PATTERN',
      'SHADER'
    ])
    expect(fills[0]).toMatchObject({
      visible: true,
      opacity: 0.5,
      blendMode: 'NORMAL',
      boundVariables: { color: { id: 'variable:color' } }
    })
    expect((fills[1] as GradientPaint).gradientStops[0]).toMatchObject({
      boundVariables: { color: { id: 'variable:color' } }
    })
    expect(fills[5]).toMatchObject({
      properties: {
        strength: 0.75,
        tint: { type: 'VARIABLE_ALIAS', id: 'variable:color' }
      }
    })
    expect(root.strokes).toMatchObject([
      { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL' }
    ])
    expect(fixture.importShaderById).toHaveBeenCalledWith('shader:fill')

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('resolves forward stable-key Pattern sources in direct and vector-region paints', async () => {
    const fixture = createFixture()
    const pattern = {
      type: 'PATTERN' as const,
      sourceCanvasKey: 'source',
      tileType: 'RECTANGULAR' as const,
      scalingFactor: 1,
      spacing: { x: 4, y: 6 },
      horizontalAlignment: 'CENTER' as const
    }
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[320px] h-[120px]">
          <div data-key="vector" class="w-[40px] h-[40px]"></div>
          <div data-key="surface" class="w-[100px] h-[80px]"></div>
          <div data-key="source" class="w-[80px] h-[80px]"></div>
        </div>
      `,
      bindings: {
        vector: {
          figma: {
            shape: {
              type: 'VECTOR',
              network: {
                vertices: [
                  { x: 0, y: 40 },
                  { x: 40, y: 40 },
                  { x: 20, y: 0 }
                ],
                segments: [
                  { start: 0, end: 1 },
                  { start: 1, end: 2 },
                  { start: 2, end: 0 }
                ],
                regions: [
                  {
                    windingRule: 'NONZERO',
                    loops: [[0, 1, 2]],
                    fills: [pattern]
                  }
                ]
              }
            }
          }
        },
        surface: {
          figma: { fills: [pattern] }
        }
      }
    }

    const created = await applyCanvas(input)
    const sourceId = created.nodeIdsByKey.source!
    const surface = fixture.getNode(created.nodeIdsByKey.surface!)
    const vector = fixture.getNode(created.nodeIdsByKey.vector!) as unknown as VectorNode

    expect(surface.fills).toMatchObject([{ type: 'PATTERN', sourceNodeId: sourceId }])
    expect(vector).toMatchObject({
      width: 40,
      height: 40,
      vectorNetwork: {
        regions: [{ fills: [{ type: 'PATTERN', sourceNodeId: sourceId }] }]
      }
    })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('imports URL image paints once per result and reconciles their native hash', async () => {
    const fixture = createFixture()
    const imageUrl = 'https://images.example.com/cover.png'
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      bindings: {
        root: {
          figma: {
            fills: [{ type: 'IMAGE', imageUrl, scaleMode: 'FILL' }],
            strokes: [{ type: 'IMAGE', imageUrl, scaleMode: 'FIT' }]
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    const fills = root.fills as readonly Paint[]
    expect(fixture.createImageAsync).toHaveBeenCalledOnce()
    expect(fixture.createImageAsync).toHaveBeenCalledWith(imageUrl)
    expect(fills).toEqual([
      expect.objectContaining({
        type: 'IMAGE',
        imageHash: `image:${imageUrl}`,
        scaleMode: 'FILL'
      })
    ])
    expect(root.strokes).toEqual([
      expect.objectContaining({
        type: 'IMAGE',
        imageHash: `image:${imageUrl}`,
        scaleMode: 'FIT'
      })
    ])
    expect(fills[0]).not.toHaveProperty('imageUrl')
    expect(root.strokes[0]).not.toHaveProperty('imageUrl')
    expect(created.verification.nativeFieldsChecked).toBe(2)

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(fixture.createImageAsync).toHaveBeenCalledTimes(2)
  })

  it('accepts Figma defaults but rejects loss of explicit direct image fields', async () => {
    const fixture = createFixture()
    let preserveRotation = true
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      const node = fixture.createNode('FRAME')
      let fills: readonly Paint[] = []
      Object.defineProperty(node, 'fills', {
        configurable: true,
        get: () => fills,
        set: (value: readonly Paint[]) => {
          const filterFields = [
            'exposure',
            'contrast',
            'saturation',
            'temperature',
            'tint',
            'highlights',
            'shadows'
          ] as const
          fills = value.map((paint) => {
            if (paint.type !== 'IMAGE') return paint
            const normalized = {
              ...paint,
              rotation:
                paint.scaleMode === 'CROP'
                  ? undefined
                  : preserveRotation
                    ? (paint.rotation ?? 0)
                    : 0,
              filters: Object.fromEntries(
                filterFields.map((field) => [field, paint.filters?.[field] ?? 0])
              )
            }
            if (paint.scaleMode === 'CROP') {
              return {
                ...normalized,
                imageTransform: paint.imageTransform ?? [
                  [1, 0, 0],
                  [0, 1, 0]
                ]
              } as ImagePaint
            }
            if (paint.scaleMode === 'TILE') {
              return { ...normalized, scalingFactor: paint.scalingFactor ?? 1 } as ImagePaint
            }
            return normalized as ImagePaint
          })
        }
      })
      return node as unknown as FrameNode
    })
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      bindings: {
        root: {
          figma: {
            fills: [
              { type: 'IMAGE', imageHash: 'image:existing', scaleMode: 'FILL' },
              { type: 'IMAGE', imageHash: 'image:existing', scaleMode: 'CROP' },
              { type: 'IMAGE', imageHash: 'image:existing', scaleMode: 'TILE' },
              { type: 'IMAGE', imageHash: 'image:existing', scaleMode: 'FIT', rotation: 90 }
            ]
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    preserveRotation = false
    root.fills = root.fills as readonly Paint[]
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: 'Verification failed for "root": direct fills do not match.'
    })
  })

  it('rolls back when Figma does not retain a declared native paint stack', async () => {
    const fixture = createFixture()
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      const node = fixture.createNode('FRAME')
      Object.defineProperty(node, 'fills', {
        configurable: true,
        get: () => [solidPaint()],
        set: vi.fn()
      })
      return node as unknown as FrameNode
    })

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              fills: [{ type: 'IMAGE', imageHash: 'image:existing', scaleMode: 'FILL' }]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: 'Verification failed for "root": direct fills do not match.'
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('imports SVG assets into a stable managed wrapper and preserves no-op retries', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="icon" class="w-[100px] h-[50px]"></div>',
      assets: {
        search: {
          type: 'SVG',
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 12h20"/></svg>'
        }
      },
      bindings: {
        icon: {
          figma: {
            svg: { assetKey: 'search', color: '#334155' }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const wrapper = fixture.getNode(created.rootNodeId)
    const child = wrapper.children[0] as MutableNode

    expect(fixture.createNodeFromSvg).toHaveBeenCalledWith(
      expect.stringContaining('stroke="#334155"')
    )
    expect(child.parent?.id).toBe(wrapper.id)
    expect(child.width).toBeCloseTo(50)
    expect(child.height).toBeCloseTo(50)
    expect(child.x).toBeCloseTo(25)
    expect(child.y).toBeCloseTo(0)

    const retry = await applyCanvas({
      ...input,
      mode: 'update',
      targetNodeId: wrapper.id
    })

    expect(retry.rootNodeId).toBe(wrapper.id)
    expect(retry.mutationCount).toBe(0)
    expect(fixture.createNodeFromSvg).toHaveBeenCalledTimes(1)
    expect(wrapper.children[0]?.id).toBe(child.id)
  })

  it('replaces changed SVG content without replacing its wrapper', async () => {
    const fixture = createFixture()
    const base: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="icon" class="w-[24px] h-[24px]"></div>',
      assets: {
        icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>' }
      },
      bindings: {
        icon: { figma: { svg: { assetKey: 'icon' } } }
      }
    }
    const created = await applyCanvas(base)
    const wrapper = fixture.getNode(created.rootNodeId)
    const previous = wrapper.children[0] as MutableNode

    const updated = await applyCanvas({
      ...base,
      mode: 'update',
      targetNodeId: wrapper.id,
      assets: {
        icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' }
      }
    })

    expect(updated.rootNodeId).toBe(wrapper.id)
    expect(previous.removed).toBe(true)
    expect(wrapper.children).toHaveLength(1)
    expect(wrapper.children[0]?.id).not.toBe(previous.id)
    expect(fixture.createNodeFromSvg).toHaveBeenCalledTimes(2)
  })

  it('reports an existing SVG wrapper when its missing owned child is rebuilt', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="icon" class="w-[24px] h-[24px]"></div>',
      assets: {
        icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' }
      },
      bindings: {
        icon: { figma: { svg: { assetKey: 'icon' } } }
      }
    }
    const created = await applyCanvas(input)
    const wrapper = fixture.getNode(created.rootNodeId)
    const missingChild = wrapper.children[0] as MutableNode
    missingChild.remove()

    const rebuilt = await applyCanvas({
      ...input,
      mode: 'update',
      targetNodeId: wrapper.id
    })

    expect(rebuilt.updatedNodeIds).toContain(wrapper.id)
    expect(wrapper.children).toHaveLength(1)
    expect(wrapper.children[0]?.id).not.toBe(missingChild.id)
  })

  it('removes managed SVG wrappers with their opaque imported subtree', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="icon" class="size-[24px]"></div></div>',
      assets: {
        icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' }
      },
      bindings: {
        icon: { figma: { svg: { assetKey: 'icon' } } }
      }
    })
    const wrapper = fixture.getNode(created.nodeIdsByKey.icon!)
    const imported = wrapper.children[0] as MutableNode
    const vector = fixture.createNode('VECTOR')
    imported.appendChild(vector)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"></div>',
        removeKeys: ['icon']
      })
    ).resolves.toMatchObject({
      removedNodeIds: [wrapper.id]
    })
    expect(wrapper.removed).toBe(true)
    expect(imported.removed).toBe(true)
    expect(vector.removed).toBe(true)
  })

  it('imports Hub image assets without putting bytes in the canvas payload', async () => {
    const fixture = createFixture()
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    const downloader = vi.fn().mockResolvedValue({
      base64: btoa(String.fromCharCode(...bytes)),
      hash,
      mimeType: 'image/png',
      size: bytes.byteLength
    })
    setAssetDownloader(downloader)

    const result = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="hero" class="w-[320px] h-[180px]"></div>',
      assets: {
        hero: { type: 'IMAGE', assetHash: hash }
      },
      bindings: {
        hero: {
          figma: {
            fills: [{ type: 'IMAGE', assetKey: 'hero', scaleMode: 'FILL' }]
          }
        }
      }
    })

    const root = fixture.getNode(result.rootNodeId)
    expect(downloader).toHaveBeenCalledWith(hash)
    expect(fixture.createImage).toHaveBeenCalledWith(bytes)
    expect(root.fills[0]).toMatchObject({
      imageHash: `image:${Array.from(bytes).join(',')}`,
      scaleMode: 'FILL',
      type: 'IMAGE'
    })
    expect(root.fills[0]).not.toHaveProperty('assetKey')

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: result.rootNodeId,
        markup: '<div data-key="hero" class="w-[320px] h-[180px]"></div>',
        assets: {
          hero: { type: 'IMAGE', assetHash: hash }
        },
        bindings: {
          hero: {
            figma: {
              fills: [{ type: 'IMAGE', assetKey: 'hero', scaleMode: 'FILL' }]
            }
          }
        }
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(fixture.createImage).toHaveBeenCalledOnce()
  })

  it('imports URL video paints once per result and reconciles their native hash', async () => {
    const fixture = createFixture()
    const videoUrl = 'https://media.example.com/demo.webm'
    const bytes = Uint8Array.from([1, 2, 3])
    const fetchMock = vi.fn(async () => new Response(bytes))
    vi.stubGlobal('fetch', fetchMock)
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      bindings: {
        root: {
          figma: {
            fills: [{ type: 'VIDEO', videoUrl, scaleMode: 'FILL' }],
            strokes: [{ type: 'VIDEO', videoUrl, scaleMode: 'FIT' }]
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      videoUrl,
      expect.objectContaining({
        credentials: 'omit',
        signal: expect.any(AbortSignal)
      })
    )
    expect(fixture.createVideoAsync).toHaveBeenCalledOnce()
    expect(fixture.createVideoAsync).toHaveBeenCalledWith(bytes)
    expect(root.fills).toEqual([
      expect.objectContaining({
        type: 'VIDEO',
        videoHash: 'video:1,2,3',
        scaleMode: 'FILL'
      })
    ])
    expect(root.strokes).toEqual([
      expect.objectContaining({
        type: 'VIDEO',
        videoHash: 'video:1,2,3',
        scaleMode: 'FIT'
      })
    ])
    expect(root.fills[0]).not.toHaveProperty('videoUrl')
    expect(root.strokes[0]).not.toHaveProperty('videoUrl')

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fixture.createVideoAsync).toHaveBeenCalledTimes(2)
  })

  it('replaces paint styles with direct stacks, preserves omission, and clears explicitly', async () => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[320px] h-[200px] border-[2px]"></div>'
    const styled = await applyCanvas({
      mode: 'create',
      markup,
      bindings: {
        root: {
          styles: {
            fill: { id: 'style:fill' },
            stroke: { id: 'style:stroke' }
          }
        }
      }
    })
    const root = fixture.getNode(styled.rootNodeId)
    expect(root.fillStyleId).toBe('style:fill')
    expect(root.strokeStyleId).toBe('style:stroke')

    const direct: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: styled.rootNodeId,
      markup,
      bindings: {
        root: {
          figma: {
            fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
            strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
          }
        }
      }
    }
    await applyCanvas(direct)
    expect(root.fillStyleId).toBe('')
    expect(root.strokeStyleId).toBe('')

    const preservingMarkup = '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: styled.rootNodeId,
        markup: preservingMarkup
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(root.fills).toHaveLength(1)
    expect(root.strokes).toHaveLength(1)

    await applyCanvas({
      ...direct,
      markup: preservingMarkup,
      bindings: { root: { figma: { fills: [], strokes: [] } } }
    })
    expect(root.fills).toEqual([])
    expect(root.strokes).toEqual([])
  })

  it('preflights paint resources and variable types before node creation', async () => {
    const fixture = createFixture()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const input = (figma: CanvasFigmaProperties) =>
      ({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma } }
      }) satisfies CanvasResolvedApplyParameters

    await expect(
      applyCanvas(
        input({
          fills: [{ type: 'IMAGE', imageHash: 'image:missing', scaleMode: 'FILL' }]
        })
      )
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not exist')
    })
    await expect(
      applyCanvas(
        input({
          fills: [
            {
              type: 'PATTERN',
              sourceNodeId: 'node:missing',
              tileType: 'RECTANGULAR',
              scalingFactor: 1,
              spacing: { x: 0, y: 0 },
              horizontalAlignment: 'START'
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not exist or is not a scene node')
    })
    await expect(
      applyCanvas(input({ fills: [{ type: 'SHADER', id: 'shader:effect' }] }))
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('effect shader, not a fill shader')
    })
    await expect(
      applyCanvas(
        input({
          fills: [
            {
              type: 'SOLID',
              color: { r: 1, g: 0, b: 0 },
              variables: { color: { id: 'variable:spacing' } }
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected COLOR')
    })
    await expect(
      applyCanvas(
        input({
          fills: [
            {
              type: 'VIDEO',
              videoUrl: 'https://media.example.com/pending.mp4',
              scaleMode: 'FILL'
            },
            {
              type: 'IMAGE',
              imageUrl: 'https://images.example.com/pending.png',
              scaleMode: 'FILL'
            },
            { type: 'IMAGE', imageHash: 'image:missing', scaleMode: 'FIT' }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not exist')
    })
    expect(fixture.createImageAsync).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('rejects missing or removed Pattern sources', async () => {
    const fixture = createFixture()
    const pattern = (source: { sourceCanvasKey: string } | { sourceNodeId: string }) =>
      ({
        type: 'PATTERN',
        ...source,
        tileType: 'RECTANGULAR',
        scalingFactor: 1,
        spacing: { x: 0, y: 0 },
        horizontalAlignment: 'START'
      }) as const

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: { figma: { fills: [pattern({ sourceCanvasKey: 'missing' })] } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('canvas key "missing" does not exist')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()

    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[320px] h-[200px]">
          <div data-key="obsolete" class="flex flex-row w-[100px] h-[100px]">
            <div data-key="source" class="w-[80px] h-[80px]"></div>
          </div>
          <div data-key="surface" class="w-[100px] h-[100px]"></div>
        </div>
      `
    })
    const obsolete = fixture.getNode(created.nodeIdsByKey.obsolete!)
    const source = fixture.getNode(created.nodeIdsByKey.source!)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `
          <div data-key="root" class="flex flex-row w-[320px] h-[200px]">
            <div data-key="surface" class="w-[100px] h-[100px]"></div>
          </div>
        `,
        bindings: {
          surface: { figma: { fills: [pattern({ sourceCanvasKey: 'source' })] } }
        },
        removeKeys: ['obsolete']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('Referenced node')
    })
    expect(obsolete.removed).toBe(false)
    expect(source.removed).toBe(false)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `
          <div data-key="root" class="flex flex-row w-[320px] h-[200px]">
            <div data-key="surface" class="w-[100px] h-[100px]"></div>
          </div>
        `,
        bindings: {
          surface: {
            figma: {
              fills: [pattern({ sourceNodeId: source.id })]
            }
          }
        },
        removeKeys: ['obsolete']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('Referenced node')
    })
    expect(obsolete.removed).toBe(false)
    expect(source.removed).toBe(false)
  })

  it('rolls back when a URL image cannot be loaded', async () => {
    const fixture = createFixture()
    fixture.createImageAsync.mockRejectedValueOnce(new Error('network failed'))

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              fills: [
                {
                  type: 'IMAGE',
                  imageUrl: 'https://images.example.com/invalid.png',
                  scaleMode: 'FILL'
                }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('could not be loaded')
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('bounds streamed video downloads before native import', async () => {
    const fixture = createFixture()
    const cancel = vi.fn(async () => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: vi.fn(() => null) },
        body: {
          getReader: () => ({
            read: vi.fn(async () => ({
              done: false,
              value: { byteLength: 100 * 1024 * 1024 + 1 }
            })),
            cancel
          })
        }
      }))
    )

    await expect(
      applyCanvas(videoUrlSpec('https://media.example.com/oversized.mp4'))
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('up to 100MB')
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(fixture.createVideoAsync).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('rejects a declared video size over Figma’s limit without reading its body', async () => {
    const fixture = createFixture()
    const response = new Response(null, {
      headers: { 'content-length': String(100 * 1024 * 1024 + 1) }
    })
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    )

    await expect(
      applyCanvas(videoUrlSpec('https://media.example.com/declared-oversized.mp4'))
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('up to 100MB')
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(fixture.createVideoAsync).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('rolls back when Figma rejects a downloaded video', async () => {
    const fixture = createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(Uint8Array.from([1])))
    )
    fixture.createVideoAsync.mockRejectedValueOnce(new Error('unsupported video'))

    await expect(
      applyCanvas(videoUrlSpec('https://media.example.com/invalid.mp4'))
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('paid team file')
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('reconciles the complete ordered native effect stack with variables and shader properties', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] bg-[#FFFFFF] overflow-hidden"></div>',
      bindings: {
        root: {
          figma: {
            effects: [
              {
                type: 'DROP_SHADOW',
                color: { r: 0, g: 0, b: 0, a: 0.2 },
                offset: { x: 0, y: 4 },
                radius: 8,
                spread: 2,
                showShadowBehindNode: true,
                variables: {
                  color: { key: 'color-key' },
                  radius: { id: 'variable:spacing' },
                  offsetX: { id: 'variable:spacing' }
                }
              },
              {
                type: 'INNER_SHADOW',
                color: { r: 1, g: 1, b: 1, a: 0.4 },
                offset: { x: 0, y: 1 },
                radius: 2,
                blendMode: 'SCREEN'
              },
              {
                type: 'LAYER_BLUR',
                blurType: 'NORMAL',
                radius: 12,
                variables: { radius: { id: 'variable:spacing' } }
              },
              {
                type: 'BACKGROUND_BLUR',
                blurType: 'PROGRESSIVE',
                radius: 24,
                startRadius: 0,
                startOffset: { x: 0, y: 0 },
                endOffset: { x: 1, y: 1 }
              },
              {
                type: 'NOISE',
                noiseType: 'MONOTONE',
                color: { r: 0, g: 0, b: 0, a: 1 },
                noiseSize: 1,
                density: 0.5
              },
              {
                type: 'NOISE',
                noiseType: 'DUOTONE',
                color: { r: 0, g: 0, b: 0, a: 1 },
                secondaryColor: { r: 1, g: 1, b: 1, a: 1 },
                noiseSize: 2,
                noiseSizeVector: { x: 2, y: 3 },
                density: 0.5
              },
              {
                type: 'NOISE',
                noiseType: 'MULTITONE',
                color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
                noiseSize: 1,
                density: 0.5,
                opacity: 0.75
              },
              {
                type: 'TEXTURE',
                noiseSize: 1,
                noiseSizeVector: { x: 1, y: 2 },
                radius: 4,
                clipToShape: true
              },
              {
                type: 'GLASS',
                lightIntensity: 0.8,
                lightAngle: 45,
                refraction: 0.5,
                depth: 1,
                dispersion: 0.2,
                radius: 16
              },
              {
                type: 'SHADER',
                id: 'shader:effect',
                properties: {
                  strength: 0.75,
                  tint: { variable: { key: 'color-key' } },
                  origin: {
                    x: 0.25,
                    y: 0.75,
                    color: { variable: { key: 'color-key' } }
                  },
                  ramp: {
                    stops: [
                      { position: 0, color: { r: 0, g: 0, b: 0 } },
                      {
                        position: 1,
                        color: { variable: { key: 'color-key' } }
                      }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    expect(root.effects.map((effect) => effect.type)).toEqual([
      'DROP_SHADOW',
      'INNER_SHADOW',
      'LAYER_BLUR',
      'BACKGROUND_BLUR',
      'NOISE',
      'NOISE',
      'NOISE',
      'TEXTURE',
      'GLASS',
      'SHADER'
    ])
    expect(root.effects[0]).toMatchObject({
      visible: true,
      blendMode: 'NORMAL',
      showShadowBehindNode: true,
      boundVariables: {
        color: { id: 'variable:color' },
        radius: { id: 'variable:spacing' },
        offsetX: { id: 'variable:spacing' }
      }
    })
    expect(root.effects[2]).toMatchObject({
      blurType: 'NORMAL',
      visible: true,
      boundVariables: { radius: { id: 'variable:spacing' } }
    })
    expect(root.effects[9]).toMatchObject({
      id: 'shader:effect',
      visible: true,
      properties: {
        strength: 0.75,
        tint: { type: 'VARIABLE_ALIAS', id: 'variable:color' },
        origin: {
          x: 0.25,
          y: 0.75,
          color: { type: 'VARIABLE_ALIAS', id: 'variable:color' }
        },
        ramp: {
          stops: [
            { position: 0, color: { r: 0, g: 0, b: 0 } },
            {
              position: 1,
              color: { type: 'VARIABLE_ALIAS', id: 'variable:color' }
            }
          ]
        }
      }
    })
    expect(fixture.importShaderById).toHaveBeenCalledWith('shader:effect')
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('accepts Figma float normalization in shadow effects', async () => {
    const fixture = createFixture()
    transformNextFrameEffects(fixture, (effects) =>
      effects.map((effect) =>
        effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
          ? {
              ...effect,
              color: {
                r: Math.fround(effect.color.r),
                g: Math.fround(effect.color.g),
                b: Math.fround(effect.color.b),
                a: Math.fround(effect.color.a)
              },
              ...(effect.type === 'DROP_SHADOW' ? { showShadowBehindNode: true } : {})
            }
          : effect
      )
    )

    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] shadow-[0_24px_60px_rgba(17,13,24,0.22)]"></div>'
    })

    expect(created.verification.status).toBe('passed')
    expect(fixture.getNode(created.rootNodeId).effects).toMatchObject([
      {
        type: 'DROP_SHADOW',
        color: {
          r: Math.fround(17 / 255),
          g: Math.fround(13 / 255),
          b: Math.fround(24 / 255),
          a: Math.fround(0.22)
        },
        showShadowBehindNode: true
      }
    ])
  })

  it('does not erase an explicitly disabled behind-node shadow', async () => {
    const fixture = createFixture()
    transformNextFrameEffects(fixture, (effects) =>
      effects.map((effect) =>
        effect.type === 'DROP_SHADOW' ? { ...effect, showShadowBehindNode: true } : effect
      )
    )

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              effects: [
                {
                  type: 'DROP_SHADOW',
                  color: { r: 0, g: 0, b: 0, a: 0.2 },
                  offset: { x: 0, y: 4 },
                  radius: 8,
                  showShadowBehindNode: false
                }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringMatching(/showShadowBehindNode.*false.*showShadowBehindNode.*true/)
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('reports the first mismatched effect state after verification', async () => {
    const fixture = createFixture()
    transformNextFrameEffects(fixture, (effects) =>
      effects.map((effect) =>
        effect.type === 'DROP_SHADOW' ? { ...effect, radius: effect.radius + 1 } : effect
      )
    )

    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="w-[320px] h-[200px] shadow-[0_4px_8px_rgba(0,0,0,0.2)]"></div>'
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringMatching(
        /direct effect 0 does not match; expected .*"radius":8.*found .*"radius":9/
      )
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('replaces an effect style with direct effects, preserves omission, and clears explicitly', async () => {
    const fixture = createFixture()
    const styled: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      bindings: { root: { styles: { effect: { id: 'style:effect' } } } }
    }
    const created = await applyCanvas(styled)
    const root = fixture.getNode(created.rootNodeId)
    expect(root.effectStyleId).toBe('style:effect')

    const direct: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: styled.markup,
      bindings: {
        root: {
          figma: {
            effects: [
              {
                type: 'DROP_SHADOW',
                color: { r: 0, g: 0, b: 0, a: 0.2 },
                offset: { x: 0, y: 4 },
                radius: 8
              }
            ]
          }
        }
      }
    }
    await applyCanvas(direct)
    expect(root.effectStyleId).toBe('')
    expect(root.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 4 },
        radius: 8,
        visible: true,
        blendMode: 'NORMAL'
      }
    ])

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: styled.markup
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(root.effects).toHaveLength(1)

    await applyCanvas({
      ...direct,
      bindings: { root: { figma: { effects: [] } } }
    })
    expect(root.effects).toEqual([])
  })

  it('preflights shader type, property definitions, and effect variables before node creation', async () => {
    createFixture()
    const base: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    }
    await expect(
      applyCanvas({
        ...base,
        bindings: {
          root: {
            figma: {
              effects: [{ type: 'SHADER', id: 'shader:fill' }]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('fill shader')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()

    await expect(
      applyCanvas({
        ...base,
        bindings: {
          root: {
            figma: {
              effects: [
                {
                  type: 'SHADER',
                  id: 'shader:effect',
                  properties: { strength: 'wrong type' }
                }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expects NUMBER')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()

    await expect(
      applyCanvas({
        ...base,
        bindings: {
          root: {
            figma: {
              effects: [
                {
                  type: 'DROP_SHADOW',
                  color: { r: 0, g: 0, b: 0, a: 1 },
                  offset: { x: 0, y: 0 },
                  radius: 4,
                  variables: { color: { id: 'variable:spacing' } }
                }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected COLOR')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('enforces Figma shadow-spread applicability after final paints and clipping', async () => {
    const fixture = createFixture()
    const effect = {
      type: 'DROP_SHADOW' as const,
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 2
    }
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px] bg-[#FFFFFF]"></div>',
        bindings: { root: { figma: { effects: [effect] } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('clipped frame/instance with a visible fill')
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('accepts shadow spread with a deferred visible Pattern fill', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="surface" class="overflow-hidden w-[120px] h-[120px]"></div><div data-key="source" class="w-[40px] h-[40px]"></div></div>',
      bindings: {
        surface: {
          figma: {
            fills: [
              {
                type: 'PATTERN',
                sourceCanvasKey: 'source',
                tileType: 'RECTANGULAR',
                scalingFactor: 1,
                spacing: { x: 0, y: 0 },
                horizontalAlignment: 'START'
              }
            ],
            effects: [
              {
                type: 'DROP_SHADOW',
                color: { r: 0, g: 0, b: 0, a: 0.2 },
                offset: { x: 0, y: 4 },
                radius: 8,
                spread: 2
              }
            ]
          }
        }
      }
    })

    expect(fixture.getNode(created.nodeIdsByKey.surface!)).toMatchObject({
      clipsContent: true,
      fills: [{ type: 'PATTERN', sourceNodeId: created.nodeIdsByKey.source }],
      effects: [{ type: 'DROP_SHADOW', spread: 2 }]
    })
  })

  it('reconciles whole-node text typography and Figma-native text state', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span
            data-key="copy"
            class="w-[240px] h-[80px] leading-normal tracking-[2%] text-justify uppercase underline line-clamp-2"
          >Two lines of copy</span>
        </div>
      `,
      bindings: {
        copy: {
          variables: {
            fontSize: { id: 'variable:spacing' }
          },
          figma: {
            text: {
              fontName: { family: 'IBM Plex Sans', style: 'Medium' },
              verticalAlign: 'CENTER',
              paragraphIndent: 12,
              paragraphSpacing: 16,
              listSpacing: 8,
              hangingPunctuation: true,
              hangingList: true,
              leadingTrim: 'CAP_HEIGHT',
              hyperlink: { type: 'URL', value: 'https://example.com' }
            }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    expect(copy).toMatchObject({
      textAutoResize: 'NONE',
      fontName: { family: 'IBM Plex Sans', style: 'Medium' },
      lineHeight: { unit: 'PERCENT', value: 150 },
      letterSpacing: { unit: 'PERCENT', value: 2 },
      textAlignHorizontal: 'JUSTIFIED',
      textAlignVertical: 'CENTER',
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
      textTruncation: 'ENDING',
      maxLines: 2,
      paragraphIndent: 12,
      paragraphSpacing: 16,
      listSpacing: 8,
      hangingPunctuation: true,
      hangingList: true,
      leadingTrim: 'CAP_HEIGHT',
      hyperlink: { type: 'URL', value: 'https://example.com' }
    })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span
            data-key="copy"
            class="w-[240px] h-[80px] leading-[120%] tracking-[-0.5px] text-right normal-case line-through line-clamp-none"
          >Two lines of copy</span>
        </div>
      `,
      bindings: {
        copy: {
          figma: {
            text: {
              verticalAlign: 'BOTTOM',
              paragraphIndent: 0,
              paragraphSpacing: 0,
              listSpacing: 0,
              hangingPunctuation: false,
              hangingList: false,
              leadingTrim: 'NONE',
              hyperlink: null
            }
          }
        }
      }
    }
    await applyCanvas(updated)

    expect(copy).toMatchObject({
      lineHeight: { unit: 'PERCENT', value: 120 },
      letterSpacing: { unit: 'PIXELS', value: -0.5 },
      textAlignHorizontal: 'RIGHT',
      textAlignVertical: 'BOTTOM',
      textCase: 'ORIGINAL',
      textDecoration: 'STRIKETHROUGH',
      textTruncation: 'DISABLED',
      maxLines: null,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingPunctuation: false,
      hangingList: false,
      leadingTrim: 'NONE',
      hyperlink: null
    })
    await expect(applyCanvas(updated)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('reconciles display names independently from stable keys and text auto-rename', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Initial label</span></div>',
      bindings: {
        root: {
          figma: { name: 'Settings panel' }
        },
        copy: {
          figma: { text: { autoRename: true } }
        }
      }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    expect(root.name).toBe('Settings panel')
    expect(copy).toMatchObject({
      name: 'Initial label',
      characters: 'Initial label',
      autoRename: true
    })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const fixed: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Changed label</span></div>',
      bindings: {
        root: {
          figma: { name: '' }
        },
        copy: {
          figma: {
            name: 'Primary label',
            text: { autoRename: false }
          }
        }
      }
    }
    await applyCanvas(fixed)
    expect(root.name).toBe('')
    expect(copy).toMatchObject({
      name: 'Primary label',
      characters: 'Changed label',
      autoRename: false
    })
    await expect(applyCanvas(fixed)).resolves.toMatchObject({ mutationCount: 0 })

    const derived: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Derived again</span></div>',
      bindings: {
        root: {
          figma: { name: '' }
        },
        copy: {
          figma: { text: { autoRename: true } }
        }
      }
    }
    const derivedResult = await applyCanvas(derived)
    expect(copy).toMatchObject({
      name: 'Derived again',
      characters: 'Derived again',
      autoRename: true
    })
    expect(derivedResult.nodeIdsByKey).toEqual({
      root: created.rootNodeId,
      copy: copy.id
    })
    await expect(applyCanvas(derived)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preflights node hyperlinks before mutating the canvas', async () => {
    const fixture = createFixture()
    const target = fixture.createNode('FRAME')
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
      bindings: {
        copy: {
          figma: {
            text: {
              case: 'SMALL_CAPS',
              hyperlink: { type: 'NODE', value: target.id }
            }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode
    expect(copy.textCase).toBe('SMALL_CAPS')
    expect(copy.hyperlink).toEqual({ type: 'NODE', value: target.id })

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId,
        bindings: {
          copy: {
            figma: { text: { hyperlink: { type: 'NODE', value: 'missing:1' } } }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not exist')
    })
    expect(copy.hyperlink).toEqual({ type: 'NODE', value: target.id })
  })

  it('resolves forward stable-key hyperlinks after whole and ranged text paints', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="copy" class="w-full h-fit">Link</span>
          <div data-key="target" class="w-[80px] h-[40px]"></div>
        </div>
      `,
      bindings: {
        copy: {
          figma: {
            fills: [
              {
                type: 'PATTERN',
                sourceCanvasKey: 'target',
                tileType: 'RECTANGULAR',
                scalingFactor: 1,
                spacing: { x: 0, y: 0 },
                horizontalAlignment: 'START'
              }
            ],
            text: {
              hyperlink: { type: 'NODE', value: { canvasKey: 'target' } },
              ranges: [
                {
                  start: 0,
                  end: 4,
                  fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
                  hyperlink: { type: 'NODE', value: { canvasKey: 'target' } }
                }
              ]
            }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const targetId = created.nodeIdsByKey.target!
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode

    expect(copy.fills).toMatchObject([{ type: 'PATTERN', sourceNodeId: targetId }])
    expect(copy.hyperlink).toEqual({ type: 'NODE', value: targetId })
    expect(copy.getRangeFills(0, 4)).toMatchObject([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }])
    expect(copy.getRangeHyperlink(0, 4)).toEqual({ type: 'NODE', value: targetId })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('applies a deferred whole-node canvas-key hyperlink before range hyperlinks', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Link</span><div data-key="target" class="w-[80px] h-[40px]"></div></div>'
    })
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
    const events: string[] = []
    let wholeHyperlink = copy.hyperlink
    Object.defineProperty(copy, 'hyperlink', {
      configurable: true,
      get: () => wholeHyperlink,
      set: (value: HyperlinkTarget | null) => {
        events.push('whole')
        wholeHyperlink = value
      }
    })
    const setRangeHyperlink = copy.setRangeHyperlink.bind(copy)
    copy.setRangeHyperlink = vi.fn((start, end, value) => {
      events.push('range')
      setRangeHyperlink(start, end, value)
    })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Link</span><div data-key="target" class="w-[80px] h-[40px]"></div></div>',
      bindings: {
        copy: {
          figma: {
            text: {
              hyperlink: { type: 'NODE', value: { canvasKey: 'target' } },
              ranges: [
                {
                  start: 0,
                  end: 4,
                  hyperlink: { type: 'URL', value: 'https://example.com/range' }
                }
              ]
            }
          }
        }
      }
    })

    expect(events).toEqual(['whole', 'range'])
    expect(copy.getRangeHyperlink(0, 4)).toEqual({
      type: 'URL',
      value: 'https://example.com/range'
    })
  })

  it('reconciles complete rich-text range patches without flattening exact text', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit whitespace-pre-wrap">Hello\nworld</span></div>',
      bindings: {
        copy: {
          variables: {
            fontSize: { id: 'variable:spacing' }
          },
          variableModes: {
            'collection:tokens': 'mode:dark'
          },
          figma: {
            text: {
              ranges: [
                {
                  start: 0,
                  end: 5,
                  textStyle: { id: 'style:text' },
                  fontName: { family: 'Inter', style: 'Bold' },
                  fontSize: 20,
                  textCase: 'UPPER',
                  letterSpacing: { unit: 'PERCENT', value: -2 },
                  lineHeight: { unit: 'PIXELS', value: 28 },
                  textDecoration: 'UNDERLINE',
                  textDecorationStyle: 'WAVY',
                  textDecorationOffset: { unit: 'AUTO' },
                  textDecorationThickness: { unit: 'PIXELS', value: 1.5 },
                  textDecorationColor: {
                    value: {
                      type: 'SOLID',
                      color: { r: 1, g: 0, b: 0 }
                    }
                  },
                  textDecorationSkipInk: true,
                  fills: [
                    {
                      type: 'SOLID',
                      color: { r: 0, g: 0, b: 0 },
                      variables: { color: { key: 'color-key' } }
                    }
                  ],
                  listOptions: { type: 'UNORDERED' },
                  listSpacing: 8,
                  indentation: 2,
                  paragraphIndent: 12,
                  paragraphSpacing: 16,
                  hyperlink: { type: 'URL', value: 'https://example.com' },
                  variables: {
                    fontFamily: { id: 'variable:range-family' },
                    fontStyle: { id: 'variable:range-style' },
                    fontSize: { id: 'variable:range-size' }
                  }
                },
                {
                  start: 6,
                  end: 11,
                  fillStyle: { id: 'style:fill' },
                  lineHeight: { unit: 'AUTO' },
                  listOptions: { type: 'NONE' },
                  hyperlink: null
                }
              ]
            }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    expect(copy.characters).toBe('Hello\nworld')
    expect(copy.getRangeTextStyleId(0, 5)).toBe('style:text')
    expect(copy.getRangeFontName(0, 5)).toEqual({ family: 'Inter', style: 'Bold' })
    expect(copy.getRangeFontSize(0, 5)).toBe(20)
    expect(copy.getRangeTextCase(0, 5)).toBe('UPPER')
    expect(copy.getRangeLetterSpacing(0, 5)).toEqual({ unit: 'PERCENT', value: -2 })
    expect(copy.getRangeLineHeight(0, 5)).toEqual({ unit: 'PIXELS', value: 28 })
    expect(copy.getRangeTextDecoration(0, 5)).toBe('UNDERLINE')
    expect(copy.getRangeTextDecorationStyle(0, 5)).toBe('WAVY')
    expect(copy.getRangeTextDecorationOffset(0, 5)).toEqual({ unit: 'AUTO' })
    expect(copy.getRangeTextDecorationThickness(0, 5)).toEqual({
      unit: 'PIXELS',
      value: 1.5
    })
    expect(copy.getRangeTextDecorationColor(0, 5)).toMatchObject({
      value: { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }
    })
    expect(copy.getRangeTextDecorationSkipInk(0, 5)).toBe(true)
    expect(copy.getRangeFills(0, 5)).toMatchObject([
      {
        type: 'SOLID',
        boundVariables: { color: { id: 'variable:color' } }
      }
    ])
    expect(copy.getRangeListOptions(0, 5)).toEqual({ type: 'UNORDERED' })
    expect(copy.getRangeListSpacing(0, 5)).toBe(8)
    expect(copy.getRangeIndentation(0, 5)).toBe(2)
    expect(copy.getRangeParagraphIndent(0, 5)).toBe(12)
    expect(copy.getRangeParagraphSpacing(0, 5)).toBe(16)
    expect(copy.getRangeHyperlink(0, 5)).toEqual({
      type: 'URL',
      value: 'https://example.com'
    })
    expect(copy.getRangeBoundVariable(0, 5, 'fontSize')).toMatchObject({
      id: 'variable:range-size'
    })
    expect(copy.getRangeBoundVariable(0, 5, 'fontFamily')).toMatchObject({
      id: 'variable:range-family'
    })
    expect(copy.getRangeBoundVariable(0, 5, 'fontStyle')).toMatchObject({
      id: 'variable:range-style'
    })
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'Bold' })
    expect(copy.boundVariables?.fontSize).toMatchObject({ id: 'variable:spacing' })
    expect(copy.getRangeFillStyleId(6, 11)).toBe('style:fill')
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: input.markup,
      bindings: {
        copy: {
          figma: {
            text: {
              ranges: [
                {
                  start: 0,
                  end: 5,
                  fontSize: 18,
                  hyperlink: null,
                  textStyle: null,
                  variables: { fontSize: null }
                },
                {
                  start: 6,
                  end: 11,
                  fillStyle: null
                }
              ]
            }
          }
        }
      }
    }
    await applyCanvas(update)
    expect(copy.getRangeFontSize(0, 5)).toBe(18)
    expect(copy.getRangeBoundVariable(0, 5, 'fontSize')).toBeNull()
    expect(copy.getRangeHyperlink(0, 5)).toBeNull()
    expect(copy.getRangeTextStyleId(0, 5)).toBe('')
    expect(copy.getRangeFillStyleId(6, 11)).toBe('')
    expect(copy.boundVariables?.fontSize).toMatchObject({ id: 'variable:spacing' })
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preflights rich-text resources before creating canvas nodes', async () => {
    createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        bindings: {
          copy: {
            figma: {
              text: {
                ranges: [
                  {
                    start: 0,
                    end: 4,
                    variables: { fontSize: { key: 'color-key' } }
                  }
                ]
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected FLOAT')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('rejects incompatible native styles before creating canvas nodes', async () => {
    const fixture = createFixture()

    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="title" class="w-full h-fit">Title</span></div>',
        bindings: {
          title: {
            styles: {
              text: { id: 'style:fill' }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected TEXT')
    })
    expect(PAGE.children).toEqual([])
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('reconciles visibility, blend mode, rotation, locking, and aspect-ratio lock', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] hidden mix-blend-multiply rotate-[450deg]"></div>',
      bindings: {
        root: {
          figma: {
            locked: true,
            aspectRatioLocked: true
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)

    expect(root).toMatchObject({
      visible: false,
      blendMode: 'MULTIPLY',
      rotation: -90,
      locked: true,
      targetAspectRatio: { x: 320, y: 200 }
    })
    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] visible mix-blend-pass-through rotate-[-90deg]"></div>',
      bindings: {
        root: {
          figma: {
            locked: false,
            aspectRatioLocked: false
          }
        }
      }
    }
    await applyCanvas(updated)

    expect(root).toMatchObject({
      visible: true,
      blendMode: 'PASS_THROUGH',
      rotation: 90,
      locked: false,
      targetAspectRatio: null
    })
    await expect(applyCanvas(updated)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('locks the resolved ratio of a flexible Auto Layout child', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="media" class="w-full h-[100px]"></div></div>',
      bindings: {
        media: {
          figma: { aspectRatioLocked: true }
        }
      }
    }

    const created = await applyCanvas(input)
    const media = fixture.getNode(created.nodeIdsByKey.media!) as unknown as FrameNode
    expect(media).toMatchObject({
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'FIXED',
      targetAspectRatio: { x: 100, y: 100 }
    })
    expect(media.lockAspectRatio).toHaveBeenCalledOnce()

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(media.lockAspectRatio).toHaveBeenCalledOnce()
  })

  it('reconciles bounded native masks after sibling order is established', async () => {
    const fixture = createFixture()
    const markup = `
      <div data-key="root" class="flex flex-row w-[200px] h-[200px]">
        <div data-key="mask" class="absolute left-[0px] top-[0px] w-[100px] h-[100px]"></div>
        <div data-key="content" class="absolute left-[0px] top-[0px] w-[200px] h-[200px]"></div>
      </div>
    `
    const input = (mask?: 'ALPHA' | 'VECTOR' | 'LUMINANCE' | null) =>
      ({
        mode: 'create',
        markup,
        bindings: {
          mask: {
            figma: {
              shape: { type: 'ELLIPSE' },
              ...(mask === undefined ? {} : { mask })
            }
          }
        }
      }) satisfies CanvasResolvedApplyParameters

    const created = await applyCanvas(input('VECTOR'))
    const mask = fixture.getNode(created.nodeIdsByKey.mask ?? '')
    const update = (value?: 'ALPHA' | 'VECTOR' | 'LUMINANCE' | null) => ({
      ...input(value),
      mode: 'update' as const,
      targetNodeId: created.rootNodeId
    })
    expect(mask).toMatchObject({ type: 'ELLIPSE', isMask: true, maskType: 'VECTOR' })

    await expect(applyCanvas(update('VECTOR'))).resolves.toMatchObject({ mutationCount: 0 })
    await expect(applyCanvas(update())).resolves.toMatchObject({ mutationCount: 0 })
    expect(mask.isMask).toBe(true)

    await applyCanvas(update('LUMINANCE'))
    expect(mask).toMatchObject({ isMask: true, maskType: 'LUMINANCE' })

    await applyCanvas(update(null))
    expect(mask).toMatchObject({ isMask: false, maskType: 'LUMINANCE' })
  })

  it.each([
    {
      markup: '<div data-key="root" class="w-[200px] h-[200px]"></div>',
      key: 'root',
      message: 'root cannot be a mask'
    },
    {
      markup:
        '<div data-key="root" class="flex flex-row w-[200px] h-[200px]"><div data-key="mask" class="w-[100px] h-[100px]"></div></div>',
      key: 'mask',
      message: 'must precede at least one sibling'
    }
  ])('rejects an unsafe native mask scope: $message', async ({ markup, key, message }) => {
    createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup,
        bindings: { [key]: { figma: { mask: 'ALPHA' } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining(message)
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('rejects a mask update that would capture an omitted live child', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[200px] h-[200px]"><div data-key="mask" class="w-[100px] h-[100px]"></div><div data-key="content" class="w-[100px] h-[100px]"></div></div>',
      bindings: {
        mask: {
          figma: { mask: 'ALPHA' }
        }
      }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const unmanaged = fixture.createNode('RECTANGLE')
    root.insertChild(root.children.length, unmanaged)

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('describe every direct child')
    })
    expect(root.children).toContain(unmanaged)
  })

  it('preflights a preserved live mask when the update omits its mask field', async () => {
    const fixture = createFixture()
    const markup =
      '<div data-key="root" class="flex flex-row w-[200px] h-[200px]"><div data-key="mask" class="w-[100px] h-[100px]"></div><div data-key="content" class="w-[100px] h-[100px]"></div></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      bindings: {
        mask: { figma: { mask: 'ALPHA' } }
      }
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const mask = fixture.getNode(created.nodeIdsByKey.mask!)
    const unmanaged = fixture.createNode('RECTANGLE')
    root.appendChild(unmanaged)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('describe every direct child')
    })
    expect(mask.isMask).toBe(true)
    expect(root.children).toContain(unmanaged)
  })

  it('applies native grid tracks and safely reconciles manual child placement', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div
          data-key="grid"
          class="grid grid-cols-[1fr_240px] grid-rows-[80px_1fr] w-[640px] h-[360px] gap-x-[24px] gap-y-[16px]"
        >
          <div data-key="one" class="w-full h-full col-start-1 row-start-1 row-span-2"></div>
          <span data-key="two" class="w-full h-fit col-start-2 row-start-1 justify-self-center">Two</span>
        </div>
      `,
      bindings: {
        grid: {
          variables: {
            gridRowGap: { id: 'variable:spacing' },
            gridColumnGap: { id: 'variable:spacing' }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const grid = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const one = fixture.getNode(created.nodeIdsByKey.one ?? '')
    const two = fixture.getNode(created.nodeIdsByKey.two ?? '')

    expect(grid).toMatchObject({
      layoutMode: 'GRID',
      gridRowCount: 2,
      gridColumnCount: 2,
      gridItemsPositioning: 'MANUAL',
      gridAutoTracks: 'NONE'
    })
    expect(grid.gridColumnSizes).toEqual([
      { type: 'FLEX', value: 1 },
      { type: 'FIXED', value: 240 }
    ])
    expect(grid.gridRowSizes).toEqual([
      { type: 'FIXED', value: 80 },
      { type: 'FLEX', value: 1 }
    ])
    expect(grid.boundVariables).toMatchObject({
      gridRowGap: { id: 'variable:spacing' },
      gridColumnGap: { id: 'variable:spacing' }
    })
    expect(one).toMatchObject({
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 0,
      gridRowSpan: 2,
      gridColumnSpan: 1
    })
    expect(two).toMatchObject({
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 1,
      gridChildHorizontalAlign: 'CENTER'
    })

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const swapped: CanvasResolvedApplyParameters = {
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div
          data-key="grid"
          class="grid grid-cols-[1fr_240px] grid-rows-[80px_1fr] w-[640px] h-[360px] gap-x-[24px] gap-y-[16px]"
        >
          <div data-key="one" class="w-full h-full col-start-2 row-start-1 row-span-2"></div>
          <span data-key="two" class="w-full h-fit col-start-1 row-start-1 justify-self-center">Two</span>
        </div>
      `
    }
    await applyCanvas(swapped)
    expect(one).toMatchObject({ gridRowAnchorIndex: 0, gridColumnAnchorIndex: 1 })
    expect(two).toMatchObject({ gridRowAnchorIndex: 0, gridColumnAnchorIndex: 0 })
    expect(grid.gridRowCount).toBe(2)
    expect(one.setGridChildPosition).toHaveBeenCalled()
    expect(two.setGridChildPosition).toHaveBeenCalled()

    await expect(applyCanvas(swapped)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('reconciles manual placement with native automatic rows', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="grid" class="grid grid-cols-2 w-[480px] h-[320px] gap-[12px]">
          <div data-key="tall" class="w-full h-full col-start-2 row-start-1 row-span-2"></div>
          <div data-key="one" class="w-full h-full"></div>
          <div data-key="two" class="w-full h-full"></div>
        </div>
      `
    }

    const created = await applyCanvas(input)
    const grid = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const tall = fixture.getNode(created.nodeIdsByKey.tall!)
    const one = fixture.getNode(created.nodeIdsByKey.one!)
    const two = fixture.getNode(created.nodeIdsByKey.two!)

    expect(grid).toMatchObject({
      layoutMode: 'GRID',
      gridAutoTracks: 'ROWS',
      gridItemsPositioning: 'MANUAL',
      gridColumnCount: 2,
      gridRowCount: 2
    })
    expect(tall).toMatchObject({
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 1,
      gridRowSpan: 2
    })
    expect(one).toMatchObject({
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 0
    })
    expect(two).toMatchObject({
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 0
    })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const unmanaged = fixture.createNode('RECTANGLE')
    grid.insertChild(grid.children.length, unmanaged)
    grid.gridAutoTracks = 'NONE'
    grid.gridRowCount = 4
    unmanaged.setGridChildPosition(3, 0)
    grid.gridAutoTracks = 'ROWS'
    const rearranged = {
      ...input,
      mode: 'update' as const,
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="grid" class="grid grid-cols-2 w-[480px] h-[320px] gap-[12px]">
          <div data-key="tall" class="w-full h-full col-start-1 row-start-1 row-span-2"></div>
          <div data-key="one" class="w-full h-full col-start-2 row-start-1"></div>
          <div data-key="two" class="w-full h-full col-start-2 row-start-2"></div>
        </div>
      `
    }

    await applyCanvas(rearranged)
    expect(grid).toMatchObject({
      gridAutoTracks: 'ROWS',
      gridItemsPositioning: 'MANUAL',
      gridRowCount: 4
    })
    expect(grid.children).toContain(unmanaged)
    expect(unmanaged.gridRowAnchorIndex).toBe(3)
    await expect(applyCanvas(rearranged)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('finalizes native grid state even when the grid has no children', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="grid" class="grid grid-cols-[1fr_240px] grid-rows-[80px_1fr] w-[480px] h-[320px]"></div>'
    })
    const grid = fixture.getNode(created.rootNodeId) as unknown as FrameNode

    expect(grid).toMatchObject({
      gridAutoTracks: 'NONE',
      gridItemsPositioning: 'MANUAL',
      gridColumnCount: 2,
      gridRowCount: 2
    })
    expect(grid.gridColumnSizes).toEqual([
      { type: 'FLEX', value: 1 },
      { type: 'FIXED', value: 240 }
    ])
    expect(grid.gridRowSizes).toEqual([
      { type: 'FIXED', value: 80 },
      { type: 'FLEX', value: 1 }
    ])

    const auto = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="grid" class="grid grid-flow-row grid-cols-2 w-[480px] h-[320px]"></div>'
    }
    await applyCanvas(auto)
    expect(grid).toMatchObject({
      gridAutoTracks: 'ROWS',
      gridItemsPositioning: 'ROW_AUTO_FLOW'
    })
    await expect(applyCanvas(auto)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('applies grid row auto-flow and can switch back to manual placement', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="grid" class="grid grid-flow-row grid-cols-2 w-[480px] h-[320px] gap-[12px]">
          <div data-key="wide" class="w-full h-full col-span-2"></div>
          <div data-key="item" class="w-full h-full"></div>
        </div>
      `
    })
    const grid = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const wide = fixture.getNode(created.nodeIdsByKey.wide ?? '')

    expect(grid).toMatchObject({
      layoutMode: 'GRID',
      gridColumnCount: 2,
      gridItemsPositioning: 'ROW_AUTO_FLOW',
      gridAutoTracks: 'ROWS',
      gridRowGap: 12,
      gridColumnGap: 12
    })
    expect(wide.gridColumnSpan).toBe(2)

    const manual = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="grid" class="grid grid-flow-none grid-cols-2 grid-rows-2 w-[480px] h-[320px] gap-[12px]">
          <div data-key="wide" class="w-full h-full col-start-1 row-start-2 col-span-2"></div>
          <div data-key="item" class="w-full h-full col-start-1 row-start-1"></div>
        </div>
      `
    }
    await applyCanvas(manual)

    expect(grid).toMatchObject({
      gridItemsPositioning: 'MANUAL',
      gridAutoTracks: 'NONE',
      gridRowCount: 2
    })
    expect(wide).toMatchObject({
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 0,
      gridColumnSpan: 2
    })
    await expect(applyCanvas(manual)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('applies extended auto-layout state and removes optional bounds and positioning', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div
          data-key="root"
          class="flex flex-row flex-wrap content-between box-border overflow-hidden w-[400px] h-[240px] gap-x-[8px] gap-y-[12px]"
        >
          <span data-key="one" class="grow w-fit h-fit min-w-[80px] max-w-[160px]">One</span>
          <span data-key="two" class="grow w-fit h-fit min-w-[1px]">Two</span>
          <div data-key="badge" class="absolute left-[16px] top-[20px] w-[24px] h-[24px]"></div>
        </div>
      `
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const one = fixture.getNode(created.nodeIdsByKey.one ?? '')
    const two = fixture.getNode(created.nodeIdsByKey.two ?? '')
    const badge = fixture.getNode(created.nodeIdsByKey.badge ?? '')

    expect(root).toMatchObject({
      layoutWrap: 'WRAP',
      itemSpacing: 8,
      counterAxisSpacing: 12,
      counterAxisAlignContent: 'SPACE_BETWEEN',
      strokesIncludedInLayout: true,
      clipsContent: true
    })
    expect(one).toMatchObject({
      layoutGrow: 1,
      minWidth: 80,
      maxWidth: 160
    })
    expect(two.layoutGrow).toBe(1)
    expect(badge).toMatchObject({
      layoutPositioning: 'ABSOLUTE',
      x: 16,
      y: 20
    })

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div
          data-key="root"
          class="flex flex-row flex-nowrap content-normal box-content overflow-visible w-[400px] h-[240px] gap-[8px]"
        >
          <span data-key="one" class="grow w-fit h-fit min-w-none max-w-none">One</span>
          <span data-key="two" class="grow w-fit h-fit min-w-[1px]">Two</span>
          <div data-key="badge" class="static w-[24px] h-[24px]"></div>
        </div>
      `
    })

    expect(root).toMatchObject({
      layoutWrap: 'NO_WRAP',
      counterAxisAlignContent: 'AUTO',
      strokesIncludedInLayout: false,
      clipsContent: false
    })
    expect(one).toMatchObject({ minWidth: null, maxWidth: null })
    expect(badge.layoutPositioning).toBe('AUTO')
  })

  it('validates a growing primitive frame by its effective fill size', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="row" class="flex flex-row w-[240px] h-[24px]"><div data-key="row/track" class="grow w-fit h-[4px] bg-[#2563EB] rounded-full"></div></div>'
    })

    const track = fixture.getNode(created.nodeIdsByKey['row/track']!)
    expect(track).toMatchObject({
      layoutGrow: 1,
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'FIXED',
      height: 4
    })
  })

  it('reconciles against live state, skips an unchanged result, and preserves omissions', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const unmanaged = fixture.createNode('RECTANGLE')
    root.insertChild(0, unmanaged)

    const update: CanvasResolvedApplyParameters = {
      ...createSpec(),
      mode: 'update',
      targetNodeId: created.rootNodeId
    }
    const unchanged = await applyCanvas(update)
    expect(unchanged.mutationCount).toBe(0)
    expect(unchanged.createdNodeIds).toEqual([])
    expect(unchanged.updatedNodeIds).toEqual([])
    expect(root.children).toContain(unmanaged)
    expect(root.children[0]).toBe(unmanaged)

    const changed = await applyCanvas({
      ...createSpec('Updated'),
      mode: 'update',
      targetNodeId: created.rootNodeId
    })
    expect(changed.mutationCount).toBe(1)
    expect(changed.updatedNodeIds).toEqual([created.nodeIdsByKey['card/title']])
    expect(root.children).toContain(unmanaged)
    expect(root.children[0]).toBe(unmanaged)
    expect(
      (fixture.getNode(created.nodeIdsByKey['card/title'] ?? '') as unknown as TextNode).characters
    ).toBe('Updated')
  })

  it('preserves an existing keyed shape type when an update omits its native declaration', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="route" class="w-[100px] h-[0px] border-[2px] border-[#334455]"></div></div>',
      bindings: {
        route: { figma: { shape: { type: 'LINE' } } }
      }
    })
    const route = fixture.getNode(created.nodeIdsByKey.route!)

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="route" class="w-[140px] h-[0px]"></div></div>'
    })

    expect(updated.createdNodeIds).toEqual([])
    expect(updated.nodeIdsByKey.route).toBe(route.id)
    expect(route).toMatchObject({ type: 'LINE', width: 140, height: 0, strokeWeight: 2 })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="route" class="w-[140px] h-[0px]"></div></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preserves existing keyed component types when a layout update omits native declarations', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="set" class="flex flex-col w-[280px] h-[128px] p-[16px] gap-[8px]"><div data-key="set/completed" class="w-[248px] h-[44px]"></div><div data-key="set/pending" class="w-[248px] h-[44px]"></div></div>',
      bindings: {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        'set/completed': {
          figma: { name: 'State=Completed', component: { type: 'COMPONENT' } }
        },
        'set/pending': {
          figma: { name: 'State=Pending', component: { type: 'COMPONENT' } }
        }
      }
    })
    const set = fixture.getNode(created.rootNodeId)
    const completed = fixture.getNode(created.nodeIdsByKey['set/completed']!)
    const pending = fixture.getNode(created.nodeIdsByKey['set/pending']!)

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="set" class="flex flex-col w-[300px] h-[128px] p-[16px] gap-[8px]"><div data-key="set/completed" class="w-[268px] h-[44px]"></div><div data-key="set/pending" class="w-[268px] h-[44px]"></div></div>'
    })

    expect(updated.createdNodeIds).toEqual([])
    expect(updated.removedNodeIds).toEqual([])
    expect(updated.nodeIdsByKey).toMatchObject({
      set: set.id,
      'set/completed': completed.id,
      'set/pending': pending.id
    })
    expect(set).toMatchObject({ type: 'COMPONENT_SET', width: 300 })
    expect(completed).toMatchObject({ type: 'COMPONENT', width: 268 })
    expect(pending).toMatchObject({ type: 'COMPONENT', width: 268 })
  })

  it('reorders existing children without replacing their stable identities', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[120px] h-[40px]"><div data-key="a" class="w-[40px] h-[40px]"></div><div data-key="b" class="w-[40px] h-[40px]"></div></div>'
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const a = fixture.getNode(created.nodeIdsByKey.a!)
    const b = fixture.getNode(created.nodeIdsByKey.b!)

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: root.id,
      markup:
        '<div data-key="root" class="flex flex-row w-[120px] h-[40px]"><div data-key="b" class="w-[40px] h-[40px]"></div><div data-key="a" class="w-[40px] h-[40px]"></div></div>'
    })

    expect(root.children).toEqual([b, a])
    expect(updated.createdNodeIds).toEqual([])
    expect(updated.removedNodeIds).toEqual([])

    root.insertChild(0, a)
    root.insertChild = (index: number, child: SceneNode) => {
      const mutable = child as SceneNode & { parent: BaseNode | null }
      const mutableChildren = root.children as SceneNode[]
      const current = mutableChildren.indexOf(child)
      if (current >= 0) mutableChildren.splice(current, 1)
      if (index > mutableChildren.length) throw new RangeError('child index is out of range')
      mutableChildren.splice(index, 0, child)
      mutable.parent = root
    }

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup:
          '<div data-key="root" class="flex flex-row w-[120px] h-[40px]"><div data-key="b" class="w-[40px] h-[40px]"></div><div data-key="a" class="w-[40px] h-[40px]"></div></div>'
      })
    ).resolves.toMatchObject({ createdNodeIds: [], removedNodeIds: [] })
    expect(root.children).toEqual([b, a])
  })

  it('uses the Canvas overflow-visible default for frames first introduced by an update', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    transformNextFrame(fixture, (node) => {
      ;(node as unknown as FrameNode).clipsContent = true
    })

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="w-[320px] h-[200px]"><div data-key="root/actions" class="absolute left-[0px] top-[0px] w-[230px] h-[28px]"></div></div>'
    })

    expect(fixture.getNode(updated.nodeIdsByKey['root/actions']!)).toMatchObject({
      clipsContent: false
    })
  })

  it('names nodes first introduced by an update without renaming existing nodes', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    root.name = 'Manual root name'

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="root/new-child" class="w-full h-[40px]"></div></div>'
    })

    expect(root.name).toBe('Manual root name')
    expect(fixture.getNode(updated.nodeIdsByKey['root/new-child']!)).toMatchObject({
      name: 'root/new-child'
    })
  })

  it('preserves live fields omitted from incremental updates', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div
          data-key="root"
          class="flex flex-col w-[320px] h-[200px] min-w-[240px] max-w-[480px] gap-[10px] p-[12px] overflow-hidden opacity-[0.65]"
        >
          <span
            data-key="copy"
            class="w-full h-fit font-bold text-[22px] leading-[30px] tracking-[1px] text-right opacity-[0.4]"
          >Hello</span>
        </div>
      `,
      bindings: {
        copy: { figma: { text: { verticalAlign: 'BOTTOM' } } }
      }
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
    root.name = 'Manual root name'
    copy.name = 'Manual copy name'

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    expect(root).toMatchObject({
      name: 'Manual root name',
      layoutMode: 'VERTICAL',
      itemSpacing: 10,
      paddingTop: 12,
      minWidth: 240,
      maxWidth: 480,
      clipsContent: true,
      opacity: 0.65
    })
    expect(root.children).toContain(copy)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Hello</span></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    expect(root).toMatchObject({
      name: 'Manual root name',
      itemSpacing: 10,
      paddingTop: 12,
      minWidth: 240,
      maxWidth: 480,
      clipsContent: true,
      opacity: 0.65
    })
    expect(copy).toMatchObject({
      name: 'Manual copy name',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 22,
      lineHeight: { unit: 'PIXELS', value: 30 },
      letterSpacing: { unit: 'PIXELS', value: 1 },
      textAlignHorizontal: 'RIGHT',
      textAlignVertical: 'BOTTOM',
      opacity: 0.4
    })
  })

  it('removes only explicitly keyed owned subtrees and makes retries a no-op', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="keep" class="w-full h-fit">Keep</span>
          <div data-key="obsolete" class="flex flex-col w-full h-[80px]">
            <span data-key="obsolete/copy" class="w-full h-fit">Remove</span>
          </div>
        </div>
      `
    })
    const obsolete = fixture.getNode(created.nodeIdsByKey.obsolete!)
    const obsoleteCopyId = created.nodeIdsByKey['obsolete/copy']!
    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="keep" class="w-full h-fit">Keep</span>
        </div>
      `,
      removeKeys: ['obsolete']
    }

    await expect(applyCanvas(update)).resolves.toMatchObject({
      removedNodeIds: [obsolete.id],
      mutationCount: 1
    })
    expect(obsolete.removed).toBe(true)
    expect(fixture.nodes.has(obsoleteCopyId)).toBe(false)
    await expect(applyCanvas(update)).resolves.toMatchObject({
      removedNodeIds: [],
      mutationCount: 0
    })
  })

  it('moves a desired keyed descendant out before removing its old parent', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <div data-key="obsolete" class="flex flex-col w-full h-[80px]">
            <span data-key="rescue" class="w-full h-fit">Keep me</span>
          </div>
        </div>
      `
    })
    const rescue = fixture.getNode(created.nodeIdsByKey.rescue!)

    const result = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="rescue" class="w-full h-fit">Keep me</span>
        </div>
      `,
      removeKeys: ['obsolete']
    })

    expect(result.removedNodeIds).toEqual([created.nodeIdsByKey.obsolete])
    expect(rescue.parent?.id).toBe(created.rootNodeId)
    expect(fixture.nodes.has(rescue.id)).toBe(true)
  })

  it('removes an explicitly absent managed update root and makes retries a no-op', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="copy" class="w-full h-fit">Remove me</span>
        </div>
      `
    })
    const root = fixture.getNode(created.rootNodeId)
    const removal: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: null
    }

    await expect(applyCanvas(removal)).resolves.toEqual({
      rootNodeId: created.rootNodeId,
      rootRemoved: true,
      nodeIdsByKey: {},
      createdNodeIds: [],
      updatedNodeIds: [],
      removedNodeIds: [created.rootNodeId],
      mutationCount: 1,
      verification: {
        status: 'passed',
        nodesChecked: 0,
        referencesChecked: 0,
        nativeFieldsChecked: 0,
        warnings: []
      }
    })
    expect(root.removed).toBe(true)
    expect(fixture.nodes.has(created.nodeIdsByKey.copy!)).toBe(false)
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootNodeId: created.rootNodeId,
      rootRemoved: true,
      removedNodeIds: [],
      mutationCount: 0
    })
  })

  it('does not reload the already accessible current page before removal', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    PAGE.loadAsync.mockRejectedValue(new Error('current page is already loaded'))

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: null
      })
    ).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId]
    })
    expect(PAGE.loadAsync).not.toHaveBeenCalled()
    expect(fixture.nodes.has(created.rootNodeId)).toBe(false)
  })

  it('removes a component set when async lookup returns a stale attached snapshot', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="set" class="flex flex-row w-[280px] h-[80px]"><div data-key="variant" class="w-[120px] h-[40px]"></div></div>',
      native: {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        variant: {
          figma: { name: 'State=Default', component: { type: 'COMPONENT' } }
        }
      }
    })
    const root = fixture.getNode(created.rootNodeId)
    const stale = { ...root, removed: false } as unknown as BaseNode
    vi.mocked(figma.getNodeByIdAsync).mockImplementation(async (id: string) =>
      id === root.id ? (root.removed ? stale : root) : (fixture.nodes.get(id) ?? null)
    )

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        markup: null
      })
    ).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [root.id]
    })
  })

  it('does not read variant-only component properties while validating unrelated removal', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="set" class="flex flex-row w-[200px] h-[80px]"><div data-key="variant" class="w-[120px] h-[40px]"></div></div>',
      native: {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        variant: {
          figma: {
            name: 'State=Default',
            component: { type: 'COMPONENT' }
          }
        }
      }
    })
    const variant = fixture.getNode(authored.nodeIdsByKey.variant!)
    Object.defineProperty(variant, 'componentPropertyDefinitions', {
      configurable: true,
      get: () => {
        throw new Error('Variant definitions belong to the component set')
      }
    })
    const removable = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="temporary" class="w-[240px] h-[24px]"></div>'
    })

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: removable.rootNodeId,
        markup: null
      })
    ).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [removable.rootNodeId]
    })
    expect(variant.removed).toBe(false)
  })

  it('rejects update-root removal when its subtree is not fully managed', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const manual = fixture.createNode('RECTANGLE')
    root.insertChild(0, manual)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: null
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('not owned')
    })
    expect(root.removed).toBe(false)
    expect(manual.removed).toBe(false)
  })

  it('protects update roots used by live Pattern paints on nodes and styles', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[32px] h-[32px]"></div>'
    })
    const pattern: PatternPaint = {
      type: 'PATTERN',
      sourceNodeId: created.rootNodeId,
      tileType: 'RECTANGULAR',
      scalingFactor: 1,
      spacing: { x: 0, y: 0 },
      horizontalAlignment: 'START'
    }
    const consumer = fixture.createNode('RECTANGLE')
    consumer.fills = [pattern]
    const removal: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: null
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still referenced outside')
    })

    consumer.fills = []
    const style = figma.createPaintStyle()
    style.paints = [pattern]
    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still referenced outside')
    })

    style.remove()
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId]
    })
  })

  it('protects update roots used by live rich-text node hyperlinks', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[32px] h-[32px]"></div>'
    })
    const copy = fixture.createNode('TEXT') as unknown as TextNode
    copy.characters = 'Open'
    copy.setRangeHyperlink(0, 4, {
      type: 'NODE',
      value: created.rootNodeId
    })
    const removal: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: null
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still referenced outside')
    })

    copy.setRangeHyperlink(0, 4, null)
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId]
    })
  })

  it('protects component roots used by surviving component or shader references', async () => {
    createFixture()
    const target = figma.createComponent()
    target.setSharedPluginData('tempad_dev', 'canvas-key', 'target')
    const consumer = figma.createComponent()
    const property = consumer.addComponentProperty('Swap', 'INSTANCE_SWAP', target.id, {
      preferredValues: [{ type: 'COMPONENT', key: target.key }]
    })
    const removal: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: target.id,
      markup: null
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still referenced outside')
    })

    consumer.deleteComponentProperty(property)
    const shaderNode = figma.createRectangle()
    shaderNode.effects = [
      {
        type: 'SHADER',
        id: 'shader:effect',
        visible: true,
        properties: { swap: target.id }
      }
    ]
    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still referenced outside')
    })

    shaderNode.effects = []
    const shaderStyle = figma.createEffectStyle()
    shaderStyle.effects = [
      {
        type: 'SHADER',
        id: 'shader:effect',
        visible: true,
        properties: { swap: target.key }
      }
    ]
    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still referenced outside')
    })

    shaderStyle.remove()
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [target.id]
    })
  })

  it('allows a referenced descendant and its managed Paint style to be removed together', async () => {
    const fixture = createFixture()
    const markup = `
      <div data-key="root" class="flex flex-row w-[320px] h-[200px]">
        <div data-key="source" class="w-[80px] h-[80px]"></div>
        <div data-key="keep" class="w-[80px] h-[80px]"></div>
      </div>
    `
    const created = await applyCanvas({ mode: 'create', markup })
    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      styles: {
        pattern: {
          type: 'PAINT',
          name: 'Pattern',
          paints: [
            {
              type: 'PATTERN',
              sourceCanvasKey: 'source',
              tileType: 'RECTANGULAR',
              scalingFactor: 1,
              spacing: { x: 0, y: 0 },
              horizontalAlignment: 'START'
            }
          ]
        }
      }
    })
    const style = [...fixture.styles.values()].find(
      (candidate) => candidate.getSharedPluginData('tempad_dev', 'style-key') === 'pattern'
    )!

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `
          <div data-key="root" class="flex flex-row w-[320px] h-[200px]">
            <div data-key="keep" class="w-[80px] h-[80px]"></div>
          </div>
        `,
        removeKeys: ['source'],
        styles: { pattern: null }
      })
    ).resolves.toMatchObject({
      removedNodeIds: [created.nodeIdsByKey.source]
    })
    expect(fixture.nodes.has(created.nodeIdsByKey.source!)).toBe(false)
    expect(fixture.styles.has(style.id)).toBe(false)
  })

  it('rejects root, unowned-subtree, and invalid intrinsic-container removal', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="w-[320px] h-[200px]">
          <div data-key="owned" class="absolute left-[0px] top-[0px] w-[80px] h-[80px]"></div>
        </div>
      `
    })
    const owned = fixture.getNode(created.nodeIdsByKey.owned!)
    const manual = fixture.createNode('RECTANGLE')
    owned.insertChild(0, manual)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['owned']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('not owned')
    })
    expect(manual.removed).toBe(false)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="replacement" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['root']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('root cannot be removed')
    })

    const operation = fixture.createNode('BOOLEAN_OPERATION')
    const left = fixture.createNode('RECTANGLE')
    const right = fixture.createNode('RECTANGLE')
    operation.setSharedPluginData('tempad_dev', 'canvas-key', 'operation')
    left.setSharedPluginData('tempad_dev', 'canvas-key', 'left')
    right.setSharedPluginData('tempad_dev', 'canvas-key', 'right')
    operation.insertChild(0, left)
    operation.insertChild(1, right)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    root.insertChild(1, operation)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['left']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('at least two remaining operands')
    })
    expect(left.removed).toBe(false)
  })

  it('does not remove a component while an instance survives outside the removal scope', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const component = fixture.createNode('COMPONENT')
    const instance = fixture.createNode('INSTANCE')
    root.setSharedPluginData('tempad_dev', 'canvas-key', 'root')
    component.setSharedPluginData('tempad_dev', 'canvas-key', 'component')
    root.insertChild(0, component)
    instance.mainComponent = component as unknown as ComponentNode

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        removeKeys: ['component']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('instances outside the removal scope')
    })
    expect(component.removed).toBe(false)
    expect(instance.removed).toBe(false)
  })

  it('requires the final sibling result when removal changes a native mask scope', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[300px] h-[100px]">
          <div data-key="mask" class="w-[100px] h-[100px]"></div>
          <div data-key="remove" class="w-[100px] h-[100px]"></div>
          <div data-key="remain" class="w-[100px] h-[100px]"></div>
        </div>
      `,
      bindings: {
        mask: { figma: { mask: 'ALPHA' } }
      }
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="flex flex-row w-[300px] h-[100px]"></div>',
        removeKeys: ['remove']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('requires every remaining sibling')
    })

    const result = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: `
        <div data-key="root" class="flex flex-row w-[300px] h-[100px]">
          <div data-key="mask" class="w-[100px] h-[100px]"></div>
          <div data-key="remain" class="w-[100px] h-[100px]"></div>
        </div>
      `,
      bindings: {
        mask: { figma: { mask: 'ALPHA' } }
      },
      removeKeys: ['remove']
    })

    expect(result.removedNodeIds).toEqual([created.nodeIdsByKey.remove])
    expect(
      (fixture.getNode(created.rootNodeId) as unknown as FrameNode).children.map(
        (child) => child.id
      )
    ).toEqual([created.nodeIdsByKey.mask, created.nodeIdsByKey.remain])
  })

  it('treats independent corner-radius bindings as unchanged', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="card" class="flex flex-col w-[320px] h-[200px] p-[8px] rounded-[8px]"></div>',
      bindings: {
        card: {
          variables: { cornerRadius: { id: 'variable:spacing' } }
        }
      }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode

    expect([root.paddingTop, root.paddingRight, root.paddingBottom, root.paddingLeft]).toEqual([
      8, 8, 8, 8
    ])

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })
  })

  it('binds min/max sizing and wrapped counter-axis spacing variables', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px] gap-[8px]"></div>',
      bindings: {
        root: {
          variables: {
            minWidth: { id: 'variable:spacing' },
            maxHeight: { id: 'variable:spacing' },
            counterAxisSpacing: { id: 'variable:spacing' }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode

    expect(root.boundVariables).toMatchObject({
      minWidth: { id: 'variable:spacing' },
      maxHeight: { id: 'variable:spacing' },
      counterAxisSpacing: { id: 'variable:spacing' }
    })
    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('binds all supported whole-node text and visibility variables', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit hidden font-semibold">Literal</span></div>',
      bindings: {
        copy: {
          variables: {
            characters: { id: 'variable:font' },
            visible: { id: 'variable:visible' },
            strokeWeight: { id: 'variable:spacing' },
            fontWeight: { id: 'variable:spacing' },
            paragraphIndent: { id: 'variable:spacing' },
            paragraphSpacing: { id: 'variable:spacing' }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    expect(copy.characters).toBe('')
    expect(copy.visible).toBe(true)
    expect(copy.boundVariables).toMatchObject({
      characters: { id: 'variable:font' },
      visible: { id: 'variable:visible' },
      strokeWeight: { id: 'variable:spacing' },
      fontWeight: { id: 'variable:spacing' },
      paragraphIndent: { id: 'variable:spacing' },
      paragraphSpacing: { id: 'variable:spacing' }
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit visible font-semibold">Changed</span></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(copy.characters).toBe('')
    expect(copy.visible).toBe(true)
  })

  it('applies an unbound font field when the other field uses a variable', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="root/title" class="w-full h-fit font-semibold">Title</span></div>',
      bindings: {
        'root/title': {
          variables: {
            fontFamily: { id: 'variable:font' }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const title = fixture.getNode(created.nodeIdsByKey['root/title'] ?? '') as unknown as TextNode

    expect(title.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' })
    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('explicitly unbinds node, text, and solid-paint variables before applying literals', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-[8px] bg-[#FFFFFF] hidden"><span data-key="copy" class="w-fit h-fit">Initial</span></div>',
      bindings: {
        root: {
          variables: {
            fill: { key: 'color-key' },
            gap: { id: 'variable:spacing' },
            visible: { id: 'variable:visible' }
          }
        },
        copy: {
          variables: {
            characters: { id: 'variable:font' }
          }
        }
      }
    })
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    const unbound: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup:
        '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-[12px] bg-[#000000] hidden"><span data-key="copy" class="w-fit h-fit">Changed</span></div>',
      bindings: {
        root: {
          variables: {
            fill: null,
            gap: null,
            visible: null
          }
        },
        copy: {
          variables: {
            characters: null
          }
        }
      }
    }
    await applyCanvas(unbound)

    expect(root.boundVariables).not.toHaveProperty('fills')
    expect(root.boundVariables).not.toHaveProperty('itemSpacing')
    expect(root.boundVariables).not.toHaveProperty('visible')
    expect(root.itemSpacing).toBe(12)
    expect(root.visible).toBe(false)
    expect(root.fills).toMatchObject([
      {
        type: 'SOLID',
        color: { r: 0, g: 0, b: 0 }
      }
    ])
    expect(copy.boundVariables).not.toHaveProperty('characters')
    expect(copy.characters).toBe('Changed')
    await expect(applyCanvas(unbound)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('does not unlink a Paint style while clearing its paint variable', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] border-[1px] border-[#000000]"></div>',
      bindings: {
        root: {
          styles: {
            stroke: { id: 'style:stroke' }
          }
        }
      }
    })
    const root = fixture.getNode(created.rootNodeId)
    Object.assign(root.boundVariables, {
      strokes: [{ type: 'VARIABLE_ALIAS', id: 'variable:color' }]
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup:
          '<div data-key="root" class="w-[320px] h-[200px] border-[1px] border-[#000000]"></div>',
        bindings: {
          root: {
            variables: {
              stroke: null
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('without replacing the existing Paint style')
    })
    expect(root.strokeStyleId).toBe('style:stroke')
  })

  it('sets, preserves, clears, and preflights explicit variable modes', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
      bindings: {
        root: {
          variableModes: { 'collection:tokens': 'mode:dark' }
        },
        copy: {
          variableModes: { 'collection:tokens': 'mode:light' }
        }
      }
    }
    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '')
    expect(root.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:dark' })
    expect(copy.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:light' })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const cleared: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: input.markup,
      bindings: {
        root: {
          variableModes: { 'collection:tokens': null }
        }
      }
    }
    await applyCanvas(cleared)
    expect(root.explicitVariableModes).toEqual({})
    expect(copy.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:light' })
    await expect(applyCanvas(cleared)).resolves.toMatchObject({ mutationCount: 0 })

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="invalid" class="w-[320px] h-[200px]"></div>',
        bindings: {
          invalid: {
            variableModes: { 'collection:tokens': 'mode:missing' }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('has no mode')
    })
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="invalid" class="w-[320px] h-[200px]"></div>',
        bindings: {
          invalid: {
            variableModes: { 'collection:missing': 'mode:dark' }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('could not be resolved')
    })
    expect(figma.createFrame).toHaveBeenCalledTimes(1)
  })

  it('authors reusable local variables and binds them in the same declarative result', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="token-card" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: {
            light: { name: 'Light' },
            dark: { name: 'Dark' }
          },
          variables: {
            surface: {
              name: 'Color/Surface',
              type: 'COLOR',
              description: 'Default surface',
              scopes: ['ALL_FILLS'],
              codeSyntax: { WEB: '--color-surface' },
              values: {
                light: { r: 1, g: 1, b: 1 },
                dark: { variable: { variableKey: 'tokens' } }
              }
            },
            tokens: {
              name: 'Color/Surface Dark',
              type: 'COLOR',
              values: {
                light: { r: 0.1, g: 0.1, b: 0.1 },
                dark: { r: 0, g: 0, b: 0, a: 1 }
              }
            }
          }
        }
      },
      page: {
        variableModes: { tokens: 'dark' }
      },
      bindings: {
        'token-card': {
          variables: {
            fill: { variableKey: 'surface' }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const collection = [...fixture.variableCollections.values()].find(
      (candidate) =>
        typeof candidate.getSharedPluginData === 'function' &&
        candidate.getSharedPluginData('tempad_dev', 'variable-collection-key') === 'tokens'
    )!
    const surface = [...fixture.variables.values()].find(
      (candidate) =>
        typeof candidate.getSharedPluginData === 'function' &&
        candidate.getSharedPluginData('tempad_dev', 'variable-key') === 'surface'
    )!
    const surfaceDark = [...fixture.variables.values()].find(
      (candidate) =>
        typeof candidate.getSharedPluginData === 'function' &&
        candidate.getSharedPluginData('tempad_dev', 'variable-key') === 'tokens'
    )!
    const darkMode = collection.modes.find((mode) => mode.name === 'Dark')!
    const root = fixture.getNode(created.rootNodeId)

    expect(surface).toMatchObject({
      name: 'Color/Surface',
      description: 'Default surface',
      scopes: ['ALL_FILLS'],
      codeSyntax: { WEB: '--color-surface' }
    })
    expect(surface.valuesByMode[darkMode.modeId]).toEqual({
      type: 'VARIABLE_ALIAS',
      id: surfaceDark.id
    })
    expect(root.boundVariables.fills).toEqual([{ type: 'VARIABLE_ALIAS', id: surface.id }])
    expect(PAGE.explicitVariableModes).toEqual({
      [collection.id]: darkMode.modeId
    })
    expect(created.verification.status).toBe('passed')

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: input.markup,
      variableCollections: {
        tokens: {
          modes: {
            contrast: { name: 'High Contrast' }
          },
          variables: {
            surface: {
              values: {
                contrast: { r: 1, g: 1, b: 0 }
              }
            }
          }
        }
      },
      page: {
        variableModes: { tokens: 'contrast' }
      }
    })
    const contrastMode = collection.modes.find((mode) => mode.name === 'High Contrast')!
    expect(surface.valuesByMode[contrastMode.modeId]).toEqual({ r: 1, g: 1, b: 0 })
    expect(surfaceDark.valuesByMode[contrastMode.modeId]).toEqual(
      surfaceDark.valuesByMode[collection.defaultModeId]
    )
    expect(PAGE.explicitVariableModes).toEqual({
      [collection.id]: contrastMode.modeId
    })
  })

  it('identifies an unresolved variable authoring key', async () => {
    createFixture()

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>',
        bindings: {
          root: {
            variables: {
              fill: { variableKey: 'product/color/surafce' }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: 'Variable authoring key "product/color/surafce" could not be resolved.'
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('warns when a newly authored variable has no representative binding', async () => {
    createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-[16px]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { default: { name: 'Default' } },
          variables: {
            'space/md': {
              name: 'Spacing/Medium',
              type: 'FLOAT',
              scopes: ['GAP'],
              values: { default: 16 }
            }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    expect(created.verification).toMatchObject({
      status: 'warning',
      warnings: [
        {
          code: 'unbound-created-variable',
          key: 'space/md',
          message: expect.stringContaining('representative node or style')
        }
      ]
    })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({
      verification: { status: 'passed', warnings: [] }
    })
  })

  it('warns when an authored variable overrides a mismatched literal fallback', async () => {
    createFixture()

    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-[14px]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { default: { name: 'Default' } },
          variables: {
            'space/md': {
              name: 'Spacing/Medium',
              type: 'FLOAT',
              scopes: ['GAP'],
              values: { default: 16 }
            }
          }
        }
      },
      bindings: {
        root: {
          variables: { gap: { variableKey: 'space/md' } }
        }
      }
    })

    expect(created.verification).toMatchObject({
      status: 'warning',
      warnings: [
        {
          code: 'variable-fallback-mismatch',
          key: 'root',
          message: expect.stringContaining('gap 14')
        }
      ]
    })
  })

  it('accepts a literal fallback matching any authored variable mode', async () => {
    createFixture()

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-[14px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { compact: { name: 'Compact' }, roomy: { name: 'Roomy' } },
            variables: {
              'space/md': {
                name: 'Spacing/Medium',
                type: 'FLOAT',
                scopes: ['GAP'],
                values: { compact: 14, roomy: 16 }
              }
            }
          }
        },
        bindings: {
          root: {
            variables: { gap: { variableKey: 'space/md' } }
          }
        }
      })
    ).resolves.toMatchObject({
      verification: { status: 'passed', warnings: [] }
    })
  })

  it('checks literal fallbacks through same-call variable aliases', async () => {
    createFixture()

    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-[14px]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { default: { name: 'Default' } },
          variables: {
            'space/primitive': {
              name: 'Spacing/Primitive',
              type: 'FLOAT',
              values: { default: 16 }
            },
            'space/semantic': {
              name: 'Spacing/Semantic',
              type: 'FLOAT',
              scopes: ['GAP'],
              values: { default: { variable: { variableKey: 'space/primitive' } } }
            }
          }
        }
      },
      bindings: {
        root: {
          variables: { gap: { variableKey: 'space/semantic' } }
        }
      }
    })

    expect(created.verification.warnings).toEqual([
      expect.objectContaining({
        code: 'variable-fallback-mismatch',
        key: 'root',
        message: expect.stringContaining('space/semantic')
      })
    ])
  })

  it('compares authored color variables with literal paint fallbacks', async () => {
    createFixture()

    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { default: { name: 'Default' } },
          variables: {
            'color/surface': {
              name: 'Color/Surface',
              type: 'COLOR',
              scopes: ['ALL_FILLS'],
              values: { default: { r: 0, g: 0, b: 0 } }
            }
          }
        }
      },
      bindings: {
        root: {
          variables: { fill: { variableKey: 'color/surface' } }
        }
      }
    })

    expect(created.verification.warnings).toEqual([
      expect.objectContaining({
        code: 'variable-fallback-mismatch',
        key: 'root',
        message: expect.stringContaining('fill #FFFFFF')
      })
    ])
  })

  it('explains that variable authoring keys are file-wide across collections', async () => {
    createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        'product/theme': {
          name: 'Theme',
          modes: { light: { name: 'Light' } },
          variables: {
            'product/color/surface': {
              name: 'Color/Surface',
              type: 'COLOR',
              values: { light: { r: 1, g: 1, b: 1 } }
            }
          }
        }
      }
    })

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="other" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          'marketing/theme': {
            name: 'Marketing',
            modes: { light: { name: 'Light' } },
            variables: {
              'product/color/surface': {
                name: 'Color/Surface',
                type: 'COLOR',
                values: { light: { r: 0, g: 0, b: 0 } }
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('Authoring keys are file-wide')
    })
  })

  it('removes managed variables and modes after clearing node, page, and inherited-mode consumers', async () => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: {
            light: { name: 'Light' },
            dark: { name: 'Dark' }
          },
          variables: {
            surface: {
              name: 'Color/Surface',
              type: 'COLOR',
              values: {
                light: { r: 1, g: 1, b: 1 },
                dark: { r: 0, g: 0, b: 0 }
              }
            },
            spacing: {
              name: 'Spacing/Base',
              type: 'FLOAT',
              values: { light: 8, dark: 12 }
            },
            surfaceAlias: {
              name: 'Color/Surface Alias',
              type: 'COLOR',
              values: {
                light: { r: 0.5, g: 0.5, b: 0.5 },
                dark: { variable: { variableKey: 'surface' } }
              }
            }
          }
        },
        brand: {
          name: 'Brand',
          extends: { collectionKey: 'tokens' }
        }
      },
      page: { variableModes: { tokens: 'dark' } },
      bindings: {
        root: { variables: { fill: { variableKey: 'surface' } } }
      }
    })
    const collectionByKey = (key: string) =>
      [...fixture.variableCollections.values()].find(
        (collection) =>
          typeof collection.getSharedPluginData === 'function' &&
          collection.getSharedPluginData('tempad_dev', 'variable-collection-key') === key
      )!
    const tokens = collectionByKey('tokens')
    const brand = collectionByKey('brand') as unknown as ExtendedVariableCollection
    const surface = [...fixture.variables.values()].find(
      (variable) =>
        typeof variable.getSharedPluginData === 'function' &&
        variable.getSharedPluginData('tempad_dev', 'variable-key') === 'surface'
    )!
    const surfaceAlias = [...fixture.variables.values()].find(
      (variable) =>
        typeof variable.getSharedPluginData === 'function' &&
        variable.getSharedPluginData('tempad_dev', 'variable-key') === 'surfaceAlias'
    )!
    const darkMode = tokens.modes.find((mode) => mode.name === 'Dark')!
    const inheritedDarkMode = brand.modes.find((mode) => mode.name === 'Dark')!
    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      variableCollections: {
        tokens: {
          modes: { dark: null },
          variables: { surface: null }
        }
      },
      page: { variableModes: { tokens: null } },
      bindings: { root: { variables: { fill: null } } }
    }

    await expect(
      applyCanvas({
        ...update,
        page: undefined,
        bindings: undefined
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still selected')
    })

    await applyCanvas(update)

    expect(fixture.variables.has(surface.id)).toBe(false)
    expect(tokens.modes).not.toContainEqual(darkMode)
    expect(brand.modes).not.toContainEqual(inheritedDarkMode)
    expect(surfaceAlias.valuesByMode).toEqual({
      [tokens.defaultModeId]: { r: 0.5, g: 0.5, b: 0.5 }
    })
    expect(PAGE.explicitVariableModes).toEqual({})
    expect(fixture.getNode(created.rootNodeId).boundVariables.fills).toBeUndefined()
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup,
        variableCollections: {
          tokens: { modes: { light: null } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('must retain at least one mode')
    })
  })

  it('creates a variable without requiring a value for a mode removed in the same patch', async () => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: {
            light: { name: 'Light' },
            dark: { name: 'Dark' }
          },
          variables: {
            existing: {
              name: 'Existing',
              type: 'FLOAT',
              values: { light: 4, dark: 8 }
            }
          }
        }
      }
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup,
        variableCollections: {
          tokens: {
            modes: { dark: null },
            variables: {
              added: {
                name: 'Added',
                type: 'FLOAT',
                values: { light: 12 }
              }
            }
          }
        }
      })
    ).resolves.toMatchObject({ rootNodeId: created.rootNodeId })

    const collection = [...fixture.variableCollections.values()].find(
      (candidate) =>
        candidate.getSharedPluginData?.('tempad_dev', 'variable-collection-key') === 'tokens'
    )!
    const added = [...fixture.variables.values()].find(
      (candidate) => candidate.getSharedPluginData?.('tempad_dev', 'variable-key') === 'added'
    )!
    expect(collection.modes.map((mode) => mode.name)).toEqual(['Light'])
    expect(added.valuesByMode).toEqual({ [collection.defaultModeId]: 12 })
  })

  it('inspects variable removal without reading property definitions from variants', async () => {
    const fixture = createFixture()
    const componentSet = fixture.createNode('COMPONENT_SET')
    const variant = fixture.createNode('COMPONENT')
    componentSet.appendChild(variant)
    Object.defineProperty(variant, 'componentPropertyDefinitions', {
      configurable: true,
      get: () => {
        throw new Error('Property definitions are unavailable on a variant component.')
      }
    })
    PAGE.appendChild(componentSet)

    const markup =
      '<div data-key="root" class="flex flex-row w-[100px] h-[100px] gap-[16px]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { default: { name: 'Default' } },
          variables: {
            spacing: {
              name: 'Spacing/Base',
              type: 'FLOAT',
              values: { default: 16 }
            }
          }
        }
      },
      bindings: {
        root: { variables: { gap: { variableKey: 'spacing' } } }
      }
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup,
        variableCollections: { tokens: null },
        bindings: { root: { variables: { gap: null } } }
      })
    ).resolves.toMatchObject({ verification: { status: 'passed' } })
  })

  it('rejects variable deletion through aliases until the same result replaces them', async () => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { light: { name: 'Light' } },
          variables: {
            base: { name: 'Spacing/Base', type: 'FLOAT', values: { light: 4 } },
            alias: {
              name: 'Spacing/Alias',
              type: 'FLOAT',
              values: { light: { variable: { variableKey: 'base' } } }
            }
          }
        }
      }
    })
    const removeBase: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      variableCollections: {
        tokens: { variables: { base: null } }
      }
    }

    await expect(applyCanvas(removeBase)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still used by variable')
    })

    const replaceAlias: CanvasResolvedApplyParameters = {
      ...removeBase,
      variableCollections: {
        tokens: {
          variables: {
            base: null,
            alias: { values: { light: 8 } }
          }
        }
      }
    }
    await applyCanvas(replaceAlias)
    const alias = [...fixture.variables.values()].find(
      (variable) =>
        typeof variable.getSharedPluginData === 'function' &&
        variable.getSharedPluginData('tempad_dev', 'variable-key') === 'alias'
    )!
    expect(Object.values(alias.valuesByMode)).toEqual([8])
    await expect(applyCanvas(replaceAlias)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects variable deletion through styles until the same result replaces them', async () => {
    createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        colors: {
          name: 'Colors',
          modes: { light: { name: 'Light' } },
          variables: {
            accent: {
              name: 'Color/Accent',
              type: 'COLOR',
              values: { light: { r: 1, g: 0, b: 0 } }
            }
          }
        }
      },
      styles: {
        accent: {
          type: 'PAINT',
          name: 'Color/Accent',
          paints: [
            {
              type: 'SOLID',
              color: { r: 1, g: 0, b: 0 },
              variables: { color: { variableKey: 'accent' } }
            }
          ]
        }
      }
    })
    const removeAccent: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      variableCollections: {
        colors: { variables: { accent: null } }
      }
    }

    await expect(applyCanvas(removeAccent)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still used by style')
    })

    const replaceStyle: CanvasResolvedApplyParameters = {
      ...removeAccent,
      styles: {
        accent: {
          type: 'PAINT',
          paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]
        }
      }
    }
    await applyCanvas(replaceStyle)
    await expect(applyCanvas(replaceStyle)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('removes dependent extended collections before their managed parent', async () => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { light: { name: 'Light' } }
        },
        brand: {
          name: 'Brand',
          extends: { collectionKey: 'tokens' }
        }
      }
    })
    const byKey = (key: string) =>
      [...fixture.variableCollections.values()].find(
        (collection) =>
          typeof collection.getSharedPluginData === 'function' &&
          collection.getSharedPluginData('tempad_dev', 'variable-collection-key') === key
      )!
    const tokens = byKey('tokens')
    const brand = byKey('brand')

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup,
        variableCollections: { tokens: null }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still depends')
    })

    const removeBoth: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup,
      variableCollections: { tokens: null, brand: null }
    }
    await applyCanvas(removeBoth)
    expect(brand.remove).toHaveBeenCalledBefore(tokens.remove as ReturnType<typeof vi.fn>)
    expect(fixture.variableCollections.has(brand.id)).toBe(false)
    expect(fixture.variableCollections.has(tokens.id)).toBe(false)
    await expect(applyCanvas(removeBoth)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('extends local collections and reconciles inherited overrides declaratively', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      variableCollections: {
        brand: {
          name: 'Brand',
          extends: { collectionKey: 'tokens' },
          overrides: [
            {
              variable: { variableKey: 'surface' },
              values: {
                light: { r: 0.9, g: 0.2, b: 0.1 },
                dark: null
              }
            }
          ]
        },
        tokens: {
          name: 'Tokens',
          modes: {
            light: { name: 'Light' },
            dark: { name: 'Dark' }
          },
          variables: {
            surface: {
              name: 'Color/Surface',
              type: 'COLOR',
              values: {
                light: { r: 1, g: 1, b: 1 },
                dark: { r: 0.1, g: 0.1, b: 0.1 }
              }
            }
          }
        }
      },
      page: {
        variableModes: { brand: 'dark' }
      }
    }

    const created = await applyCanvas(input)
    const byKey = (key: string) =>
      [...fixture.variableCollections.values()].find(
        (collection) =>
          typeof collection.getSharedPluginData === 'function' &&
          collection.getSharedPluginData('tempad_dev', 'variable-collection-key') === key
      )!
    const tokens = byKey('tokens')
    const brand = byKey('brand') as unknown as ExtendedVariableCollection
    const surface = [...fixture.variables.values()].find(
      (variable) =>
        typeof variable.getSharedPluginData === 'function' &&
        variable.getSharedPluginData('tempad_dev', 'variable-key') === 'surface'
    )!
    const light = brand.modes.find((mode) => mode.name === 'Light')!
    const dark = brand.modes.find((mode) => mode.name === 'Dark')!

    expect(brand).toMatchObject({
      isExtension: true,
      parentVariableCollectionId: tokens.id,
      rootVariableCollectionId: tokens.id
    })
    expect(brand.variableIds).toContain(surface.id)
    expect(brand.variableOverrides[surface.id]).toEqual({
      [light.modeId]: { r: 0.9, g: 0.2, b: 0.1 }
    })
    expect(PAGE.explicitVariableModes).toEqual({ [brand.id]: dark.modeId })

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })

    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: input.markup,
      variableCollections: {
        brand: {
          name: 'Brand/Acme',
          overrides: [
            {
              variable: { variableKey: 'surface' },
              values: {
                light: null,
                dark: { r: 0, g: 0.2, b: 0.8 }
              }
            }
          ]
        }
      }
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 3 })
    expect(brand.name).toBe('Brand/Acme')
    expect(brand.variableOverrides[surface.id]).toEqual({
      [dark.modeId]: { r: 0, g: 0.2, b: 0.8 }
    })
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects invalid extended collection graphs and resources before canvas creation', async () => {
    const fixture = createFixture()
    const spec = {
      mode: 'create' as const,
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    }

    await expect(
      applyCanvas({
        ...spec,
        variableCollections: {
          a: { name: 'A', extends: { collectionKey: 'b' } },
          b: { name: 'B', extends: { collectionKey: 'a' } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('parent cycle')
    })
    await expect(
      applyCanvas({
        ...spec,
        variableCollections: {
          invalid: {
            name: 'Invalid',
            extends: { key: 'collection-key' },
            modes: { light: { name: 'Light' } }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('cannot define modes or variables')
    })
    await expect(
      applyCanvas({
        ...spec,
        variableCollections: {
          invalid: {
            name: 'Invalid',
            modes: { light: { name: 'Light' } },
            overrides: [
              {
                variable: { id: 'variable:spacing' },
                values: { light: 8 }
              }
            ]
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('cannot declare extension overrides')
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(figma.variables.extendLibraryCollectionByKeyAsync).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('extends collections through native and published identities', async () => {
    const fixture = createFixture()

    await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      variableCollections: {
        local: {
          name: 'Local extension',
          extends: { id: 'collection:tokens' }
        },
        library: {
          name: 'Library extension',
          extends: { key: 'collection-key' }
        }
      }
    })

    expect(fixture.variableCollections.get('collection:tokens')!.extend).toHaveBeenCalledWith(
      'Local extension'
    )
    expect(figma.variables.extendLibraryCollectionByKeyAsync).toHaveBeenCalledWith(
      'collection-key',
      'Library extension'
    )
  })

  it('adopts existing local variable resources by native id', async () => {
    const fixture = createFixture()
    const collection = mockVariableCollection('collection:legacy', 'Legacy', [
      { modeId: 'mode:legacy', name: 'Legacy' }
    ])
    const spacing = mockVariable('variable:legacy-space', 'space', collection, 'FLOAT')
    spacing.setValueForMode(collection.defaultModeId, 4)
    ;(collection.variableIds as string[]).push(spacing.id)
    fixture.variableCollections.set(collection.id, collection)
    fixture.variables.set(spacing.id, spacing)

    const result = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="flex flex-row w-[100px] h-[100px] gap-[4px]"></div>',
      variableCollections: {
        legacy: {
          id: collection.id,
          name: 'Foundation',
          modes: {
            base: {
              id: collection.defaultModeId,
              name: 'Base'
            }
          },
          variables: {
            space: {
              id: spacing.id,
              name: 'Spacing/Base',
              values: { base: 8 }
            }
          }
        }
      },
      bindings: {
        root: {
          variables: {
            gap: { variableKey: 'space' }
          }
        }
      }
    })

    expect(collection.name).toBe('Foundation')
    expect(collection.modes[0]!.name).toBe('Base')
    expect(collection.getSharedPluginData('tempad_dev', 'variable-collection-key')).toBe('legacy')
    expect(spacing).toMatchObject({
      name: 'Spacing/Base',
      valuesByMode: { [collection.defaultModeId]: 8 }
    })
    expect(spacing.getSharedPluginData('tempad_dev', 'variable-key')).toBe('space')
    expect(fixture.getNode(result.rootNodeId).boundVariables.itemSpacing).toEqual({
      type: 'VARIABLE_ALIAS',
      id: spacing.id
    })
  })

  it('authors all local style kinds and applies them by stable key in one result', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="card" class="flex flex-col w-[320px] h-[200px]"><span data-key="title" class="w-fit h-fit">Title</span></div>',
      styles: {
        surface: {
          type: 'PAINT',
          name: 'Color/Surface',
          descriptionMarkdown: '**Default** surface',
          documentationLink: 'https://example.com/styles/surface',
          paints: [
            {
              type: 'SOLID',
              color: { r: 1, g: 1, b: 1 },
              variables: { color: { key: 'color-key' } }
            }
          ]
        },
        body: {
          type: 'TEXT',
          name: 'Typography/Body',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16,
          lineHeight: { unit: 'PIXELS', value: 24 },
          letterSpacing: { unit: 'PIXELS', value: 0 },
          textCase: 'ORIGINAL',
          variables: { fontSize: { id: 'variable:spacing' } }
        },
        raised: {
          type: 'EFFECT',
          name: 'Elevation/Raised',
          effects: [
            {
              type: 'DROP_SHADOW',
              color: { r: 0, g: 0, b: 0, a: 0.2 },
              offset: { x: 0, y: 4 },
              radius: 8,
              variables: { radius: { id: 'variable:spacing' } }
            }
          ]
        },
        columns: {
          type: 'GRID',
          name: 'Grid/Columns',
          layoutGrids: [
            {
              pattern: 'COLUMNS',
              alignment: 'STRETCH',
              gutterSize: 16,
              count: 12,
              variables: { gutterSize: { id: 'variable:spacing' } }
            }
          ]
        }
      },
      bindings: {
        card: {
          styles: {
            fill: { styleKey: 'surface' },
            effect: { styleKey: 'raised' },
            grid: { styleKey: 'columns' }
          }
        },
        title: {
          styles: { text: { styleKey: 'body' } },
          figma: {
            text: {
              ranges: [
                {
                  start: 0,
                  end: 5,
                  fillStyle: { styleKey: 'surface' }
                }
              ]
            }
          }
        }
      }
    }

    const created = await applyCanvas(input)
    const byKey = (key: string) =>
      [...fixture.styles.values()].find(
        (style) => style.getSharedPluginData('tempad_dev', 'style-key') === key
      )!
    const surface = byKey('surface') as PaintStyle
    const body = byKey('body') as TextStyle
    const raised = byKey('raised') as EffectStyle
    const columns = byKey('columns') as GridStyle
    const card = fixture.getNode(created.rootNodeId)
    const title = fixture.getNode(created.nodeIdsByKey.title ?? '') as unknown as TextNode

    expect(surface).toMatchObject({
      name: 'Color/Surface',
      descriptionMarkdown: '**Default** surface',
      documentationLinks: [{ uri: 'https://example.com/styles/surface' }]
    })
    expect(surface.paints[0]).toMatchObject({
      type: 'SOLID',
      boundVariables: {
        color: { type: 'VARIABLE_ALIAS', id: 'variable:color' }
      }
    })
    expect(body).toMatchObject({
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      boundVariables: {
        fontSize: { type: 'VARIABLE_ALIAS', id: 'variable:spacing' }
      }
    })
    expect(raised.effects[0]).toMatchObject({
      boundVariables: {
        radius: { type: 'VARIABLE_ALIAS', id: 'variable:spacing' }
      }
    })
    expect(columns.layoutGrids[0]).toMatchObject({
      boundVariables: {
        gutterSize: { type: 'VARIABLE_ALIAS', id: 'variable:spacing' }
      }
    })
    expect(card).toMatchObject({
      fillStyleId: surface.id,
      effectStyleId: raised.id,
      gridStyleId: columns.id
    })
    expect(title.textStyleId).toBe(body.id)
    expect(title.getRangeFillStyleId(0, 5)).toBe(surface.id)
    expect(created.verification.status).toBe('passed')

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      markup: input.markup,
      styles: {
        body: {
          type: 'TEXT',
          fontName: { family: 'Inter', style: 'Medium' }
        },
        surface: {
          type: 'PAINT',
          documentationLink: null,
          paints: []
        }
      }
    })
    expect(body.fontName).toEqual({ family: 'Inter', style: 'Medium' })
    expect(body.boundVariables?.fontSize).toEqual({
      type: 'VARIABLE_ALIAS',
      id: 'variable:spacing'
    })
    expect(surface.paints).toEqual([])
    expect(surface.documentationLinks).toEqual([])
  })

  it('warns when a newly authored style has no representative binding', async () => {
    createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      styles: {
        body: {
          type: 'TEXT',
          name: 'Typography/Body',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16
        }
      }
    }

    const created = await applyCanvas(input)
    expect(created.verification).toMatchObject({
      status: 'warning',
      warnings: [
        {
          code: 'unbound-created-style',
          key: 'body',
          message: expect.stringContaining('representative node')
        }
      ]
    })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId })
    ).resolves.toMatchObject({
      verification: { status: 'passed', warnings: [] }
    })
  })

  it('adopts local styles and rejects unsafe or incompatible style resources', async () => {
    const fixture = createFixture()
    const adopted = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      styles: {
        legacy: {
          id: 'style:fill',
          type: 'PAINT',
          name: 'Color/Legacy'
        }
      },
      bindings: {
        root: {
          styles: { fill: { styleKey: 'legacy' } }
        }
      }
    })
    const legacy = fixture.styles.get('style:fill')!
    expect(legacy.name).toBe('Color/Legacy')
    expect(legacy.getSharedPluginData('tempad_dev', 'style-key')).toBe('legacy')
    expect(fixture.getNode(adopted.rootNodeId).fillStyleId).toBe(legacy.id)
    expect(figma.createPaintStyle).not.toHaveBeenCalled()

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="missing" class="w-[100px] h-[100px]"></div>',
        styles: {
          missing: { type: 'PAINT' }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('requires a name')
    })
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="wrong" class="w-[100px] h-[100px]"></div>',
        styles: {
          wrong: { id: 'style:text', type: 'PAINT' }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected PAINT')
    })
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="pattern" class="w-[100px] h-[100px]"></div>',
        styles: {
          pattern: {
            type: 'PAINT',
            name: 'Pattern',
            paints: [
              {
                type: 'PATTERN',
                sourceCanvasKey: 'pattern',
                tileType: 'RECTANGULAR',
                scalingFactor: 1,
                spacing: { x: 0, y: 0 },
                horizontalAlignment: 'START'
              }
            ]
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('must already exist')
    })
    expect(fixture.triggerUndo).toHaveBeenCalledTimes(1)
  })

  it('removes managed styles only after every live consumer is explicitly cleared', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      styles: {
        surface: {
          type: 'PAINT',
          name: 'Color/Surface',
          paints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
        },
        orphan: {
          type: 'EFFECT',
          name: 'Effect/Orphan',
          effects: []
        }
      },
      bindings: {
        root: { styles: { fill: { styleKey: 'surface' } } }
      }
    })
    const byKey = (key: string) =>
      [...fixture.styles.values()].find(
        (style) => style.getSharedPluginData('tempad_dev', 'style-key') === key
      )!
    const surface = byKey('surface')
    const orphan = byKey('orphan')
    const removal = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId,
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      styles: {
        surface: null,
        orphan: null
      }
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('still used by node')
    })
    expect(surface.remove).not.toHaveBeenCalled()
    expect(orphan.remove).not.toHaveBeenCalled()

    const removed = await applyCanvas({
      ...removal,
      bindings: { root: { styles: { fill: null } } }
    })
    expect(removed).toMatchObject({
      mutationCount: 3,
      updatedNodeIds: [created.rootNodeId]
    })
    expect(surface.remove).toHaveBeenCalledOnce()
    expect(orphan.remove).toHaveBeenCalledOnce()
    expect(fixture.styles.has(surface.id)).toBe(false)
    expect(fixture.styles.has(orphan.id)).toBe(false)

    await expect(
      applyCanvas({
        ...removal,
        bindings: { root: { styles: { fill: null } } }
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
  })

  it('validates new variable resources before canvas creation and rolls back value failures', async () => {
    const fixture = createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: {
              light: { name: 'Light' },
              dark: { name: 'Dark' }
            },
            variables: {
              spacing: {
                name: 'Spacing',
                type: 'FLOAT',
                values: { light: 4 }
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('requires a value for mode "dark"')
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          colors: {
            name: 'Colors',
            modes: { base: { name: 'Base' } },
            variables: {
              surface: {
                name: 'Surface',
                type: 'COLOR',
                values: { base: 12 }
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('must be COLOR')
    })
    expect(figma.variables.createVariableCollection).toHaveBeenCalledOnce()
    expect(figma.createFrame).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).toHaveBeenCalledTimes(1)
  })

  it('reconciles explicit state on the page containing the result', async () => {
    createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      page: {
        name: 'Checkout',
        background: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 },
        guides: [
          { axis: 'X', offset: 24 },
          { axis: 'Y', offset: -8 }
        ],
        variableModes: { 'collection:tokens': 'mode:dark' }
      }
    }

    const created = await applyCanvas(input)
    expect(created.updatedNodeIds).toContain(PAGE.id)
    expect(PAGE).toMatchObject({
      name: 'Checkout',
      backgrounds: [
        {
          type: 'SOLID',
          color: { r: 0.1, g: 0.2, b: 0.3 },
          opacity: 0.8
        }
      ],
      guides: [
        { axis: 'X', offset: 24 },
        { axis: 'Y', offset: -8 }
      ],
      explicitVariableModes: { 'collection:tokens': 'mode:dark' }
    })

    const update = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId }
    await expect(applyCanvas(update)).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })

    const cleared = {
      ...update,
      page: {
        guides: [],
        variableModes: { 'collection:tokens': null }
      }
    }
    await expect(applyCanvas(cleared)).resolves.toMatchObject({
      mutationCount: 2,
      updatedNodeIds: [PAGE.id]
    })
    expect(PAGE.explicitVariableModes).toEqual({})
    expect(PAGE.guides).toEqual([])
    expect(PAGE.name).toBe('Checkout')
    await expect(applyCanvas(cleared)).resolves.toMatchObject({ mutationCount: 0 })

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="invalid" class="w-[320px] h-[200px]"></div>',
        page: {
          name: 'Must not apply',
          variableModes: { 'collection:tokens': 'mode:missing' }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('has no mode')
    })
    expect(PAGE.name).toBe('Checkout')
    expect(figma.createFrame).toHaveBeenCalledTimes(1)

    const otherPage = createMockPage('0:2', 'Other')
    const root = PAGE.children.shift()!
    Object.assign(root, { parent: otherPage as unknown as PageNode })
    otherPage.children.push(root)
    await expect(
      applyCanvas({
        ...update,
        page: { name: 'Owned page' }
      })
    ).resolves.toMatchObject({
      mutationCount: 1,
      updatedNodeIds: [otherPage.id]
    })
    expect(otherPage.name).toBe('Owned page')
    expect(PAGE.name).toBe('Checkout')
  })

  it('creates, reuses, and adopts stable-keyed pages without changing the active page', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      page: {
        pageKey: 'flows/checkout',
        name: 'Checkout',
        background: { r: 1, g: 1, b: 1, a: 1 }
      }
    }

    const created = await applyCanvas(input)
    const checkout = fixture.pages[1]!
    expect(figma.createPage).toHaveBeenCalledOnce()
    expect(figma.currentPage).toBe(PAGE)
    expect(checkout).toMatchObject({
      name: 'Checkout',
      children: [{ id: created.rootNodeId }]
    })
    expect(checkout.getSharedPluginData('tempad_dev', 'page-key')).toBe('flows/checkout')
    expect(PAGE.children).toEqual([])

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })

    const second = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="second" class="w-[100px] h-[100px]"></div>',
      page: { pageKey: 'flows/checkout' }
    })
    expect(figma.createPage).toHaveBeenCalledOnce()
    expect(checkout.children.map((node) => node.id)).toEqual([
      created.rootNodeId,
      second.rootNodeId
    ])

    const existing = createMockPage('0:9', 'Existing')
    existing.parent = figma.root
    fixture.pages.push(existing)
    const adopted = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="adopted" class="w-[100px] h-[100px]"></div>',
      page: {
        id: existing.id,
        pageKey: 'flows/existing',
        name: 'Existing flow'
      }
    })
    expect(existing.name).toBe('Existing flow')
    expect(existing.children[0]?.id).toBe(adopted.rootNodeId)
    expect(existing.getSharedPluginData('tempad_dev', 'page-key')).toBe('flows/existing')
  })

  it('loads an existing keyed page before reading its protected roots', async () => {
    const fixture = createFixture()
    const existing = createMockPage('0:9', 'Existing')
    existing.parent = figma.root
    existing.setSharedPluginData('tempad_dev', 'page-key', 'flows/existing')
    const children = existing.children
    let loaded = false
    Object.defineProperty(existing, 'children', {
      configurable: true,
      get: () => {
        if (!loaded) throw new Error('Page must be loaded before reading children')
        return children
      }
    })
    existing.loadAsync.mockImplementation(async () => {
      loaded = true
    })
    fixture.pages.push(existing)

    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      page: { pageKey: 'flows/existing' }
    })

    expect(existing.loadAsync).toHaveBeenCalledOnce()
    expect(existing.children[0]?.id).toBe(created.rootNodeId)
  })

  it('reconciles an explicit page position and rejects an out-of-range index before creation', async () => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    const created = await applyCanvas({
      mode: 'create',
      markup,
      page: {
        pageKey: 'flows/checkout',
        name: 'Checkout',
        index: 0
      }
    })
    const checkout = fixture.pages[0]!

    expect(checkout.name).toBe('Checkout')
    expect(fixture.pages).toEqual([checkout, PAGE])
    expect(figma.currentPage).toBe(PAGE)

    const moved = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId,
      markup,
      page: { index: 1 }
    }
    await expect(applyCanvas(moved)).resolves.toMatchObject({
      updatedNodeIds: [checkout.id],
      mutationCount: 1
    })
    expect(fixture.pages).toEqual([PAGE, checkout])
    await expect(applyCanvas(moved)).resolves.toMatchObject({
      updatedNodeIds: [],
      mutationCount: 0
    })

    const createCount = vi.mocked(figma.createPage).mock.calls.length
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="other" class="w-[100px] h-[100px]"></div>',
        page: {
          pageKey: 'flows/other',
          name: 'Other',
          index: 3
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('maximum index 2')
    })
    expect(figma.createPage).toHaveBeenCalledTimes(createCount)
  })

  it('rejects missing or conflicting page identities before creating canvas nodes', async () => {
    const fixture = createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        page: { pageKey: 'flows/new' }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('requires a name')
    })
    expect(figma.createPage).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        page: { id: '0:missing' }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not exist')
    })

    const first = createMockPage('0:8', 'First')
    const second = createMockPage('0:9', 'Second')
    first.parent = figma.root
    second.parent = figma.root
    first.setSharedPluginData('tempad_dev', 'page-key', 'flows/first')
    second.setSharedPluginData('tempad_dev', 'page-key', 'flows/second')
    fixture.pages.push(first, second)
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        page: {
          id: first.id,
          pageKey: 'flows/second',
          name: 'Wrong'
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('does not identify')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        page: { id: first.id, pageKey: 'flows/new' }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('already owned')
    })
    second.setSharedPluginData('tempad_dev', 'page-key', 'flows/first')
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        page: { pageKey: 'flows/first' }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('more than one')
    })

    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="owned" class="w-[100px] h-[100px]"></div>'
    })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="owned" class="w-[100px] h-[100px]"></div>',
        page: { id: first.id }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('belongs to page')
    })
  })

  it('rejects incompatible variables before creating canvas nodes', async () => {
    const fixture = createFixture()

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px] bg-[#FFFFFF]"></div>',
        bindings: {
          root: {
            variables: {
              fill: { id: 'variable:font' }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('expected COLOR')
    })
    expect(PAGE.children).toEqual([])
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('preserves an existing variable binding when an update does not replace it', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px] bg-[#FFFFFF]"></div>',
      bindings: {
        root: {
          variables: {
            fill: { key: 'color-key' }
          }
        }
      }
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: '<div data-key="root" class="w-[320px] h-[200px] bg-[#000000]"></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(
      (fixture.getNode(created.rootNodeId) as unknown as FrameNode).boundVariables?.fills
    ).toEqual([{ type: 'VARIABLE_ALIAS', id: 'variable:color' }])
  })

  it('rejects a root key already owned by another node in the update scope', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const owner = fixture.createNode('TEXT')
    const frame = root as unknown as FrameNode
    frame.insertChild(0, owner)
    owner.setSharedPluginData('tempad_dev', 'canvas-key', 'root')

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('ignores definition keys inherited by instance roots and descendants', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const component = fixture.createNode('COMPONENT') as unknown as ComponentNode
    const definition = fixture.createNode('FRAME')
    const inherited = fixture.createNode('FRAME')
    root.setSharedPluginData('tempad_dev', 'canvas-key', 'root')
    component.setSharedPluginData('tempad_dev', 'canvas-key', 'component/icon')
    definition.setSharedPluginData('tempad_dev', 'canvas-key', 'component/icon/content')
    inherited.setSharedPluginData('tempad_dev', 'canvas-key', 'component/icon/content')
    component.appendChild(definition)
    const instance = component.createInstance()
    instance.appendChild(inherited)
    root.appendChild(component)
    root.appendChild(instance)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(instance.children).toEqual([inherited])
  })

  it('rejects an instance descendant as the update root', async () => {
    const fixture = createFixture()
    const instance = fixture.createNode('INSTANCE')
    const child = fixture.createNode('FRAME')
    child.setSharedPluginData('tempad_dev', 'canvas-key', 'component/card/content')
    instance.appendChild(child)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: child.id,
        markup: '<div data-key="component/card/content" class="w-[100px] h-[100px]"></div>'
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('inside an instance')
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('rejects adopting an instance descendant by exact node id', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const instance = fixture.createNode('INSTANCE')
    const child = fixture.createNode('FRAME')
    root.setSharedPluginData('tempad_dev', 'canvas-key', 'root')
    instance.appendChild(child)
    root.appendChild(instance)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup: `<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><div data-key="root/content" data-node-id="${child.id}" class="w-[80px] h-[80px]"></div></div>`
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
      message: expect.stringContaining('inside an instance')
    })
    expect(child.parent).toBe(instance)
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('claims an unmarked instance usage key', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const component = fixture.createNode('COMPONENT') as unknown as ComponentNode
    const instance = component.createInstance()
    root.setSharedPluginData('tempad_dev', 'canvas-key', 'root')
    component.setSharedPluginData('tempad_dev', 'canvas-key', 'component/icon')
    instance.setSharedPluginData('tempad_dev', 'canvas-key', 'root/icon')
    root.appendChild(component)
    root.appendChild(instance)

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        markup:
          '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><div data-key="root/icon" class="w-[24px] h-[24px]"></div></div>',
        native: {
          'root/icon': { component: { id: component.id } }
        }
      })
    ).resolves.toBeDefined()
    expect(instance.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(instance.id)
  })

  it('reuses keyed descendants nested below omitted containers', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const nested = fixture.createNode('TEXT')
    const slot = fixture.createNode('SLOT')
    root.insertChild(0, slot)
    slot.insertChild(0, nested)
    root.setSharedPluginData('tempad_dev', 'canvas-key', 'root')
    nested.setSharedPluginData('tempad_dev', 'canvas-key', 'root/nested')

    const result = await applyCanvas({
      mode: 'update',
      targetNodeId: root.id,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="root/nested" class="w-full h-fit">Nested</span></div>'
    })

    expect(result.createdNodeIds).toEqual([])
    expect(result.nodeIdsByKey['root/nested']).toBe(nested.id)
    expect((nested as unknown as TextNode).characters).toBe('Nested')
  })

  it('rejects nodes outside the update scope and rolls back partial work', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    const foreign = fixture.createNode('TEXT')
    fixture.commitUndo.mockClear()
    fixture.triggerUndo.mockClear()

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `<div data-key="card" class="flex flex-col w-[320px] h-[200px]"><span data-key="foreign" data-node-id="${foreign.id}" class="w-full h-fit">Foreign</span></div>`
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE
    })
    expect(fixture.commitUndo).toHaveBeenCalledTimes(2)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    expect(fixture.commitUndo.mock.invocationCallOrder[1]).toBeLessThan(
      fixture.triggerUndo.mock.invocationCallOrder[0]!
    )
    expect(fixture.nodes.has(created.rootNodeId)).toBe(true)
  })

  it('rejects and rolls back an apply result that would exceed the inline response budget', async () => {
    const fixture = createFixture()
    const rootKey = `root-${'r'.repeat(120)}`
    const children = Array.from({ length: 99 }, (_, index) => {
      const key = `item-${String(index).padStart(2, '0')}-${'x'.repeat(115)}`
      return `<span data-key="${key}" class="absolute left-[-10px] top-[0px] w-fit h-fit">X</span>`
    }).join('')

    await expect(
      applyCanvas({
        mode: 'create',
        markup: `<div data-key="${rootKey}" class="w-[100px] h-[100px]">${children}</div>`
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('64 KiB inline budget')
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('reports when rollback changes an unrelated existing top-level root', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    const unrelated = fixture.createNode('COMPONENT') as unknown as ComponentNode
    unrelated.resize(342, 68)
    const propertyName = unrelated.addComponentProperty('Artist', 'TEXT', 'Mara Vale')
    const foreign = fixture.createNode('TEXT')
    fixture.triggerUndo.mockImplementationOnce(() => {
      delete unrelated.componentPropertyDefinitions[propertyName]
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `<div data-key="card" class="flex flex-col w-[320px] h-[200px]"><span data-key="foreign" data-node-id="${foreign.id}" class="w-full h-fit">Foreign</span></div>`
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining(`Rollback changed pre-existing node ${unrelated.id}`)
    })
  })

  it('reports when rollback removes the pre-existing update root', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    const foreign = fixture.createNode('TEXT')
    fixture.triggerUndo.mockImplementationOnce(() => {
      fixture.getNode(created.rootNodeId).remove()
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        markup: `<div data-key="card" class="flex flex-col w-[320px] h-[200px]"><span data-key="foreign" data-node-id="${foreign.id}" class="w-full h-fit">Foreign</span></div>`
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('Rollback did not preserve pre-existing node')
    })
  })

  it('reports when rollback changes a referenced component', async () => {
    const fixture = createFixture()
    const component = fixture.createNode('COMPONENT') as unknown as ComponentNode
    component.resize(280, 56)
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    fixture.triggerUndo.mockImplementationOnce(() => {
      component.resize(100, 100)
    })

    await expect(
      applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/track" class="w-[280px] h-[56px]"></div><div data-key="screen/surface" class="w-[280px] h-[56px] bg-[#112233]"></div></div>',
        native: {
          'screen/track': { component: { id: component.id } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('Rollback changed pre-existing node')
    })
  })

  it('wraps Figma failures and reports when automatic rollback is unavailable', async () => {
    const fixture = createFixture()
    fixture.loadFontAsync.mockRejectedValueOnce(new Error('font unavailable'))

    await expect(applyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('is unavailable in the current Figma context')
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()

    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    await expect(applyCanvas(createSpec())).rejects.toThrow('paint unavailable')
    expect(fixture.triggerUndo).toHaveBeenCalledTimes(2)

    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    fixture.triggerUndo.mockImplementationOnce(() => {
      throw new Error('undo unavailable')
    })
    await expect(applyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('automatic rollback was not available')
    })
  })

  it('loads the current page and retries a transient font connection timeout once', async () => {
    const fixture = createFixture()
    fixture.loadFontAsync.mockImplementationOnce(() => {
      throw new Error('Unable to establish connection to Figma after 10 seconds')
    })

    await expect(applyCanvas(createSpec())).resolves.toMatchObject({
      rootNodeId: expect.any(String)
    })
    expect(PAGE.loadAsync).toHaveBeenCalledOnce()
    expect(fixture.loadFontAsync).toHaveBeenCalledTimes(2)
  })

  it('rejects concurrent apply requests within one Figma session', async () => {
    const fixture = createFixture()
    let finishFontLoad: (() => void) | undefined
    fixture.loadFontAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFontLoad = resolve
        })
    )
    const input = {
      mode: 'create' as const,
      markup:
        '<div data-key="root" class="flex flex-col w-[120px] h-[80px]"><span data-key="label" class="w-fit h-fit">Hello</span></div>'
    }

    const first = applyCanvasFromTool(input)
    await vi.waitFor(() => expect(finishFontLoad).toBeTypeOf('function'))
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_BUSY
    })

    finishFontLoad?.()
    await expect(first).resolves.toMatchObject({ rootNodeId: expect.any(String) })
  })
})
