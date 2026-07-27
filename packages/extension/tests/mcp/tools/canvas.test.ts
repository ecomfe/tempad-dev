import type { ApplyCanvasParametersInput, CanvasNodeSpec } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canvasWritesOn: { value: false }
}))

vi.mock('@/ui/state', () => ({
  canvasWritesOn: mocks.canvasWritesOn
}))

import { handleApplyCanvas } from '@/mcp/tools/canvas'

const MIXED = Symbol('mixed')
const PAGE = {
  id: '0:1',
  name: 'Page 1',
  type: 'PAGE',
  parent: null,
  children: [] as SceneNode[]
}

type Mutable<T> = T extends unknown ? { -readonly [Key in keyof T]: T[Key] } : never

type MutableNode = Mutable<SupportedMockNode> & {
  boundVariables: Record<string, unknown>
  children: SceneNode[]
  componentProperties: Record<string, { type: ComponentPropertyType; value: string | boolean }>
  mainComponent?: ComponentNode
  parent: BaseNode | null
}

type SupportedMockNode = Extract<SceneNode, { type: CanvasNodeSpec['type'] }>

type FigmaFixture = {
  commitUndo: ReturnType<typeof vi.fn>
  createNode: (type: CanvasNodeSpec['type']) => MutableNode
  getNode: (id: string) => MutableNode
  importComponentByKeyAsync: ReturnType<typeof vi.fn>
  loadFontAsync: ReturnType<typeof vi.fn>
  nodes: Map<string, BaseNode>
  triggerUndo: ReturnType<typeof vi.fn>
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

function createFixture(): FigmaFixture {
  let nextId = 1
  const nodes = new Map<string, BaseNode>()
  PAGE.children.length = 0

  function createNode(type: CanvasNodeSpec['type']): MutableNode {
    const id = `node:${nextId++}`
    const pluginData = new Map<string, string>()
    const boundVariables: Record<string, unknown> = {}
    let fills: readonly Paint[] = [solidPaint()]
    let strokes: readonly Paint[] = []
    const node = {
      id,
      type,
      name: '',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: type === 'LINE' ? 0 : 100,
      parent: PAGE,
      opacity: 1,
      strokeWeight: 1,
      cornerRadius: 0,
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      boundVariables,
      getSharedPluginData(namespace: string, key: string) {
        return pluginData.get(`${namespace}:${key}`) ?? ''
      },
      setSharedPluginData(namespace: string, key: string, value: string) {
        pluginData.set(`${namespace}:${key}`, value)
      },
      resize(width: number, height: number) {
        node.width = width
        node.height = height
      },
      setBoundVariable: vi.fn((field: string, variable: Variable) => {
        const alias = { type: 'VARIABLE_ALIAS', id: variable.id }
        if (field === 'cornerRadius' && (type === 'FRAME' || type === 'RECTANGLE')) {
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
      fills: {
        get: () => fills,
        set: (value: readonly Paint[]) => {
          fills = normalizePaints(value, 'fills')
        }
      },
      strokes: {
        get: () => strokes,
        set: (value: readonly Paint[]) => {
          strokes = normalizePaints(value, 'strokes')
        }
      }
    })

    if (type === 'FRAME') {
      Object.assign(node, {
        children: [] as SceneNode[],
        layoutMode: 'NONE',
        itemSpacing: 0,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        paddingTop: 10,
        paddingRight: 11,
        paddingBottom: 12,
        paddingLeft: 13,
        insertChild(index: number, child: MutableNode) {
          const oldParent = child.parent as (BaseNode & { children?: SceneNode[] }) | null
          if (oldParent?.children) {
            const oldIndex = oldParent.children.indexOf(child)
            if (oldIndex >= 0) oldParent.children.splice(oldIndex, 1)
          }
          child.parent = node as unknown as FrameNode
          node.children.splice(index, 0, child)
        }
      })
    }

    if (type === 'TEXT') {
      Object.assign(node, {
        characters: '',
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 12,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
        getRangeAllFontNames: vi.fn(() => [{ family: 'Inter', style: 'Regular' } as FontName])
      })
    }

    PAGE.children.push(node)
    nodes.set(id, node)
    return node
  }

  const component = {
    id: 'component:1',
    type: 'COMPONENT',
    key: 'component-key',
    createInstance: () => {
      const instance = createNode('INSTANCE')
      instance.mainComponent = component as ComponentNode
      Object.assign(instance, {
        componentProperties: {
          Label: { type: 'TEXT', value: 'Default' },
          Disabled: { type: 'BOOLEAN', value: false }
        },
        getMainComponentAsync: vi.fn(() => Promise.resolve(instance.mainComponent ?? null)),
        swapComponent: vi.fn((next: ComponentNode) => {
          instance.mainComponent = next
        }),
        setProperties: vi.fn((properties: Record<string, string | boolean>) => {
          for (const [name, value] of Object.entries(properties)) {
            const current = instance.componentProperties[name]
            instance.componentProperties[name] = { type: current?.type ?? 'TEXT', value }
          }
        })
      })
      return instance as unknown as InstanceNode
    }
  } as ComponentNode
  nodes.set(component.id, component)

  const colorVariable = {
    id: 'variable:color',
    key: 'color-key'
  } as Variable
  const spacingVariable = {
    id: 'variable:spacing',
    key: 'spacing-key'
  } as Variable
  const fontVariable = {
    id: 'variable:font',
    key: 'font-key'
  } as Variable
  const variablesById = new Map([
    [spacingVariable.id, spacingVariable],
    [fontVariable.id, fontVariable]
  ])
  const commitUndo = vi.fn()
  const triggerUndo = vi.fn()
  const loadFontAsync = vi.fn().mockResolvedValue(undefined)
  const importComponentByKeyAsync = vi.fn().mockResolvedValue(component)

  vi.stubGlobal('figma', {
    editorType: 'figma',
    mixed: MIXED,
    viewport: { center: { x: 500, y: 400 } },
    commitUndo,
    triggerUndo,
    getNodeById: vi.fn((id: string) => nodes.get(id) ?? null),
    createEllipse: vi.fn(() => createNode('ELLIPSE')),
    createFrame: vi.fn(() => createNode('FRAME')),
    createLine: vi.fn(() => createNode('LINE')),
    createRectangle: vi.fn(() => createNode('RECTANGLE')),
    createText: vi.fn(() => createNode('TEXT')),
    importComponentByKeyAsync,
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
      getVariableByIdAsync: vi.fn((id: string) => Promise.resolve(variablesById.get(id) ?? null)),
      importVariableByKeyAsync: vi.fn((key: string) =>
        Promise.resolve(key === colorVariable.key ? colorVariable : null)
      ),
      setBoundVariableForPaint: vi.fn((paint: SolidPaint, _field: string, variable: Variable) => ({
        ...paint,
        boundVariables: {
          color: { type: 'VARIABLE_ALIAS', id: variable.id }
        }
      }))
    }
  } as unknown as PluginAPI)

  return {
    commitUndo,
    createNode,
    getNode(id: string) {
      const node = nodes.get(id)
      if (!node || node.type === 'COMPONENT') throw new Error(`Missing mock node ${id}`)
      return node as MutableNode
    },
    importComponentByKeyAsync,
    loadFontAsync,
    nodes,
    triggerUndo
  }
}

function createSpec(): ApplyCanvasParametersInput {
  return {
    mode: 'create',
    root: {
      key: 'card',
      type: 'FRAME',
      name: 'Card',
      size: { width: 320, height: 200, horizontal: 'HUG', vertical: 'FIXED' },
      layout: {
        mode: 'HORIZONTAL',
        gap: 8,
        padding: { top: 16 },
        primaryAlign: 'SPACE_BETWEEN',
        counterAlign: 'CENTER'
      },
      appearance: {
        fill: '#336699CC',
        stroke: '#112233',
        strokeWeight: 2,
        cornerRadius: 12,
        opacity: 0.8
      },
      variables: {
        fill: { key: 'color-key' },
        stroke: { key: 'color-key' },
        gap: { id: 'variable:spacing' },
        paddingRight: { id: 'variable:spacing' }
      },
      children: [
        {
          key: 'card/title',
          type: 'TEXT',
          name: 'Title',
          text: {
            characters: 'Hello',
            fontFamily: 'Inter',
            fontStyle: 'Semi Bold',
            fontSize: 18,
            lineHeight: 24,
            letterSpacing: 0.5,
            alignHorizontal: 'CENTER',
            alignVertical: 'CENTER'
          }
        },
        {
          key: 'card/body',
          type: 'RECTANGLE',
          size: { width: 80, height: 40 },
          appearance: { fill: '#ABCDEF', cornerRadius: 8 }
        },
        {
          key: 'card/dot',
          type: 'ELLIPSE',
          size: { width: 12, height: 12 }
        },
        {
          key: 'card/divider',
          type: 'LINE',
          size: { width: 120 },
          appearance: { stroke: '#000000', strokeWeight: 1 }
        },
        {
          key: 'card/action',
          type: 'INSTANCE',
          component: { key: 'component-key' },
          componentProperties: { Label: 'Save', Disabled: true }
        }
      ]
    }
  }
}

beforeEach(() => {
  mocks.canvasWritesOn.value = true
})

afterEach(() => {
  mocks.canvasWritesOn.value = false
  PAGE.children.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/canvas', () => {
  it('gates writes and validates the editor and desired result before mutation', async () => {
    createFixture()
    mocks.canvasWritesOn.value = false
    await expect(handleApplyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_WRITE_DISABLED
    })

    mocks.canvasWritesOn.value = true
    Object.assign(figma, { editorType: 'figjam' })
    await expect(handleApplyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_UNSUPPORTED_EDITOR
    })

    Object.assign(figma, { editorType: 'figma' })
    await expect(handleApplyCanvas()).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
  })

  it('creates one result tree, applies design-system references, and centers the root', async () => {
    const fixture = createFixture()
    const result = await handleApplyCanvas(createSpec())

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

    const root = fixture.getNode(result.rootNodeId) as unknown as FrameNode
    expect(root.children).toHaveLength(5)
    expect(root.x).toBe(340)
    expect(root.y).toBe(300)
    expect(root.layoutMode).toBe('HORIZONTAL')
    expect(root.paddingTop).toBe(16)
    expect(root.paddingRight).toBe(11)
    expect(root.paddingBottom).toBe(12)
    expect(root.paddingLeft).toBe(13)
    expect(root.boundVariables).toMatchObject({
      fills: [{ id: 'variable:color' }],
      strokes: [{ id: 'variable:color' }],
      itemSpacing: { id: 'variable:spacing' },
      paddingRight: { id: 'variable:spacing' }
    })

    const title = fixture.getNode(result.nodeIdsByKey['card/title'] ?? '') as unknown as TextNode
    expect(title.characters).toBe('Hello')
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' })
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

  it('reconciles against live state, skips an unchanged result, and preserves omissions', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas(createSpec())
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode
    const unmanaged = fixture.createNode('RECTANGLE')
    root.insertChild(root.children.length, unmanaged)

    const update: ApplyCanvasParametersInput = {
      ...createSpec(),
      mode: 'update',
      targetNodeId: created.rootNodeId
    }
    const unchanged = await handleApplyCanvas(update)
    expect(unchanged.mutationCount).toBe(0)
    expect(unchanged.createdNodeIds).toEqual([])
    expect(unchanged.updatedNodeIds).toEqual([])
    expect(root.children).toContain(unmanaged)

    const changed = await handleApplyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId,
      root: {
        key: 'card',
        type: 'FRAME',
        children: [
          {
            key: 'card/title',
            nodeId: created.nodeIdsByKey['card/title'],
            type: 'TEXT',
            text: { characters: 'Updated' }
          }
        ]
      }
    })
    expect(changed.mutationCount).toBe(1)
    expect(changed.updatedNodeIds).toEqual([created.nodeIdsByKey['card/title']])
    expect(root.children).toContain(unmanaged)
    expect(
      (fixture.getNode(created.nodeIdsByKey['card/title'] ?? '') as unknown as TextNode).characters
    ).toBe('Updated')
  })

  it('treats independent corner-radius bindings as unchanged', async () => {
    const fixture = createFixture()
    const input: ApplyCanvasParametersInput = {
      mode: 'create',
      root: {
        key: 'card',
        type: 'FRAME',
        layout: { mode: 'VERTICAL', padding: 8 },
        appearance: { cornerRadius: 8 },
        variables: { cornerRadius: { id: 'variable:spacing' } }
      }
    }
    const created = await handleApplyCanvas(input)
    const root = fixture.getNode(created.rootNodeId) as unknown as FrameNode

    expect([root.paddingTop, root.paddingRight, root.paddingBottom, root.paddingLeft]).toEqual([
      8, 8, 8, 8
    ])

    await expect(
      handleApplyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })
  })

  it('applies an unbound font field when the other field uses a variable', async () => {
    const fixture = createFixture()
    const input: ApplyCanvasParametersInput = {
      mode: 'create',
      root: {
        key: 'root',
        type: 'FRAME',
        children: [
          {
            key: 'root/title',
            type: 'TEXT',
            text: {
              fontFamily: 'Ignored fallback',
              fontStyle: 'Semi Bold'
            },
            variables: {
              fontFamily: { id: 'variable:font' }
            }
          }
        ]
      }
    }
    const created = await handleApplyCanvas(input)
    const title = fixture.getNode(created.nodeIdsByKey['root/title'] ?? '') as unknown as TextNode

    expect(title.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' })
    await expect(
      handleApplyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects a root key already owned by another node in the update scope', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const owner = fixture.createNode('RECTANGLE')
    const frame = root as unknown as FrameNode
    frame.insertChild(0, owner)
    owner.setSharedPluginData('tempad-dev', 'canvas-key', 'root')

    await expect(
      handleApplyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        root: {
          key: 'root',
          type: 'FRAME'
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
    expect(fixture.triggerUndo).toHaveBeenCalledTimes(1)
  })

  it('reuses keyed descendants nested below unsupported containers', async () => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const nested = fixture.createNode('RECTANGLE')
    const group = {
      id: 'group:1',
      type: 'GROUP',
      parent: root,
      children: [nested]
    } as unknown as GroupNode
    PAGE.children.splice(PAGE.children.indexOf(nested), 1)
    nested.parent = group
    root.children.push(group)
    root.setSharedPluginData('tempad-dev', 'canvas-key', 'root')
    nested.setSharedPluginData('tempad-dev', 'canvas-key', 'root/nested')
    fixture.nodes.set(group.id, group)

    const result = await handleApplyCanvas({
      mode: 'update',
      targetNodeId: root.id,
      root: {
        key: 'root',
        type: 'FRAME',
        children: [{ key: 'root/nested', type: 'RECTANGLE', visible: false }]
      }
    })

    expect(result.createdNodeIds).toEqual([])
    expect(result.nodeIdsByKey['root/nested']).toBe(nested.id)
    expect(nested.visible).toBe(false)
  })

  it('rejects nodes outside the update scope and rolls back partial work', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas(createSpec())
    const foreign = fixture.createNode('RECTANGLE')

    await expect(
      handleApplyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId,
        root: {
          key: 'card',
          type: 'FRAME',
          children: [
            {
              key: 'foreign',
              nodeId: foreign.id,
              type: 'RECTANGLE'
            }
          ]
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE
    })
    expect(fixture.triggerUndo).toHaveBeenCalledTimes(1)
  })

  it('wraps Figma failures and reports when automatic rollback is unavailable', async () => {
    const fixture = createFixture()
    fixture.loadFontAsync.mockRejectedValueOnce(new Error('font unavailable'))

    await expect(handleApplyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: 'font unavailable'
    })
    expect(fixture.triggerUndo).toHaveBeenCalledTimes(1)

    fixture.loadFontAsync.mockRejectedValueOnce(new Error('font unavailable'))
    fixture.triggerUndo.mockImplementationOnce(() => {
      throw new Error('undo unavailable')
    })
    await expect(handleApplyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('automatic rollback was not available')
    })
  })

  it('serializes concurrent apply requests within one Figma session', async () => {
    const fixture = createFixture()
    let finishFontLoad: (() => void) | undefined
    fixture.loadFontAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFontLoad = resolve
        })
    )

    const first = handleApplyCanvas(createSpec())
    await vi.waitFor(() => expect(finishFontLoad).toBeTypeOf('function'))
    await expect(handleApplyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_BUSY
    })

    finishFontLoad?.()
    await expect(first).resolves.toMatchObject({ rootNodeId: expect.any(String) })
  })
})
