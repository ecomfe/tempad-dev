import { vi } from 'vitest'

// This is a focused authoring fake, not a complete Plugin API implementation.
// Keep unverified host behavior in explicitly scoped test overrides.
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

function removeEmptyMockGroup(parent: BaseNode | null): void {
  // Figma removes a group when its last child is removed or reparented.
  if (parent?.type === 'GROUP' && !parent.removed && parent.children.length === 0) parent.remove()
}

export function createMockPage(id: string, name: string) {
  const page = {
    id,
    name,
    type: 'PAGE' as const,
    removed: false,
    parent: null as BaseNode | null,
    children: [] as SceneNode[],
    selection: [] as SceneNode[],
    guides: [] as Guide[],
    backgrounds: defaultPageBackground(),
    explicitVariableModes: {} as Record<string, string>,
    isPageDivider: false,
    loadAsync: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn((callback?: (node: SceneNode) => boolean) => {
      const found: SceneNode[] = []
      const pending = [...page.children]
      while (pending.length) {
        const node = pending.pop()!
        if (!callback || callback(node)) found.push(node)
        if ('children' in node) pending.push(...node.children)
      }
      return found
    }),
    clearExplicitVariableModeForCollection(collection: VariableCollection) {
      delete page.explicitVariableModes[collection.id]
    },
    setExplicitVariableModeForCollection(collection: VariableCollection, modeId: string) {
      page.explicitVariableModes[collection.id] = modeId
    },
    insertChild(index: number, child: SceneNode) {
      if (page.removed || child.removed) throw new Error('Cannot reparent a removed node')
      const mutable = child as SceneNode & { parent: BaseNode | null }
      const oldParent = mutable.parent as (BaseNode & { children?: SceneNode[] }) | null
      if (oldParent?.children) {
        const oldIndex = oldParent.children.indexOf(child)
        if (oldIndex >= 0) oldParent.children.splice(oldIndex, 1)
      }
      mutable.parent = page as unknown as PageNode
      page.children.splice(index, 0, child)
      removeEmptyMockGroup(oldParent)
    },
    appendChild(child: SceneNode) {
      page.insertChild(page.children.length, child)
    },
    remove() {
      if (page.removed) return
      const document = page.parent as (DocumentNode & { children: PageNode[] }) | null
      if (document) {
        const index = document.children.indexOf(page as unknown as PageNode)
        if (index >= 0) document.children.splice(index, 1)
      }
      page.removed = true
      page.parent = null
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

export type MutableNode = Mutable<SupportedMockNode> & {
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
  opacity: number
  parent: BaseNode | null
  setGridChildPosition: (row: number, column: number) => void
  strokeStyleId: string
  strokes: readonly Paint[]
}

type SupportedMockNode = Extract<SceneNode, { type: MockNodeType }>

export type FigmaFixture = {
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
  listAvailableFontsAsync: ReturnType<typeof vi.fn>
  loadFontAsync: ReturnType<typeof vi.fn>
  nodes: Map<string, BaseNode>
  page: ReturnType<typeof createMockPage>
  pages: Array<ReturnType<typeof createMockPage>>
  styles: Map<string, BaseStyle>
  triggerUndo: ReturnType<typeof vi.fn>
  variableCollections: Map<string, VariableCollection>
  variables: Map<string, Variable>
}

export function solidPaint(color = { r: 1, g: 1, b: 1 }, opacity = 1): SolidPaint {
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

export function mockVariableCollection(
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

export function mockVariable(
  id: string,
  name: string,
  collection: VariableCollection,
  resolvedType: VariableResolvedDataType,
  resolveAlias?: (id: string) => Variable | undefined
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
    resolveForConsumer: vi.fn((consumer: SceneNode) => {
      let current: BaseNode | null = consumer
      let mode = collection.defaultModeId
      while (current && current.type !== 'DOCUMENT') {
        const explicit =
          'explicitVariableModes' in current
            ? current.explicitVariableModes[collection.id]
            : undefined
        if (explicit) {
          mode = explicit
          break
        }
        current = current.parent
      }
      const value = valuesByMode[mode]
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'VARIABLE_ALIAS'
      ) {
        return resolveAlias?.(value.id)?.resolveForConsumer(consumer) ?? { value, resolvedType }
      }
      return { value, resolvedType }
    }),
    remove: vi.fn()
  })
  return variable as unknown as Variable
}

export function createFixture({
  float32 = []
}: { float32?: readonly ('opacity' | 'width' | 'height')[] } = {}): FigmaFixture {
  const page = createMockPage('0:1', 'Page 1')
  let currentPage: PageNode = page as unknown as PageNode
  let nextId = 1
  let nextComponentPropertyId = 1
  let nextPageId = 2
  let nextStyleId = 1
  const nodes = new Map<string, BaseNode>()
  const styles = new Map<string, BaseStyle>()
  const pages = [page]
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
  page.parent = root as unknown as DocumentNode
  const loadAllPagesAsync = vi.fn(async () => {
    await Promise.all(
      pages
        .filter((candidate) => candidate.id !== page.id)
        .map((candidate) => candidate.loadAsync())
    )
  })

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

  function createStyle(type: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID'): BaseStyle {
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
    let counterAxisSpacingSynced = false
    const initialPage = currentPage
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
      parent: initialPage,
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
      clone() {
        // Only ordinary subtrees are modeled; reject unsupported descendants before
        // creating anything, rather than silently losing text/component/grid state.
        const pending: SceneNode[] = [node]
        while (pending.length) {
          const current = pending.pop()!
          if (current.removed) throw new Error('Cannot clone a removed node')
          if (current.type !== 'FRAME' && current.type !== 'GROUP' && current.type !== 'RECTANGLE')
            throw new Error(`Unsupported mock clone: ${current.type}`)
          if (current.targetAspectRatio)
            throw new Error('Unsupported mock clone: locked aspect ratio')
          if (
            current.type === 'FRAME' &&
            (current.layoutMode === 'GRID' ||
              current.gridRowCount !== 1 ||
              current.gridColumnCount !== 1 ||
              [...current.gridRowSizes, ...current.gridColumnSizes].some(
                (track) => track.type !== 'FLEX' || track.value !== 1
              ))
          )
            throw new Error('Unsupported mock clone: grid tracks')
          if ('children' in current) pending.push(...current.children)
        }

        const copy = createNode(type)
        const deferred = new Set([
          'id',
          'type',
          'removed',
          'parent',
          'children',
          'boundVariables',
          'explicitVariableModes',
          'x',
          'y',
          'rotation',
          'relativeTransform',
          'fillStyleId',
          'strokeStyleId',
          'effectStyleId',
          'gridStyleId'
        ])
        for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(node))) {
          if (deferred.has(field) || (!descriptor.writable && !descriptor.set)) continue
          const value: unknown = Reflect.get(node, field)
          if (typeof value !== 'function') Reflect.set(copy, field, structuredClone(value))
        }
        // Setters retain their own closures, and paint setters clear bindings/style IDs.
        Object.assign(copy.boundVariables, structuredClone(boundVariables))
        Object.assign(copy.explicitVariableModes, structuredClone(explicitVariableModes))
        for (const field of ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'gridStyleId']) {
          if (field in node) Reflect.set(copy, field, Reflect.get(node, field))
        }
        copy.relativeTransform = structuredClone(node.relativeTransform)
        if (type === 'FRAME' && counterAxisSpacingSynced)
          (copy as FrameNode).counterAxisSpacing = null
        for (const [entry, value] of pluginData) {
          const separator = entry.indexOf(':')
          copy.setSharedPluginData(entry.slice(0, separator), entry.slice(separator + 1), value)
        }
        for (const child of node.children ?? []) copy.appendChild(child.clone())
        return copy
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
        removeEmptyMockGroup(parent)
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
        const parent = node.parent
        if (
          parent &&
          'layoutMode' in parent &&
          parent.layoutMode === 'GRID' &&
          'children' in parent
        ) {
          const collision = parent.children.some((sibling) => {
            if (sibling.id === node.id || !('gridRowAnchorIndex' in sibling)) return false
            const rowOverlaps =
              row < sibling.gridRowAnchorIndex + sibling.gridRowSpan &&
              row + node.gridRowSpan > sibling.gridRowAnchorIndex
            const columnOverlaps =
              column < sibling.gridColumnAnchorIndex + sibling.gridColumnSpan &&
              column + node.gridColumnSpan > sibling.gridColumnAnchorIndex
            return rowOverlaps && columnOverlaps
          })
          if (collision) throw new Error("Can't place child because the grid position is occupied")
        }
        node.gridRowAnchorIndex = row
        node.gridColumnAnchorIndex = column
        if ('layoutSizingHorizontal' in node) {
          node.layoutSizingHorizontal = 'FIXED'
          node.layoutSizingVertical = 'FIXED'
        }
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
        configurable: true,
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
          if (node.removed || child.removed) throw new Error('Cannot reparent a removed node')
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
          if (oldParent !== node) removeEmptyMockGroup(oldParent)
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
      const rangeKey = (start: number, end: number, field: string) => {
        if (
          field.replace('variable:', '') === 'paragraphIndent' ||
          field.replace('variable:', '') === 'paragraphSpacing' ||
          field === 'listSpacing'
        ) {
          start = start === 0 ? 0 : characters.lastIndexOf('\n', start - 1) + 1
          const newline = characters.indexOf('\n', end - 1)
          end = newline === -1 ? characters.length : newline + 1
        }
        return `${start}:${end}:${field}`
      }
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
          if (!styleId) return
          const style = styles.get(styleId) as TextStyle
          for (const field of [
            'fontName',
            'fontSize',
            'lineHeight',
            'letterSpacing',
            'textCase',
            'textDecoration',
            'paragraphIndent',
            'paragraphSpacing',
            'listSpacing'
          ] as const) {
            setRangeValue(start, end, field, style[field])
          }
          text.leadingTrim = style.leadingTrim
          text.hangingPunctuation = style.hangingPunctuation
          text.hangingList = style.hangingList
          for (const field of [
            'fontFamily',
            'fontStyle',
            'fontWeight',
            'fontSize',
            'lineHeight',
            'letterSpacing',
            'paragraphIndent',
            'paragraphSpacing'
          ] as const) {
            const alias = style.boundVariables?.[field]
            text.setRangeBoundVariable(
              start,
              end,
              field,
              alias ? await figma.variables.getVariableByIdAsync(alias.id) : null
            )
          }
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
            if (fields.includes('fontName'))
              segment.fontName = rangeValue(start, end, 'fontName', text.fontName)
            if (fields.includes('textStyleId'))
              segment.textStyleId = rangeValue(start, end, 'textStyleId', text.textStyleId)
            if (fields.includes('fills')) {
              segment.fills = rangeValue(start, end, 'fills', text.fills)
            }
            if (fields.includes('hyperlink')) {
              segment.hyperlink = rangeValue(start, end, 'hyperlink', text.hyperlink)
            }
            if (fields.includes('textDecorationColor')) {
              segment.textDecorationColor = rangeValue(
                start,
                end,
                'textDecorationColor',
                text.textDecorationColor
              )
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
          (start: number, end: number, field: string, variable: Variable | null) => {
            setRangeValue(
              start,
              end,
              `variable:${field}`,
              variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : null
            )
            if (!variable) return
            const value = variable.resolveForConsumer(text).value
            if (field === 'fontFamily' || field === 'fontStyle') {
              const current = text.getRangeFontName(start, end) as FontName
              setRangeValue(start, end, 'fontName', {
                ...current,
                [field === 'fontFamily' ? 'family' : 'style']: value
              })
            } else if (field === 'lineHeight' || field === 'letterSpacing') {
              setRangeValue(start, end, field, { unit: 'PIXELS', value })
            } else if (field !== 'fontWeight') setRangeValue(start, end, field, value)
          }
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
          configurable: true,
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

    for (const field of float32) {
      let value = Math.fround(node[field])
      Object.defineProperty(node, field, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: (next: number) => {
          value = Math.fround(next)
        }
      })
    }

    ;(initialPage.children as SceneNode[]).push(node)
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
    parent: page,
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
    resolvedType: 'FLOAT',
    resolveForConsumer: () => ({ value: 8, resolvedType: 'FLOAT' })
  } as unknown as Variable
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
        resolvedType: 'FLOAT',
        resolveForConsumer: (consumer: SceneNode) => ({
          value: consumer.explicitVariableModes['collection:tokens'] === 'mode:dark' ? 22 : 18,
          resolvedType: 'FLOAT'
        })
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
    variable.valuesByModeForCollectionAsync = vi.fn(async (collection: VariableCollection) => {
      if (!collection.isExtension) return variable.valuesByMode
      const extended = collection as unknown as ExtendedVariableCollection
      const parent = variableCollectionsById.get(extended.parentVariableCollectionId)!
      const inherited = await variable.valuesByModeForCollectionAsync(parent)
      return Object.fromEntries(
        extended.modes.map((mode) => [
          mode.modeId,
          extended.variableOverrides[variable.id]?.[mode.modeId] ?? inherited[mode.parentModeId]!
        ])
      )
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
  const listAvailableFontsAsync = vi
    .fn()
    .mockResolvedValue([
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Inter', style: 'Semi Bold' } },
      { fontName: { family: 'Inter', style: 'Extra Bold' } },
      { fontName: { family: 'Inter', style: 'Extra Light' } },
      { fontName: { family: 'Noto Serif', style: 'Regular' } },
      { fontName: { family: 'Noto Serif', style: 'SemiBold' } },
      { fontName: { family: 'Noto Serif', style: 'ExtraBold' } },
      { fontName: { family: 'Noto Sans Mono', style: 'Regular' } },
      { fontName: { family: 'Noto Sans Mono', style: 'Medium' } },
      { fontName: { family: 'Noto Sans Mono', style: 'ExtraLight' } }
    ] satisfies Font[])
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
    get currentPage() {
      return currentPage
    },
    setCurrentPageAsync: vi.fn(async (page: PageNode) => {
      currentPage = page
    }),
    loadAllPagesAsync,
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
    listAvailableFontsAsync,
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
            resolvedType,
            (id) => variablesById.get(id)
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
    listAvailableFontsAsync,
    loadFontAsync,
    nodes,
    page,
    pages,
    styles,
    triggerUndo,
    variableCollections: variableCollectionsById,
    variables: variablesById
  }
}
