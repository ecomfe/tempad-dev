import type {
  ApplyCanvasParametersInput,
  CanvasFigmaProperties,
  CanvasResolvedApplyParameters
} from '@tempad-dev/shared'

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

import type { FigmaFixture, MutableNode } from '../../fakes/figma'

import {
  createFixture,
  createMockPage,
  mockVariable,
  mockVariableCollection,
  solidPaint
} from '../../fakes/figma'

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
  resetAssetCache()
  setAssetDownloader(null)
  setAssetServerUrl(null)
  setAssetUploader(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/canvas', () => {
  it('ignores copied ownership data on a duplicated managed frame', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="child" class="size-10"/></div>'
    })
    const root = fixture.getNode(created.rootNodeId!)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    const copy = child.clone()
    expect(copy.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(child.id)
    root.appendChild(copy)
    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: root.id,
      native: { child: { figma: { name: 'Original' } } }
    })
    expect(child.name).toBe('Original')
    expect(copy.name).not.toBe('Original')
    expect(copy.removed).toBe(false)
  })

  it('does not rewrite scalar values already stored at float32 precision', async () => {
    const fixture = createFixture({ float32: ['opacity'] })
    const markup = '<div data-key="root" class="w-20 h-20 opacity-30"/>'
    const created = await applyCanvas({ mode: 'create', markup })
    const root = fixture.getNode(created.rootNodeId!)
    expect(root.opacity).toBe(Math.fround(0.3))
    const write = vi.spyOn(root, 'opacity', 'set')
    await expect(
      applyCanvas({ mode: 'update', targetNodeId: root.id, markup })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['lineHeight', 'letterSpacing'] as const)(
    'preserves float32 %s without suppressing unit or value changes',
    async (field) => {
      const fixture = createFixture()
      const property = field === 'lineHeight' ? 'leading' : 'tracking'
      const markup = (utility: string) =>
        `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 ${utility}">Label</span></div>`
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: markup(`${property}-[24.1px]`)
      })
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      let stored: LetterSpacing = { unit: 'PIXELS', value: Math.fround(24.1) }
      const write = vi.fn((value: LetterSpacing) => {
        stored = { ...value, value: Math.fround(value.value) }
      })
      Object.defineProperty(label, field, { configurable: true, get: () => stored, set: write })
      const update = (measure: LetterSpacing) =>
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          markup: markup(`${property}-[${measure.value}${measure.unit === 'PIXELS' ? 'px' : '%'}]`)
        })

      await expect(update({ unit: 'PIXELS', value: 24.1 })).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
      expect(write).not.toHaveBeenCalled()
      await update({ unit: 'PIXELS', value: 24.2 })
      expect(write).toHaveBeenLastCalledWith({ unit: 'PIXELS', value: 24.2 })
      await update({ unit: 'PERCENT', value: 24.2 })
      expect(write).toHaveBeenLastCalledWith({ unit: 'PERCENT', value: 24.2 })
      expect(write).toHaveBeenCalledTimes(2)
    }
  )

  it('adopts a copied subtree by exact ids and converges with float32 native values', async () => {
    const fixture = createFixture({ float32: ['opacity', 'width', 'height'] })
    const markup =
      '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="child" class="flex flex-col w-[80.1px] h-[80.3px] opacity-30"><div data-key="leaf" class="w-[40.1px] h-[40.3px] opacity-30"/></div></div>'
    const created = await applyCanvas({ mode: 'create', markup })
    const root = fixture.getNode(created.rootNodeId!)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    const leaf = fixture.getNode(created.nodeIdsByKey.leaf!)
    const copy = child.clone() as FrameNode
    const copiedLeaf = copy.children[0] as FrameNode
    root.appendChild(copy)
    await expect(
      applyCanvas({ mode: 'update', targetNodeId: root.id, markup })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(copy.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(child.id)
    expect(copiedLeaf.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(leaf.id)

    const adoptedMarkup = `<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="copy" data-node-id="${copy.id}" class="flex flex-col w-[80.1px] h-[80.3px] opacity-30"><div data-key="copy/leaf" data-node-id="${copiedLeaf.id}" class="w-[40.1px] h-[40.3px] opacity-30"/></div></div>`
    const adopted = await applyCanvas({
      mode: 'update',
      targetNodeId: root.id,
      markup: adoptedMarkup
    })
    expect(adopted.createdNodeIds).toEqual([])
    expect(adopted.nodeIdsByKey).toMatchObject({ copy: copy.id, 'copy/leaf': copiedLeaf.id })
    expect(copy.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(copy.id)
    expect(copiedLeaf.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(copiedLeaf.id)
    expect(child.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('child')
    expect(leaf.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('leaf')
    expect(root.children).toContain(child)
    expect(child.children).toEqual([leaf])
    const writes = [copy, copiedLeaf].flatMap((node) => [
      vi.spyOn(node, 'opacity', 'set'),
      vi.spyOn(node, 'resize')
    ])
    await expect(
      applyCanvas({ mode: 'update', targetNodeId: root.id, markup: adoptedMarkup })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(copy).toMatchObject({
      opacity: Math.fround(0.3),
      width: Math.fround(80.1),
      height: Math.fround(80.3)
    })
    expect(copiedLeaf).toMatchObject({
      opacity: Math.fround(0.3),
      width: Math.fround(40.1),
      height: Math.fround(40.3)
    })
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  })

  it('reports ignored literals while preserving existing bindings', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-20 h-20"/>',
      bindings: { root: { variables: { opacity: { id: 'variable:spacing' } } } }
    })
    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: '<div data-key="root" class="w-20 h-20 opacity-30"/>'
    })
    expect(updated.verification.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'literal-ignored-by-binding',
          key: 'root',
          message: expect.stringContaining('opacity')
        })
      ])
    )
    expect(fixture.getNode(created.rootNodeId!).boundVariables).toMatchObject({
      opacity: { id: 'variable:spacing' }
    })
  })

  it('rejects variable type mismatches before creating resources', async () => {
    createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-20 h-20 bg-white"/>',
        variableCollections: {
          theme: {
            name: 'Theme',
            modes: { light: { name: 'Light' } },
            variables: { color: { name: 'Color', type: 'STRING', values: { light: 'red' } } }
          }
        },
        bindings: { root: { variables: { fill: { variableKey: 'color' } } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('expected COLOR')
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it.each([
    'http://example.com/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://localhost./video.mp4',
    'https://host.local./video.mp4',
    'https://[::1]/video.mp4',
    'https://192.168.1.1/video.mp4'
  ])('rejects unsafe video URL %s before network access', async (url) => {
    createFixture()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(applyCanvas(videoUrlSpec(url))).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('public HTTPS')
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining('CANVAS_UNSUPPORTED_EDITOR')
    })

    vi.stubGlobal('window', {
      INITIAL_OPTIONS: { editor_type: 'whiteboard' }
    } as unknown as Window)
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining('CANVAS_UNSUPPORTED_EDITOR')
    })

    vi.stubGlobal('window', {
      INITIAL_OPTIONS: { editor_type: 'design' }
    } as unknown as Window)
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      throw Object.setPrototypeOf(new Error('Cannot write to internal and read-only nodes'), null)
    })
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('requires edit access')
    })
    expect(fixture.commitUndo).toHaveBeenCalledOnce()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()

    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      throw 'Cannot write to internal and read-only nodes'
    })
    await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining('INVALID_CANVAS_SPEC')
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

    const root = fixture.getNode(result.rootNodeId!) as unknown as FrameNode
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

  it('normalizes an instance-swap component-set id to its default variant', async () => {
    const fixture = createFixture()
    const set = fixture.createNode('COMPONENT_SET') as unknown as ComponentSetNode
    const variant = fixture.createNode('COMPONENT') as unknown as ComponentNode
    set.appendChild(variant)
    const result = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="instance" class="w-20 h-20"/></div>',
      native: {
        instance: { component: { id: 'component:1' }, componentProperties: { Icon: set.id } }
      }
    })
    const instance = fixture.getNode(result.nodeIdsByKey.instance!) as unknown as InstanceNode
    expect(instance.componentProperties.Icon?.value).toBe(variant.id)
  })

  it('does not apply Auto Layout sizing fields to freeform children', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
      targetNodeId: created.rootNodeId!,
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
    const first = fixture.getNode(firstResult.rootNodeId!)
    const second = fixture.getNode(secondResult.rootNodeId!)
    const third = fixture.getNode(thirdResult.rootNodeId!)

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
    expect(fixture.getNode(transformedResult.rootNodeId!).relativeTransform).toEqual([
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

    expect(fixture.getNode(first.rootNodeId!)).toMatchObject({ x: 0, y: 0 })
    expect(fixture.getNode(second.rootNodeId!)).toMatchObject({ x: 180, y: 0 })
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
      targetNodeId: created.rootNodeId!
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
      targetNodeId: created.rootNodeId!
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    root.strokeLeftWeight = 2
    root.strokeRightWeight = 2
    const child = fixture.getNode(created.nodeIdsByKey.child!) as unknown as FrameNode
    child.resize(0, child.height)
    child.maxWidth = 0
    const nativeResize = child.resize.bind(child)
    vi.spyOn(child, 'resize').mockImplementation((width, height) => {
      if (width < 0.01) throw new Error('Figma requires width >= 0.01')
      nativeResize(width, height)
    })

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ updatedNodeIds: expect.arrayContaining([child.id]) })
    expect(child.width).toBe(0.01)
  })

  it('floors growing text width before Figma resize with a zero max-width constraint', async () => {
    const fixture = createFixture()
    let textResize: ReturnType<typeof vi.spyOn> | undefined
    vi.mocked(figma.createText).mockImplementationOnce(() => {
      const node = fixture.createNode('TEXT')
      const nativeResize = node.resize.bind(node)
      textResize = vi.spyOn(node, 'resize').mockImplementation((width, height) => {
        if (width < 0.01) throw new Error('Figma requires width >= 0.01')
        nativeResize(width, height)
      })
      return node as unknown as TextNode
    })
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[320px] h-[40px]"><span data-key="label" class="grow w-fit h-fit max-w-[0px]">Label</span></div>'
    }

    await expect(applyCanvas(input)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('growing text collapsed to zero width')
    })
    expect(textResize).toHaveBeenCalledWith(0.01, expect.any(Number))
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
      targetNodeId: created.rootNodeId!
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
        targetNodeId: created.rootNodeId!
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('fill geometry does not match')
    })
    // The ignored setter left no new change for Undo to distinguish from the prior create.
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(child.width).toBe(0)
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
        targetNodeId: created.rootNodeId!,
        markup: `
          <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
            <div data-key="child" class="w-full h-[80px]"></div>
          </div>
        `
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining(
        'declared horizontal=FILL, vertical=FIXED, grow=false; applied horizontal=FIXED'
      )
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(child.layoutSizingHorizontal).toBe('FIXED')
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
    const root = fixture.getNode(created.rootNodeId!)
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
      targetNodeId: created.rootNodeId!
    }
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 1 })
    expect(root.relativeTransform).toEqual(rootTransform)
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('applies right and bottom absolute offsets as resolved native positions', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: `
        <div data-key="root" class="flex flex-row w-[400px] h-[240px]">
          <div data-key="badge" class="absolute right-[14px] bottom-[18px] w-[64px] h-[30px]"></div>
        </div>
      `
    }

    const created = await applyCanvas(input)
    const badge = fixture.getNode(created.nodeIdsByKey.badge!)

    expect(created.verification.status).toBe('passed')
    expect(badge).toMatchObject({ layoutPositioning: 'ABSOLUTE', x: 322, y: 192 })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0, verification: { status: 'passed' } })
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
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updatedTransform: Transform = [
      [0.8, 0.6, 0],
      [-0.6, 0.8, 0]
    ]
    const update: CanvasResolvedApplyParameters = {
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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

    const review = fixture.getNode(created.rootNodeId!) as unknown as SectionNode
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
      targetNodeId: created.rootNodeId!
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

    const icon = fixture.getNode(created.rootNodeId!) as unknown as GroupNode
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
      targetNodeId: created.rootNodeId!
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
        targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
    expect(figma.group).toHaveBeenCalledTimes(1)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup:
          '<div data-key="icon" class="w-fit h-fit"><div data-key="cutout" class="absolute left-[0px] top-[0px] w-fit h-fit"></div></div>',
        bindings: {
          icon: { figma: { group: true } },
          cutout: { figma: { booleanOperation: 'EXCLUDE' } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
  })

  it('combines existing keyed components into a new component set', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[400px] h-[400px]"><div data-key="a" class="w-[100px] h-[40px]"></div><div data-key="b" class="w-[100px] h-[40px]"></div></div>',
      native: {
        a: { figma: { name: 'State=A', component: { type: 'COMPONENT' } } },
        b: { figma: { name: 'State=B', component: { type: 'COMPONENT' } } }
      }
    })
    const a = fixture.getNode(created.nodeIdsByKey.a!) as unknown as ComponentNode
    const instance = a.createInstance()
    const input = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-[400px] h-[400px]"><div data-key="set" class="flex flex-col w-[200px] h-[120px]"><div data-key="a" class="w-[100px] h-[40px]"></div><div data-key="b" class="w-[100px] h-[40px]"></div></div></div>',
      native: { set: { figma: { component: { type: 'COMPONENT_SET' as const } } } }
    }
    const updated = await applyCanvasFromTool(input)
    expect(updated.nodeIdsByKey.a).toBe(a.id)
    expect(updated.nodeIdsByKey.b).toBe(created.nodeIdsByKey.b)
    expect(instance.mainComponent?.id).toBe(a.id)
    expect(updated.createdNodeIds).toEqual([updated.nodeIdsByKey.set])
    const reapplied = await applyCanvasFromTool(input)
    expect(reapplied.createdNodeIds).toEqual([])
    expect(reapplied.mutationCount).toBe(0)
  })

  it('preflights moving the last child out of a retained group', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="group" class="w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div></div>',
      native: { group: { figma: { group: true } } }
    })
    const root = fixture.getNode(created.rootNodeId!)
    const group = fixture.getNode(created.nodeIdsByKey.group!)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    fixture.commitUndo.mockClear()

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div>'
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('Moving these children would leave GROUP')
    })
    expect(root.children).toEqual([group])
    expect(group.children).toEqual([child])
    expect(group.removed).toBe(false)
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it('reparents a child while preserving a nonempty omitted group', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="group" class="w-fit h-fit"><div data-key="keep" class="absolute left-0 top-0 w-10 h-10"></div><div data-key="move" class="absolute left-0 top-0 w-10 h-10"></div></div></div>',
      native: { group: { figma: { group: true } } }
    })
    const group = fixture.getNode(created.nodeIdsByKey.group!)
    const keep = fixture.getNode(created.nodeIdsByKey.keep!)
    const move = fixture.getNode(created.nodeIdsByKey.move!)
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="move" class="absolute left-0 top-0 w-10 h-10"></div></div>'
    })
    expect(updated.verification.status).toBe('passed')
    expect(group.removed).toBe(false)
    expect(group.children).toEqual([keep])
    expect(move.parent?.id).toBe(created.rootNodeId)
  })

  it('preserves a rescued child when its explicitly removed group auto-deletes', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="group" class="w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div><div data-key="tail" class="w-10 h-10"></div></div>',
      native: { group: { figma: { group: true } } }
    })
    const group = fixture.getNode(created.nodeIdsByKey.group!)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div><div data-key="tail" class="w-10 h-10"></div></div>',
      removeKeys: ['group']
    })
    expect(updated.verification.status).toBe('passed')
    expect(updated.removedNodeIds).toEqual([group.id])
    expect(group.removed).toBe(true)
    expect(child.removed).toBe(false)
    expect(child.parent?.id).toBe(created.rootNodeId)
    expect(fixture.getNode(created.rootNodeId!).children.map((node) => node.id)).toEqual([
      child.id,
      created.nodeIdsByKey.tail
    ])
    expect(fixture.nodes.has(group.id)).toBe(false)
  })

  it.each(['hyperlink', 'Pattern paint'])(
    'rejects removing an auto-deleting group referenced by an external %s',
    async (reference) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="destination" class="w-20 h-20"></div><div data-key="group" class="w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div></div>',
        native: { group: { figma: { group: true } } }
      })
      const group = fixture.getNode(created.nodeIdsByKey.group!)
      if (reference === 'hyperlink') {
        const link = fixture.createNode('TEXT') as unknown as TextNode
        link.characters = 'External link'
        link.hyperlink = { type: 'NODE', value: group.id }
      } else {
        const paint = fixture.createNode('RECTANGLE')
        paint.fills = [
          {
            type: 'PATTERN',
            sourceNodeId: group.id,
            tileType: 'RECTANGULAR',
            scalingFactor: 1,
            spacing: { x: 0, y: 0 },
            horizontalAlignment: 'CENTER'
          }
        ]
      }

      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          markup:
            '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="destination" class="w-20 h-20"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div></div>',
          removeKeys: ['group']
        })
      ).rejects.toMatchObject({
        // This fixture does not emulate Undo, so inspect the preserved original failure.
        cause: {
          code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
          message: `Node "${group.id}" is still referenced outside the removal scope.`
        }
      })
    }
  )

  it.each(['retain outer', 'retain nonempty outer', 'remove both', 'referenced outer'])(
    'checks cascading group auto-deletion: %s',
    async (scenario) => {
      const fixture = createFixture()
      const keep =
        scenario === 'retain nonempty outer'
          ? '<div data-key="keep" class="absolute left-0 top-0 w-10 h-10"></div>'
          : ''
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: `<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="outer" class="w-fit h-fit"><div data-key="inner" class="absolute left-0 top-0 w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div>${keep}</div></div>`,
        native: { outer: { figma: { group: true } }, inner: { figma: { group: true } } }
      })
      const root = fixture.getNode(created.rootNodeId!)
      const outer = fixture.getNode(created.nodeIdsByKey.outer!)
      const inner = fixture.getNode(created.nodeIdsByKey.inner!)
      const child = fixture.getNode(created.nodeIdsByKey.child!)
      if (scenario === 'referenced outer') {
        const link = fixture.createNode('TEXT') as unknown as TextNode
        link.hyperlink = { type: 'NODE', value: outer.id }
      }
      fixture.commitUndo.mockClear()
      const update = applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div>',
        removeKeys: scenario.startsWith('retain') ? ['inner'] : ['inner', 'outer']
      })
      if (scenario === 'retain outer') {
        await expect(update).rejects.toMatchObject({
          code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
          message: expect.stringContaining(outer.id)
        })
        expect(fixture.commitUndo).not.toHaveBeenCalled()
        expect(root.children).toEqual([outer])
        expect(outer.children).toEqual([inner])
        expect(inner.children).toEqual([child])
      } else if (scenario === 'referenced outer') {
        await expect(update).rejects.toMatchObject({
          cause: {
            code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE,
            message: `Node "${outer.id}" is still referenced outside the removal scope.`
          }
        })
      } else {
        await expect(update).resolves.toMatchObject({
          removedNodeIds: scenario === 'retain nonempty outer' ? [inner.id] : [inner.id, outer.id],
          verification: { status: 'passed' }
        })
        expect(inner.removed).toBe(true)
        expect(child.removed).toBe(false)
        if (scenario === 'retain nonempty outer') {
          expect(root.children).toEqual([outer, child])
          expect(outer.children.map((node) => node.id)).toEqual([created.nodeIdsByKey.keep])
          expect(outer.removed).toBe(false)
        } else {
          expect(root.children).toEqual([child])
          expect(outer.removed).toBe(true)
        }
      }
    }
  )

  it.each(['before', 'after'])(
    'checks an outer group populated %s its last original child auto-deletes',
    async (order) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="outer" class="w-fit h-fit"><div data-key="inner" class="absolute left-0 top-0 w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div></div></div>',
        native: { outer: { figma: { group: true } }, inner: { figma: { group: true } } }
      })
      const outer = fixture.getNode(created.nodeIdsByKey.outer!)
      const inner = fixture.getNode(created.nodeIdsByKey.inner!)
      const child = fixture.getNode(created.nodeIdsByKey.child!)
      const desiredOuter =
        '<div data-key="outer" class="w-fit h-fit"><div data-key="replacement" class="absolute left-0 top-0 w-10 h-10"></div></div>'
      const desiredChild = '<div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div>'
      fixture.commitUndo.mockClear()
      const update = applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: `<div data-key="root" class="flex flex-col w-80 h-80">${order === 'before' ? desiredOuter + desiredChild : desiredChild + desiredOuter}</div>`,
        native: { outer: { figma: { group: true } } },
        removeKeys: ['inner']
      })
      if (order === 'after') {
        await expect(update).rejects.toMatchObject({
          code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
          message: expect.stringContaining(outer.id)
        })
        expect(fixture.commitUndo).not.toHaveBeenCalled()
        expect(outer.removed).toBe(false)
        expect(inner.removed).toBe(false)
        expect(inner.children).toEqual([child])
        return
      }
      const updated = await update
      expect(updated.verification.status).toBe('passed')
      expect(outer.removed).toBe(false)
      expect(inner.removed).toBe(true)
      expect(outer.children.map((node) => node.id)).toEqual([updated.nodeIdsByKey.replacement])
      expect(child.parent?.id).toBe(created.rootNodeId)
    }
  )

  it('keeps an existing group alive while a new frame adopts its last original descendant', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="group" class="w-fit h-fit"><div data-key="inner" class="absolute left-0 top-0 w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div></div>',
      native: { group: { figma: { group: true } }, inner: { figma: { group: true } } }
    })
    const group = fixture.getNode(created.rootNodeId!)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: group.id,
      markup:
        '<div data-key="group" class="w-fit h-fit"><div data-key="frame" class="absolute left-0 top-0 w-20 h-20"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div></div>',
      native: { group: { figma: { group: true } } },
      removeKeys: ['inner']
    })
    expect(updated.verification.status).toBe('passed')
    expect(group.removed).toBe(false)
    expect(child.removed).toBe(false)
    expect(group.children.map((node) => node.id)).toEqual([updated.nodeIdsByKey.frame])
    expect(child.parent?.id).toBe(updated.nodeIdsByKey.frame)
  })

  it('retains an outer group replenished between two inner group removals', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="outer" class="w-fit h-fit"><div data-key="first" class="absolute left-0 top-0 w-fit h-fit"><div data-key="a" class="absolute left-0 top-0 w-10 h-10"></div></div><div data-key="second" class="absolute left-0 top-0 w-fit h-fit"><div data-key="b" class="absolute left-0 top-0 w-10 h-10"></div></div></div></div>',
      native: {
        outer: { figma: { group: true } },
        first: { figma: { group: true } },
        second: { figma: { group: true } }
      }
    })
    const outer = fixture.getNode(created.nodeIdsByKey.outer!)
    const first = fixture.getNode(created.nodeIdsByKey.first!)
    const second = fixture.getNode(created.nodeIdsByKey.second!)
    const a = fixture.getNode(created.nodeIdsByKey.a!)
    const b = fixture.getNode(created.nodeIdsByKey.b!)
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="a" class="absolute left-0 top-0 w-10 h-10"></div><div data-key="outer" class="w-fit h-fit"><div data-key="replacement" class="absolute left-0 top-0 w-10 h-10"></div></div><div data-key="b" class="absolute left-0 top-0 w-10 h-10"></div></div>',
      native: { outer: { figma: { group: true } } },
      removeKeys: ['first', 'second']
    })
    expect(updated.verification.status).toBe('passed')
    expect(first.removed).toBe(true)
    expect(second.removed).toBe(true)
    expect(outer.removed).toBe(false)
    expect(outer.children.map((node) => node.id)).toEqual([updated.nodeIdsByKey.replacement])
    expect(fixture.getNode(created.rootNodeId!).children).toEqual([a, outer, b])
  })

  it('rejects variant staging that empties an ancestor before reconciling its replacement child', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="outer" class="w-fit h-fit"><div data-key="inner" class="absolute left-0 top-0 w-fit h-fit"><div data-key="a" class="absolute left-0 top-0 w-20 h-20"></div><div data-key="b" class="absolute left-20 top-0 w-20 h-20"></div></div></div></div>',
      native: {
        outer: { figma: { group: true } },
        inner: { figma: { group: true } },
        a: { figma: { name: 'State=A', component: { type: 'COMPONENT' } } },
        b: { figma: { name: 'State=B', component: { type: 'COMPONENT' } } }
      }
    })
    const root = fixture.getNode(created.rootNodeId!)
    const outer = fixture.getNode(created.nodeIdsByKey.outer!)
    const inner = fixture.getNode(created.nodeIdsByKey.inner!)
    const a = fixture.getNode(created.nodeIdsByKey.a!)
    const b = fixture.getNode(created.nodeIdsByKey.b!)
    const ids = [...fixture.nodes.keys()]
    fixture.commitUndo.mockClear()

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="set" class="flex flex-row w-80 h-40"><div data-key="a" class="w-40 h-40"><div data-key="outer" class="absolute left-0 top-0 w-fit h-fit"><div data-key="replacement" class="absolute left-0 top-0 w-10 h-10"></div></div></div><div data-key="b" class="w-20 h-20"></div></div></div>',
        native: {
          set: { figma: { component: { type: 'COMPONENT_SET' } } },
          a: { figma: { component: { type: 'COMPONENT' } } },
          b: { figma: { component: { type: 'COMPONENT' } } },
          outer: { figma: { group: true } }
        },
        removeKeys: ['inner']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining(outer.id)
    })
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect([...fixture.nodes.keys()]).toEqual(ids)
    expect(root.children).toEqual([outer])
    expect(outer.children).toEqual([inner])
    expect(inner.children).toEqual([a, b])
    expect(outer.removed).toBe(false)
    expect(inner.removed).toBe(false)
  })

  it.each([
    'clear hyperlink',
    'clear Pattern paint',
    'link to rescued child',
    'external link to rescued child'
  ])('allows group auto-deletion after reconciling references: %s', async (reference) => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="destination" class="w-20 h-20"></div><div data-key="group" class="w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div><span data-key="link" class="w-fit h-fit">Link</span></div>',
      native: { group: { figma: { group: true } } }
    })
    const group = fixture.getNode(created.nodeIdsByKey.group!)
    const child = fixture.getNode(created.nodeIdsByKey.child!)
    const link = (reference === 'external link to rescued child'
      ? fixture.createNode('TEXT')
      : fixture.getNode(created.nodeIdsByKey.link!)) as unknown as TextNode
    if (reference === 'clear Pattern paint') {
      link.fills = [
        {
          type: 'PATTERN',
          sourceNodeId: group.id,
          tileType: 'RECTANGULAR',
          scalingFactor: 1,
          spacing: { x: 0, y: 0 },
          horizontalAlignment: 'CENTER'
        }
      ]
    } else {
      link.hyperlink = {
        type: 'NODE',
        value: reference.endsWith('rescued child') ? child.id : group.id
      }
    }
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="destination" class="w-20 h-20"><div data-key="child" class="absolute left-0 top-0 w-10 h-10"></div></div><span data-key="link" class="w-fit h-fit">Link</span></div>',
      native:
        reference === 'clear Pattern paint'
          ? { link: { figma: { fills: [] } } }
          : reference === 'clear hyperlink'
            ? { link: { figma: { text: { hyperlink: null } } } }
            : undefined,
      removeKeys: ['group']
    })
    expect(updated.verification.status).toBe('passed')
    expect(group.removed).toBe(true)
    expect(child.removed).toBe(false)
    expect(child.parent?.id).toBe(created.nodeIdsByKey.destination)
    if (reference === 'clear Pattern paint') expect(link.fills).toEqual([])
    else
      expect(link.hyperlink).toEqual(
        reference === 'clear hyperlink' ? null : { type: 'NODE', value: child.id }
      )
  })

  it('moves existing nested nodes into sibling positions in a new group', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[400px] h-[400px]"><div data-key="a" class="w-[100px] h-[100px]"><div data-key="b" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div></div></div>'
    })
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-[400px] h-[400px]"><div data-key="group" class="w-fit h-fit"><div data-key="a" class="absolute left-[0px] top-[0px] w-[100px] h-[100px]"></div><div data-key="b" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div></div></div>',
      native: { group: { figma: { group: true } } }
    })
    expect(fixture.getNode(updated.nodeIdsByKey.group!).children.map((child) => child.id)).toEqual([
      created.nodeIdsByKey.a,
      created.nodeIdsByKey.b
    ])
    expect(updated.createdNodeIds).toEqual([updated.nodeIdsByKey.group])
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

    const variants = fixture.getNode(created.rootNodeId!) as unknown as ComponentSetNode
    const defaultVariant = fixture.getNode(
      created.nodeIdsByKey.default!
    ) as unknown as ComponentNode
    const hoverVariant = fixture.getNode(created.nodeIdsByKey.hover!) as unknown as ComponentNode
    expect(defaultVariant).toMatchObject({ fills: [], clipsContent: false })
    expect(hoverVariant).toMatchObject({ fills: [], clipsContent: false })
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
      targetNodeId: created.rootNodeId!
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
        targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
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
    const set = fixture.getNode(created.rootNodeId!) as unknown as ComponentSetNode
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
    const card = fixture.getNode(created.rootNodeId!) as unknown as ComponentNode
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
      targetNodeId: created.rootNodeId!
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      targetNodeId: draft.rootNodeId!,
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>',
      native: {
        'screen/action': {
          component: { id: authored.rootNodeId! },
          componentProperties: { label: 'Save' }
        }
      },
      removeKeys: ['screen/action-draft']
    })

    const action = fixture.getNode(replaced.nodeIdsByKey['screen/action']!) as InstanceNode
    const mainComponent = await action.getMainComponentAsync()
    expect(mainComponent?.id).toBe(authored.rootNodeId!)
    expect(action.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('screen/action')
    expect(Object.values(action.componentProperties)).toContainEqual({
      type: 'TEXT',
      value: 'Save'
    })
    expect((fixture.getNode(draft.rootNodeId!) as FrameNode).children).toEqual([action])
  })

  it('rejects same-key primitive-to-instance replacement before mutation', async () => {
    const fixture = createFixture()
    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>'
    })
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="button" class="w-[160px] h-[48px]"></div>',
      native: {
        button: { figma: { component: { type: 'COMPONENT' } } }
      }
    })
    const root = fixture.getNode(screen.rootNodeId!) as FrameNode
    const component = fixture.getNode(authored.rootNodeId!)
    fixture.commitUndo.mockClear()
    fixture.triggerUndo.mockClear()

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: screen.rootNodeId!,
        markup:
          '<div data-key="screen" class="flex flex-col w-[321px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>',
        native: {
          'screen/action': { component: { id: authored.rootNodeId! } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining(
        'give the instance a new key and remove the primitive key in the same update'
      )
    })

    expect(root.width).toBe(320)
    expect(component.removed).toBe(false)
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('explains how to replace an update root with an instance', async () => {
    const fixture = createFixture()
    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action-draft" class="w-[160px] h-[48px]"></div></div>'
    })
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="button" class="w-[160px] h-[48px]"></div>',
      native: {
        button: { figma: { component: { type: 'COMPONENT' } } }
      }
    })
    const draftNodeId = screen.nodeIdsByKey['screen/action-draft']!
    fixture.commitUndo.mockClear()
    fixture.triggerUndo.mockClear()

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: draftNodeId,
        markup: '<div data-key="screen/action" class="w-[160px] h-[48px]"></div>',
        native: {
          'screen/action': { component: { id: authored.rootNodeId! } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringMatching(
        /update root cannot become an instance in place.*bounded ancestor.*new key.*remove the old keyed node/
      )
    })

    expect(fixture.getNode(draftNodeId)).toMatchObject({ removed: false, type: 'FRAME' })
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
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
        'screen/track-1': { component: { id: authored.rootNodeId! } },
        'screen/track-2': { component: { id: authored.rootNodeId! } }
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
        'screen/send': { component: { id: authored.rootNodeId! } }
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

  it('warns when Text layout bounds and in-flow content exceed an auto-layout parent', async () => {
    const fixture = createFixture()
    const markup =
      '<div data-key="screen" class="flex flex-col w-[100px] h-[80px]"><span data-key="screen/title" class="w-[80px] h-[20px]">Title</span><div data-key="screen/row" class="w-[80px] h-[40px]"></div></div>'
    const created = await applyCanvasFromTool({ mode: 'create', markup })
    const screen = fixture.getNode(created.rootNodeId!)
    const title = fixture.getNode(created.nodeIdsByKey['screen/title']!)
    const row = fixture.getNode(created.nodeIdsByKey['screen/row']!)
    Object.defineProperties(screen, {
      absoluteBoundingBox: { value: { x: 0, y: 0, width: 100, height: 80 } }
    })
    Object.defineProperties(title, {
      absoluteBoundingBox: { value: { x: 30, y: 0, width: 80, height: 20 } },
      absoluteRenderBounds: { value: null }
    })
    Object.defineProperties(row, {
      absoluteBoundingBox: { value: { x: 0, y: 60, width: 80, height: 40 } }
    })

    const verified = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup
    })

    expect(verified.verification).toMatchObject({
      status: 'warning',
      warnings: expect.arrayContaining([
        {
          code: 'managed-content-overflow',
          key: 'screen/title',
          message: expect.stringMatching(/right 10px/)
        },
        {
          code: 'managed-content-overflow',
          key: 'screen/row',
          message: expect.stringMatching(/bottom 20px/)
        }
      ])
    })
  })

  it('warns when filled children hide a rounded parent stroke', async () => {
    const fixture = createFixture()
    const markup =
      '<div data-key="phone" class="flex flex-col w-[390px] h-[844px] border-[2px] border-[#17212B] rounded-[28px] overflow-hidden box-border"><div data-key="phone/header" class="w-full h-[50px] bg-white"></div><div data-key="phone/body" class="grow w-full h-fit"></div><div data-key="phone/nav" class="w-full h-[64px] bg-white"></div></div>'
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup
    })
    const nav = fixture.getNode(created.nodeIdsByKey['phone/nav']!) as SceneNode
    nav.y = 780
    const phone = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup
    })

    expect(phone.verification).toMatchObject({
      status: 'warning',
      warnings: expect.arrayContaining([
        {
          code: 'managed-rounded-stroke-occlusion',
          key: 'phone/header',
          message: expect.stringMatching(/top-left and top-right.*rounded.*parent "phone"/)
        },
        {
          code: 'managed-rounded-stroke-occlusion',
          key: 'phone/nav',
          message: expect.stringMatching(/bottom-right and bottom-left.*parent stroke behind/)
        }
      ])
    })

    const inset = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="inset" class="flex flex-col w-[390px] h-[844px] border-[2px] border-[#17212B] rounded-[28px] overflow-hidden box-border"><div data-key="inset/header" class="w-full h-[50px] rounded-[28px] bg-white"></div><div data-key="inset/body" class="grow w-full h-fit"></div><div data-key="inset/nav" class="w-full h-[64px] rounded-[28px] bg-white"></div></div>'
    })
    expect(inset.verification.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'managed-rounded-stroke-occlusion' })
      ])
    )
  })

  it('warns when a fixed start-aligned auto-layout leaves unmodeled trailing space', async () => {
    const fixture = createFixture()
    const looseMarkup =
      '<div data-key="card" class="flex flex-col w-[200px] h-[72px] p-[12px] border border-[#000000]"><div data-key="card/content" class="w-[20px] h-[20px]"></div></div>'
    const loose = await applyCanvasFromTool({
      mode: 'create',
      markup: looseMarkup
    })
    const looseRoot = fixture.getNode(loose.rootNodeId!) as FrameNode
    looseRoot.strokesIncludedInLayout = true
    looseRoot.strokeAlign = 'INSIDE'
    looseRoot.strokeBottomWeight = 1
    Object.defineProperties(looseRoot, {
      absoluteBoundingBox: { value: { x: 0, y: 0, width: 200, height: 72 } }
    })
    Object.defineProperties(fixture.getNode(loose.nodeIdsByKey['card/content']!), {
      absoluteBoundingBox: { value: { x: 13, y: 13, width: 20, height: 20 } }
    })
    const looseVerified = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: loose.rootNodeId!,
      markup: looseMarkup
    })

    expect(looseVerified.verification).toMatchObject({
      status: 'warning',
      warnings: expect.arrayContaining([
        {
          code: 'managed-auto-layout-inset-mismatch',
          key: 'card',
          message: expect.stringMatching(
            /39px bottom inset.*13px.*26px of unmodeled trailing space/
          )
        }
      ])
    })

    const balancedMarkup =
      '<div data-key="balanced" class="flex flex-col w-[200px] h-[46px] p-[12px] border border-[#000000]"><div data-key="balanced/content" class="w-[20px] h-[20px]"></div></div>'
    const balanced = await applyCanvasFromTool({
      mode: 'create',
      markup: balancedMarkup
    })
    const balancedRoot = fixture.getNode(balanced.rootNodeId!) as FrameNode
    balancedRoot.strokesIncludedInLayout = true
    balancedRoot.strokeAlign = 'INSIDE'
    balancedRoot.strokeBottomWeight = 1
    Object.defineProperties(balancedRoot, {
      absoluteBoundingBox: { value: { x: 0, y: 0, width: 200, height: 46 } }
    })
    Object.defineProperties(fixture.getNode(balanced.nodeIdsByKey['balanced/content']!), {
      absoluteBoundingBox: { value: { x: 13, y: 13, width: 20, height: 20 } }
    })
    const balancedVerified = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: balanced.rootNodeId!,
      markup: balancedMarkup
    })
    expect(balancedVerified.verification.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'managed-auto-layout-inset-mismatch' })
      ])
    )

    const owned = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="owned" class="flex flex-col w-[200px] h-[100px] p-[12px] gap-[8px]"><div data-key="owned/content" class="w-[20px] h-[20px]"></div><div data-key="owned/spacer" class="grow w-[20px] h-fit"></div></div>'
    })
    expect(owned.verification.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'managed-auto-layout-inset-mismatch' })
      ])
    )

    const fillMarkup =
      '<div data-key="fill-root" class="flex flex-col w-[300px] h-[64px] p-[12px]"><div data-key="fill-row" class="flex flex-row w-full h-[40px] px-[12px]"><div data-key="fill-row/content" class="w-[20px] h-[20px]"></div></div></div>'
    const fill = await applyCanvasFromTool({ mode: 'create', markup: fillMarkup })
    Object.defineProperties(fixture.getNode(fill.rootNodeId!), {
      absoluteBoundingBox: { value: { x: 0, y: 0, width: 300, height: 64 } }
    })
    Object.defineProperties(fixture.getNode(fill.nodeIdsByKey['fill-row']!), {
      absoluteBoundingBox: { value: { x: 12, y: 12, width: 276, height: 40 } }
    })
    Object.defineProperties(fixture.getNode(fill.nodeIdsByKey['fill-row/content']!), {
      absoluteBoundingBox: { value: { x: 24, y: 22, width: 20, height: 20 } }
    })
    const fillVerified = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: fill.rootNodeId!,
      markup: fillMarkup
    })
    expect(fillVerified.verification.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'managed-auto-layout-inset-mismatch' })
      ])
    )

    const horizontalMarkup =
      '<div data-key="button" class="flex flex-row items-center w-[70px] h-[44px] p-[12px]"><div data-key="button/icon" class="size-[20px]"></div></div>'
    const horizontal = await applyCanvasFromTool({
      mode: 'create',
      markup: horizontalMarkup
    })
    Object.defineProperties(fixture.getNode(horizontal.rootNodeId!), {
      absoluteBoundingBox: { value: { x: 0, y: 0, width: 70, height: 44 } }
    })
    Object.defineProperties(fixture.getNode(horizontal.nodeIdsByKey['button/icon']!), {
      absoluteBoundingBox: { value: { x: 12, y: 12, width: 20, height: 20 } }
    })
    const horizontalVerified = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: horizontal.rootNodeId!,
      markup: horizontalMarkup
    })
    expect(horizontalVerified.verification.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'managed-auto-layout-inset-mismatch',
          key: 'button',
          message: expect.stringMatching(/38px right inset.*12px.*26px of unmodeled trailing space/)
        })
      ])
    )
  })

  it('warns when authored instance content exceeds the native instance root', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="heading" class="w-[160px] h-[40px]"><span data-key="heading/title" class="absolute left-[0px] top-[0px] w-[160px] h-[64px]">A title that wraps beyond the component</span></div>',
      native: {
        heading: { figma: { component: { type: 'COMPONENT' } } }
      }
    })

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="w-[240px] h-[120px]"><div data-key="screen/heading" class="absolute left-[20px] top-[20px] w-[160px] h-[40px]"></div></div>',
      native: {
        'screen/heading': { component: { id: authored.rootNodeId! } }
      }
    })

    const instance = fixture.getNode(screen.nodeIdsByKey['screen/heading']!) as InstanceNode
    const overflowingTitle = fixture.createNode('TEXT')
    overflowingTitle.resize(160, 64)
    overflowingTitle.x = 0
    overflowingTitle.y = 0
    instance.insertChild(0, overflowingTitle)

    const verified = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: screen.rootNodeId!,
      markup:
        '<div data-key="screen" class="w-[240px] h-[120px]"><div data-key="screen/heading" class="absolute left-[20px] top-[20px] w-[160px] h-[40px]"></div></div>',
      native: {
        'screen/heading': { component: { id: authored.rootNodeId! } }
      }
    })

    expect(verified.verification).toMatchObject({
      status: 'warning',
      warnings: [
        {
          code: 'managed-content-overflow',
          key: 'screen/heading',
          message: expect.stringMatching(/instance content.*bottom 24px.*native INSTANCE bounds/)
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
        'screen/track': { component: { id: authored.rootNodeId! } }
      }
    })

    const update = {
      mode: 'update' as const,
      targetNodeId: screen.rootNodeId!,
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
      mode: 'create' as const,
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
    const componentSet = fixture.getNode(authored.rootNodeId!) as unknown as ComponentSetNode
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

    const screenInput = {
      mode: 'create' as const,
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/direct" class="w-[120px] h-[40px]"></div><div data-key="screen/default" class="w-[120px] h-[40px]"></div><div data-key="screen/active" class="w-[120px] h-[40px]"></div></div>',
      native: {
        'screen/direct': { component: { id: variant.id } },
        'screen/default': { component: { id: authored.rootNodeId! } },
        'screen/active': {
          component: { id: authored.rootNodeId! },
          componentProperties: { State: 'Active' }
        }
      }
    }
    const screen = await applyCanvasFromTool(screenInput)

    const direct = fixture.getNode(screen.nodeIdsByKey['screen/direct']!) as InstanceNode
    const fromSet = fixture.getNode(screen.nodeIdsByKey['screen/default']!) as InstanceNode
    const selected = fixture.getNode(screen.nodeIdsByKey['screen/active']!) as InstanceNode
    expect((await direct.getMainComponentAsync())?.id).toBe(variant.id)
    expect((await fromSet.getMainComponentAsync())?.id).toBe(variant.id)
    expect((await selected.getMainComponentAsync())?.id).toBe(active.id)
    const reapplied = await applyCanvasFromTool({
      ...screenInput,
      mode: 'update',
      targetNodeId: screen.rootNodeId!
    })
    expect(reapplied.mutationCount).toBe(0)
    expect(selected.swapComponent).not.toHaveBeenCalled()
    expect((await selected.getMainComponentAsync())?.id).toBe(active.id)

    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: screen.rootNodeId!,
      native: { 'screen/active': { component: { id: variant.id } } }
    })
    expect(vi.mocked(selected.swapComponent).mock.calls.map(([component]) => component.id)).toEqual(
      [variant.id]
    )
    expect((await selected.getMainComponentAsync())?.id).toBe(variant.id)
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
        track: { component: { id: authored.rootNodeId! } }
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
      id === authored.rootNodeId! ? null : (fixture.nodes.get(id) ?? null)
    )

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>',
      native: {
        'screen/action': { component: { id: authored.rootNodeId! } }
      }
    })

    expect(fixture.getNode(screen.nodeIdsByKey['screen/action']!).type).toBe('INSTANCE')
  })

  it('resolves a loaded component id without waiting for the async dynamic-page lookup', async () => {
    const fixture = createFixture()
    const authored = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="button" class="w-[160px] h-[48px]"></div>',
      native: {
        button: { figma: { component: { type: 'COMPONENT' } } }
      }
    })
    vi.mocked(figma.getNodeByIdAsync).mockClear()

    const screen = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/action" class="w-[160px] h-[48px]"></div></div>',
      native: {
        'screen/action': { component: { id: authored.rootNodeId! } }
      }
    })

    expect(fixture.getNode(screen.nodeIdsByKey['screen/action']!).type).toBe('INSTANCE')
    expect(figma.getNodeByIdAsync).not.toHaveBeenCalled()
  })

  it('resolves update targets and adopted descendants through async dynamic-page lookups', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const adopted = fixture.createNode('FRAME')
    root.appendChild(adopted)
    vi.mocked(figma.getNodeById).mockImplementation((id: string) =>
      id === created.rootNodeId! || id === adopted.id ? null : (fixture.nodes.get(id) ?? null)
    )

    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: `<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/adopted" data-node-id="${adopted.id}" class="w-[100px] h-[100px]"></div></div>`
    })

    expect(updated.nodeIdsByKey['screen/adopted']).toBe(adopted.id)
  })

  it('resolves a loaded update target without waiting for the async backend', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"></div>'
    })
    vi.mocked(figma.getNodeByIdAsync).mockClear()

    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"><div data-key="screen/child" class="w-[100px] h-[80px]"></div></div>'
    })

    expect(fixture.getNode(updated.nodeIdsByKey['screen/child']!).type).toBe('FRAME')
    expect(figma.getNodeByIdAsync).not.toHaveBeenCalled()
  })

  it('makes newly added frames transparent when update markup omits a background', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="screen" class="flex flex-col w-[320px] h-[200px]"></div>'
    })

    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining(message)
    })
    expect(fixture.page.children).toEqual([])
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('stages new variants on the page containing their destination', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[400px] h-[240px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId!)
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

    const update = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId! }
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

  it('rejects ungrounded instance state after markup and catalog resolution', async () => {
    createFixture()

    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-row w-[240px] h-[120px]"><div data-key="action" class="w-[80px] h-[40px]"></div></div>',
        bindings: {
          action: {
            componentProperties: { Label: 'Save' },
            figma: { instance: { scaleFactor: 1.25 } }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('requires an existing instance or a component reference')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
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
      targetNodeId: created.rootNodeId!,
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
    const container = fixture.createNode('COMPONENT')
    const primary = component.createInstance()
    container.appendChild(primary)
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
    expect(result.rootNodeId!).toBe(primary.id)
    expect(primary.isExposedInstance).toBe(true)
    expect(primary.parent).toBe(container)
    expect(container.children).toEqual([primary])
    expect(fixture.page.children).not.toContain(primary)
    expect(await primary.getMainComponentAsync()).toBe(component)
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
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
    expect(pageInstance.isExposedInstance).toBe(false)
  })

  it.each([
    ['unknown property', { Missing: 'value' }],
    ['inherited property', { constructor: 'value' }],
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
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      applyCanvas({ ...paths, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const preserving: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      targetNodeId: created.rootNodeId!
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: 'requires at least one path or network vertex'
    },
    {
      shape: {
        type: 'VECTOR' as const,
        paths: [{ windingRule: 'NONE' as const, data: 'm 0 0 l 1 1' }]
      },
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
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
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: 'expected PAINT'
    }
  ])(
    'rejects invalid vector authoring before mutation: $message',
    async ({ shape, code, message }) => {
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
        code:
          code === TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED
            ? code
            : TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        ...(code === TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC ? { cause: { code } } : {}),
        message: expect.stringContaining(message)
      })
      expect(figma.createVector).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['path', 'create'],
    ['region style', 'create'],
    ['path', 'update'],
    ['region style', 'update']
  ] as const)(
    'rejects an invalid vector %s in %s before creating unrelated style resources',
    async (invalid, mode) => {
      const fixture = createFixture()
      const markup =
        '<div data-key="root" class="flex w-[100px] h-[100px]"><div data-key="icon" class="w-[24px] h-[24px]"></div></div>'
      const created =
        mode === 'update'
          ? await applyCanvas({
              mode: 'create',
              markup,
              bindings: {
                icon: {
                  figma: {
                    shape: {
                      type: 'VECTOR',
                      paths: [{ windingRule: 'NONZERO', data: 'M 0 0 L 24 0 L 0 24 Z' }]
                    }
                  }
                }
              }
            })
          : undefined
      fixture.commitUndo.mockClear()
      vi.mocked(figma.createVector).mockClear()
      await expect(
        applyCanvas({
          mode,
          ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
          styles: {
            body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
          },
          bindings: {
            icon: {
              figma: {
                shape:
                  invalid === 'path'
                    ? { type: 'VECTOR', paths: [{ windingRule: 'NONE', data: 'm 0 0 l 1 1' }] }
                    : {
                        type: 'VECTOR',
                        network: {
                          vertices: [{ x: 0, y: 0 }],
                          segments: [{ start: 0, end: 0 }],
                          regions: [
                            {
                              windingRule: 'NONZERO',
                              loops: [[0]],
                              fillStyle: { id: 'style:text' }
                            }
                          ]
                        }
                      }
              }
            }
          }
        })
      ).rejects.toThrow(invalid === 'path' ? 'Unsupported vector path command' : 'expected PAINT')
      expect(figma.createTextStyle).not.toHaveBeenCalled()
      expect(figma.createVector).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['create', 'styles'],
    ['create', 'variableCollections'],
    ['update', 'styles'],
    ['update', 'variableCollections']
  ] as const)('preflights %s with empty %s before opening Undo', async (mode, resource) => {
    const fixture = createFixture()
    const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    const created = mode === 'update' ? await applyCanvas({ mode: 'create', markup }) : undefined
    fixture.commitUndo.mockClear()
    await expect(
      applyCanvas({
        mode,
        ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
        [resource]: {},
        bindings: { root: { figma: { effects: [{ type: 'SHADER', id: 'missing' }] } } }
      })
    ).rejects.toThrow('Shader "missing" could not be imported')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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

    const unchanged = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId! }
    await expect(applyCanvas(unchanged)).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!)
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
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
    expect(title.getRangeParagraphIndent(0, title.characters.length)).toBe(12)
    expect(title.paragraphSpacing).toBe(20)
    expect(fixture.importStyleByKeyAsync).toHaveBeenCalledWith('stroke-style-key')
    expect(fixture.loadFontAsync.mock.calls).toEqual(
      expect.arrayContaining([
        [{ family: 'Inter', style: 'Regular' }],
        [{ family: 'Inter', style: 'Bold' }]
      ])
    )

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="root" class="flex flex-col w-[320px] h-[200px] border-[3px]"></div>'
      })
    ).resolves.toMatchObject({
      mutationCount: 1,
      updatedNodeIds: [created.rootNodeId!]
    })
    expect(root.strokeWeight).toBe(3)
    expect(root.strokeStyleId).toBe('style:stroke')

    const detached: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      targetNodeId: created.rootNodeId!,
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
    expect(fixture.loadFontAsync.mock.calls).toEqual([
      [{ family: 'Inter', style: 'Bold' }],
      [{ family: 'Inter', style: 'Regular' }]
    ])
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const changed = structuredClone(input)
    changed.mode = 'update'
    changed.targetNodeId = created.rootNodeId!
    changed.bindings!.root!.figma!.autoLayout!.itemSpacing = -20
    await applyCanvas(changed)
    expect(root).toMatchObject({ itemSpacing: -20, counterAxisSpacing: -20 })
    await expect(applyCanvas(changed)).resolves.toMatchObject({ mutationCount: 0 })

    const cleared: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    expect(root.gridStyleId).toBe('style:grid')

    const direct: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!)
    expect(root.fills).not.toBe(figma.mixed)
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
    const root = fixture.getNode(created.rootNodeId!)
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
    const root = fixture.getNode(created.rootNodeId!)

    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    preserveRotation = false
    root.fills = root.fills as readonly Paint[]
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('direct fills do not match; automatic rollback'),
      cause: expect.objectContaining({
        message: 'Verification failed for "root": direct fills do not match.'
      })
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
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
    const wrapper = fixture.getNode(created.rootNodeId!)
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

    expect(retry.rootNodeId!).toBe(wrapper.id)
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
    const wrapper = fixture.getNode(created.rootNodeId!)
    const previous = wrapper.children[0] as MutableNode

    const updated = await applyCanvas({
      ...base,
      mode: 'update',
      targetNodeId: wrapper.id,
      assets: {
        icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' }
      }
    })

    expect(updated.rootNodeId!).toBe(wrapper.id)
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
    const wrapper = fixture.getNode(created.rootNodeId!)
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
        targetNodeId: created.rootNodeId!,
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

  it.each(['node', 'style'] as const)(
    'imports Hub image assets referenced by a %s without putting bytes in the canvas payload',
    async (consumer) => {
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
      const paint = { type: 'IMAGE', assetKey: 'hero', scaleMode: 'FILL' } as const
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup: '<div data-key="hero" class="w-[320px] h-[180px]"></div>',
        assets: { hero: { type: 'IMAGE', assetHash: hash } },
        ...(consumer === 'style'
          ? {
              styles: { hero: { type: 'PAINT', name: 'Hero image', paints: [paint] } },
              bindings: { hero: { styles: { fill: { styleKey: 'hero' } } } }
            }
          : { bindings: { hero: { figma: { fills: [paint] } } } })
      }

      const result = await applyCanvas(input)
      const root = fixture.getNode(result.rootNodeId!)
      const paints =
        consumer === 'style'
          ? (fixture.styles.get(root.fillStyleId)! as PaintStyle).paints
          : root.fills
      expect(downloader).toHaveBeenCalledWith(hash)
      expect(fixture.createImage).toHaveBeenCalledWith(bytes)
      expect(paints[0]).toMatchObject({
        imageHash: `image:${Array.from(bytes).join(',')}`,
        scaleMode: 'FILL',
        type: 'IMAGE'
      })
      expect(paints[0]).not.toHaveProperty('assetKey')

      await expect(
        applyCanvas({ ...input, mode: 'update', targetNodeId: result.rootNodeId! })
      ).resolves.toMatchObject({ mutationCount: 0 })
      expect(fixture.createImage).toHaveBeenCalledOnce()
    }
  )

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
    const root = fixture.getNode(created.rootNodeId!)
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
    const root = fixture.getNode(styled.rootNodeId!)
    expect(root.fillStyleId).toBe('style:fill')
    expect(root.strokeStyleId).toBe('style:stroke')

    const direct: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: styled.rootNodeId!,
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
        targetNodeId: styled.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('does not exist or is not a scene node')
    })
    await expect(
      applyCanvas(input({ fills: [{ type: 'SHADER', id: 'shader:effect' }] }))
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    fixture.commitUndo.mockClear()

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('Referenced node')
    })
    expect(obsolete.removed).toBe(false)
    expect(source.removed).toBe(false)
    expect(fixture.commitUndo).not.toHaveBeenCalled()

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('Referenced node')
    })
    expect(obsolete.removed).toBe(false)
    expect(source.removed).toBe(false)
    expect(fixture.commitUndo).not.toHaveBeenCalled()

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: `<div data-key="root" class="flex flex-row w-[320px] h-[200px]">
        <div data-key="source" class="w-[80px] h-[80px]"></div>
        <div data-key="surface" class="w-[100px] h-[100px]"></div>
      </div>`,
      bindings: { surface: { figma: { fills: [pattern({ sourceCanvasKey: 'source' })] } } },
      removeKeys: ['obsolete']
    })
    expect(source.parent?.id).toBe(created.rootNodeId)
    expect(source.removed).toBe(false)
    expect(obsolete.removed).toBe(true)
  })

  it('reports the first usage when a shared URL image cannot be loaded', async () => {
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
              ],
              strokes: [
                {
                  type: 'IMAGE',
                  imageUrl: 'https://images.example.com/invalid.png',
                  scaleMode: 'FIT'
                }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.IMAGE_IMPORT_FAILED },
      message: expect.stringMatching(
        /fill paint 0 on "root".*direct public image URL.*resolved image asset/
      )
    })
    expect(fixture.createImageAsync).toHaveBeenCalledTimes(1)
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!)
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('applies linear gradient classes as verified native fill paints', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] bg-linear-to-b from-[#F8FCFFFF] via-[#7AB8E0CC] to-[#1A5C9AFF]"></div>'
    }

    const created = await applyCanvas(input)
    const root = fixture.getNode(created.rootNodeId!)

    expect(created.verification.status).toBe('passed')
    expect(root.fills).toMatchObject([
      {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [
          [0, 1, 0],
          [-1, 0, 1]
        ],
        gradientStops: [
          { position: 0, color: { r: 248 / 255, g: 252 / 255, b: 1, a: 1 } },
          { position: 0.5, color: { r: 122 / 255, g: 184 / 255, b: 224 / 255, a: 0.8 } },
          { position: 1, color: { r: 26 / 255, g: 92 / 255, b: 154 / 255, a: 1 } }
        ]
      }
    ])
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0, verification: { status: 'passed' } })
  })

  it('accepts Figma float and explicit shadow-default normalization', async () => {
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
              ...(effect.type === 'DROP_SHADOW' ? { showShadowBehindNode: false } : {})
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
    expect(fixture.getNode(created.rootNodeId!).effects).toMatchObject([
      {
        type: 'DROP_SHADOW',
        color: {
          r: Math.fround(17 / 255),
          g: Math.fround(13 / 255),
          b: Math.fround(24 / 255),
          a: Math.fround(0.22)
        },
        showShadowBehindNode: false
      }
    ])
  })

  it('accepts Figma behind-node normalization when the desired shadow leaves it unspecified', async () => {
    const fixture = createFixture()
    transformNextFrameEffects(fixture, (effects) =>
      effects.map((effect) =>
        effect.type === 'DROP_SHADOW' ? { ...effect, showShadowBehindNode: true } : effect
      )
    )

    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="w-[320px] h-[200px] shadow-[0_24px_60px_rgba(17,13,24,0.22)]"></div>'
    })

    expect(created.verification.status).toBe('passed')
    expect(fixture.getNode(created.rootNodeId!).effects).toMatchObject([
      {
        type: 'DROP_SHADOW',
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
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
    const root = fixture.getNode(created.rootNodeId!)
    expect(root.effectStyleId).toBe('style:effect')

    const direct: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('expected COLOR')
    })
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('rejects known unclipped shadow spread before creating resources or opening undo', async () => {
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
        styles: {
          body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
        },
        bindings: { root: { figma: { effects: [effect] } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('clipped frame/instance with a visible fill')
    })
    expect(figma.createTextStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
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
      hangingPunctuation: true,
      hangingList: true,
      leadingTrim: 'CAP_HEIGHT',
      hyperlink: { type: 'URL', value: 'https://example.com' }
    })
    expect(copy.getRangeParagraphIndent(0, copy.characters.length)).toBe(12)
    expect(copy.getRangeParagraphSpacing(0, copy.characters.length)).toBe(16)
    expect(copy.getRangeListSpacing(0, copy.characters.length)).toBe(8)
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      hangingPunctuation: false,
      hangingList: false,
      leadingTrim: 'NONE',
      hyperlink: null
    })
    expect(copy.getRangeListSpacing(0, copy.characters.length)).toBe(0)
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
    const root = fixture.getNode(created.rootNodeId!)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    expect(root.name).toBe('Settings panel')
    expect(copy).toMatchObject({
      name: 'Initial label',
      characters: 'Initial label',
      autoRename: true
    })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const fixed: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      targetNodeId: created.rootNodeId!,
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
      root: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
        bindings: {
          copy: {
            figma: { text: { hyperlink: { type: 'NODE', value: 'missing:1' } } }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('does not exist')
    })
    expect(copy.hyperlink).toEqual({ type: 'NODE', value: target.id })
  })

  it.each([false, true])(
    'resolves forward stable-key hyperlinks after whole and ranged text paints with declared resources=%s',
    async (declareResources) => {
      const fixture = createFixture()
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="copy" class="w-full h-fit">Link text</span>
          <div data-key="target" class="w-[80px] h-[40px]"></div>
        </div>
      `,
        ...(declareResources
          ? { styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } } }
          : {}),
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
      expect(copy.getRangeFills(0, 4)).toMatchObject([
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }
      ])
      expect(copy.getRangeHyperlink(0, 4)).toEqual({ type: 'NODE', value: targetId })
      await expect(
        applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
      ).resolves.toMatchObject({ mutationCount: 0 })
    }
  )

  it('applies a deferred whole-node canvas-key hyperlink before range hyperlinks', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Link text</span><div data-key="target" class="w-[80px] h-[40px]"></div></div>'
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
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Link text</span><div data-key="target" class="w-[80px] h-[40px]"></div></div>',
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
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Inter', style: 'Bold' } },
      { fontName: { family: 'Roboto', style: 'Regular' } },
      { fontName: { family: 'Roboto', style: 'Bold' } }
    ])
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
    expect(copy.getRangeFontName(0, 5)).toEqual({ family: 'Roboto', style: 'Bold' })
    expect(copy.getRangeFontSize(0, 5)).toBe(22)
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('expected TEXT')
    })
    expect(fixture.page.children).toEqual([])
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
    const root = fixture.getNode(created.rootNodeId!)

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
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const updated: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!
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
      targetNodeId: created.rootNodeId!
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const unmanaged = fixture.createNode('RECTANGLE')
    root.insertChild(root.children.length, unmanaged)

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const mask = fixture.getNode(created.nodeIdsByKey.mask!)
    const unmanaged = fixture.createNode('RECTANGLE')
    root.appendChild(unmanaged)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const grid = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const swapped: CanvasResolvedApplyParameters = {
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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

  it('restores grid child fill sizing after manual placement', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="grid" class="grid grid-cols-2 grid-rows-1 w-[480px] h-[240px]">
          <div data-key="child" class="w-full h-full col-start-2 row-start-1"></div>
        </div>
      `
    })

    expect(fixture.getNode(created.nodeIdsByKey.child!)).toMatchObject({
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 1,
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'FILL'
    })
  })

  it('replaces removed grid children without colliding with their occupied cells', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: `
        <div data-key="grid" class="grid grid-cols-3 w-[720px] h-[240px] gap-[16px]">
          <div data-key="old-one" class="w-full h-full"></div>
          <div data-key="old-two" class="w-full h-full"></div>
          <div data-key="old-three" class="w-full h-full"></div>
        </div>
      `
    })
    const grid = fixture.getNode(created.rootNodeId!) as unknown as FrameNode

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: `
        <div data-key="grid" class="grid grid-cols-3 w-[720px] h-[240px] gap-[16px]">
          <div data-key="new-one" class="w-full h-full"></div>
          <div data-key="new-two" class="w-full h-full"></div>
          <div data-key="new-three" class="w-full h-full"></div>
        </div>
      `,
      removeKeys: ['old-one', 'old-two', 'old-three']
    })

    expect(grid.gridRowCount).toBe(1)
    expect(grid.children.map((child) => child.id)).toEqual([
      updated.nodeIdsByKey['new-one'],
      updated.nodeIdsByKey['new-two'],
      updated.nodeIdsByKey['new-three']
    ])
    expect(grid.children).toEqual([
      expect.objectContaining({ gridRowAnchorIndex: 0, gridColumnAnchorIndex: 0 }),
      expect.objectContaining({ gridRowAnchorIndex: 0, gridColumnAnchorIndex: 1 }),
      expect.objectContaining({ gridRowAnchorIndex: 0, gridColumnAnchorIndex: 2 })
    ])

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: `
          <div data-key="grid" class="grid grid-cols-3 w-[720px] h-[240px] gap-[16px]">
            <div data-key="new-one" class="w-full h-full"></div>
            <div data-key="new-two" class="w-full h-full"></div>
            <div data-key="new-three" class="w-full h-full"></div>
          </div>
        `,
        removeKeys: ['old-one', 'old-two', 'old-three']
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('restores automatic grid rows when only a removed cell needs staging', async () => {
    const fixture = createFixture()
    const markup = (key: string) =>
      `<div data-key="grid" class="grid grid-cols-1 w-[200px] h-[120px]"><div data-key="${key}" class="w-full h-full"></div></div>`
    const created = await applyCanvasFromTool({ mode: 'create', markup: markup('old') })
    const grid = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const update = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      markup: markup('new'),
      removeKeys: ['old']
    }
    await applyCanvasFromTool(update)
    expect(grid.gridAutoTracks).toBe('ROWS')
    expect(grid.gridRowCount).toBe(1)
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })
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
    const grid = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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
      targetNodeId: created.rootNodeId!,
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
    const grid = fixture.getNode(created.rootNodeId!) as unknown as FrameNode

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
      targetNodeId: created.rootNodeId!,
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
    const grid = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0 })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: `
        <div
          data-key="root"
          class="flex flex-row flex-nowrap content-normal box-content overflow-visible w-[400px] h-[240px] gap-[8px]"
        >
          <span data-key="one" class="grow w-fit h-fit min-w-0 min-h-[0px] max-w-none">One</span>
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
    expect(one).toMatchObject({ minWidth: null, minHeight: null, maxWidth: null })
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const unmanaged = fixture.createNode('RECTANGLE')
    root.insertChild(0, unmanaged)

    const update: CanvasResolvedApplyParameters = {
      ...createSpec(),
      mode: 'update',
      targetNodeId: created.rootNodeId!
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
      targetNodeId: created.rootNodeId!
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
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="route" class="w-[140px] h-[0px]"></div></div>'
    })

    expect(updated.createdNodeIds).toEqual([])
    expect(updated.nodeIdsByKey.route).toBe(route.id)
    expect(route).toMatchObject({ type: 'LINE', width: 140, height: 0, strokeWeight: 2 })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
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
    const set = fixture.getNode(created.rootNodeId!)
    const completed = fixture.getNode(created.nodeIdsByKey['set/completed']!)
    const pending = fixture.getNode(created.nodeIdsByKey['set/pending']!)

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
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
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    root.name = 'Manual root name'

    const updated = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
    root.name = 'Manual root name'
    copy.name = 'Manual copy name'

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
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
      targetNodeId: created.rootNodeId!,
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
      targetNodeId: created.rootNodeId!,
      markup: `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <span data-key="rescue" class="w-full h-fit">Keep me</span>
        </div>
      `,
      removeKeys: ['obsolete']
    })

    expect(result.removedNodeIds).toEqual([created.nodeIdsByKey.obsolete])
    expect(rescue.parent?.id).toBe(created.rootNodeId!)
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
    const root = fixture.getNode(created.rootNodeId!)
    const removal: CanvasResolvedApplyParameters = {
      mode: 'remove',
      targetNodeId: created.rootNodeId!
    }

    await expect(applyCanvas(removal)).resolves.toEqual({
      rootNodeId: created.rootNodeId!,
      rootRemoved: true,
      nodeIdsByKey: {},
      createdNodeIds: [],
      updatedNodeIds: [],
      removedNodeIds: [created.rootNodeId!],
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
      rootNodeId: created.rootNodeId!,
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
    fixture.page.loadAsync.mockRejectedValue(new Error('current page is already loaded'))

    await expect(
      applyCanvas({
        mode: 'remove',
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId!]
    })
    expect(fixture.page.loadAsync).not.toHaveBeenCalled()
    expect(figma.loadAllPagesAsync).not.toHaveBeenCalled()
    expect(fixture.nodes.has(created.rootNodeId!)).toBe(false)
  })

  it('loads non-current pages through the batch API before removal validation', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    const otherPage = figma.createPage()

    await expect(
      applyCanvas({
        mode: 'remove',
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId!]
    })
    expect(figma.loadAllPagesAsync).toHaveBeenCalledOnce()
    expect(fixture.page.loadAsync).not.toHaveBeenCalled()
    expect(otherPage.loadAsync).toHaveBeenCalledOnce()
    expect(fixture.nodes.has(created.rootNodeId!)).toBe(false)

    const second = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="second" class="w-[320px] h-[200px]"></div>'
    })
    await expect(
      applyCanvas({
        mode: 'remove',
        targetNodeId: second.rootNodeId!
      })
    ).resolves.toMatchObject({ rootRemoved: true })
    expect(figma.loadAllPagesAsync).toHaveBeenCalledOnce()
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
    const root = fixture.getNode(created.rootNodeId!)
    const stale = { ...root, removed: false } as unknown as BaseNode
    vi.mocked(figma.getNodeByIdAsync).mockImplementation(async (id: string) =>
      id === root.id ? (root.removed ? stale : root) : (fixture.nodes.get(id) ?? null)
    )

    await expect(
      applyCanvasFromTool({
        mode: 'remove',
        targetNodeId: root.id
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
        mode: 'remove',
        targetNodeId: removable.rootNodeId!
      })
    ).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [removable.rootNodeId!]
    })
    expect(variant.removed).toBe(false)
  })

  it('rejects update-root removal when its subtree is not fully managed', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    })
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const manual = fixture.createNode('RECTANGLE')
    root.insertChild(0, manual)

    await expect(
      applyCanvas({
        mode: 'remove',
        targetNodeId: created.rootNodeId!
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      sourceNodeId: created.rootNodeId!,
      tileType: 'RECTANGULAR',
      scalingFactor: 1,
      spacing: { x: 0, y: 0 },
      horizontalAlignment: 'START'
    }
    const consumer = fixture.createNode('RECTANGLE')
    consumer.fills = [pattern]
    const removal: CanvasResolvedApplyParameters = {
      mode: 'remove',
      targetNodeId: created.rootNodeId!
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still referenced outside')
    })

    consumer.fills = []
    const style = figma.createPaintStyle()
    style.paints = [pattern]
    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still referenced outside')
    })

    style.remove()
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId!]
    })
  })

  it('protects instance descendants used by external node hyperlinks', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex w-[240px] h-[120px]"><div data-key="action" class="w-[80px] h-[40px]"></div></div>',
      bindings: { action: { component: { id: 'component:1' } } }
    })
    const instance = fixture.getNode(created.nodeIdsByKey.action!)
    const child = fixture.createNode('TEXT')
    instance.appendChild(child)
    const link = fixture.createNode('TEXT') as unknown as TextNode
    link.hyperlink = { type: 'NODE', value: child.id }
    const removal: CanvasResolvedApplyParameters = {
      mode: 'remove',
      targetNodeId: instance.id
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still referenced outside')
    })
    expect(instance.removed).toBe(false)
    expect(child.removed).toBe(false)

    link.hyperlink = null
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [instance.id]
    })
    expect(child.removed).toBe(true)
  })

  it('protects update roots used by live rich-text node hyperlinks', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[32px] h-[32px]"></div>'
    })
    const copy = fixture.createNode('TEXT') as unknown as TextNode
    copy.characters = 'Open details'
    copy.hyperlink = figma.mixed
    copy.setRangeHyperlink(0, 4, {
      type: 'NODE',
      value: created.rootNodeId!
    })
    const removal: CanvasResolvedApplyParameters = {
      mode: 'remove',
      targetNodeId: created.rootNodeId!
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still referenced outside')
    })

    copy.setRangeHyperlink(0, 4, null)
    copy.hyperlink = null
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [created.rootNodeId!]
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
      mode: 'remove',
      targetNodeId: target.id
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still referenced outside')
    })

    shaderStyle.remove()
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      rootRemoved: true,
      removedNodeIds: [target.id]
    })
  })

  it('ignores unrelated inaccessible shaders during node removal', async () => {
    createFixture()
    const target = figma.createFrame()
    target.setSharedPluginData('tempad_dev', 'canvas-key', 'target')
    const consumer = figma.createRectangle()
    consumer.effects = [
      { type: 'SHADER', id: 'unavailable', visible: true, properties: { swap: 'unrelated' } }
    ]
    await expect(applyCanvas({ mode: 'remove', targetNodeId: target.id })).resolves.toMatchObject({
      rootRemoved: true
    })
    expect(figma.importShaderById).not.toHaveBeenCalled()
  })

  it('inspects matching shader values without treating non-reference properties as references', async () => {
    createFixture()
    const target = figma.createComponent()
    target.setSharedPluginData('tempad_dev', 'canvas-key', 'target')
    const consumer = figma.createRectangle()
    consumer.effects = [
      { type: 'SHADER', id: 'shader:effect', visible: true, properties: { label: target.key } }
    ]
    const shader = await figma.importShaderById('shader:effect')
    vi.mocked(figma.importShaderById)
      .mockClear()
      .mockResolvedValue({
        ...shader,
        propertyDefinitions: { label: { name: 'Label', type: 'TEXT' } }
      })
    await expect(applyCanvas({ mode: 'remove', targetNodeId: target.id })).resolves.toMatchObject({
      rootRemoved: true
    })
    expect(figma.importShaderById).toHaveBeenCalledWith('shader:effect')
  })

  it('rejects a proven hidden descendant reference before inspecting unrelated styles', async () => {
    createFixture()
    const target = figma.createFrame()
    target.setSharedPluginData('tempad_dev', 'canvas-key', 'target')
    const consumer = figma.createFrame()
    consumer.visible = false
    const text = figma.createText()
    consumer.appendChild(text)
    text.hyperlink = { type: 'NODE', value: target.id }
    vi.mocked(figma.getLocalEffectStylesAsync).mockRejectedValueOnce(new Error('unavailable'))
    await expect(applyCanvas({ mode: 'remove', targetNodeId: target.id })).rejects.toThrow(
      `Node "${target.id}" is still referenced outside`
    )
    expect(figma.getLocalEffectStylesAsync).not.toHaveBeenCalled()
    expect(target.removed).toBe(false)
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
      targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['owned']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('not owned')
    })
    expect(manual.removed).toBe(false)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="replacement" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['root']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    root.insertChild(1, operation)

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['left']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="root" class="flex flex-row w-[300px] h-[100px]"></div>',
        removeKeys: ['remove']
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('requires every remaining sibling')
    })

    const result = await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      (fixture.getNode(created.rootNodeId!) as unknown as FrameNode).children.map(
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode

    expect([root.paddingTop, root.paddingRight, root.paddingBottom, root.paddingLeft]).toEqual([
      8, 8, 8, 8
    ])

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode

    expect(root.boundVariables).toMatchObject({
      minWidth: { id: 'variable:spacing' },
      maxHeight: { id: 'variable:spacing' },
      counterAxisSpacing: { id: 'variable:spacing' }
    })
    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
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
        targetNodeId: created.rootNodeId!,
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
        targetNodeId: created.rootNodeId!
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
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '') as unknown as TextNode

    const unbound: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
    const root = fixture.getNode(created.rootNodeId!)
    Object.assign(root.boundVariables, {
      strokes: [{ type: 'VARIABLE_ALIAS', id: 'variable:color' }]
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!)
    const copy = fixture.getNode(created.nodeIdsByKey.copy ?? '')
    expect(root.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:dark' })
    expect(copy.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:light' })
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })

    const cleared: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    const root = fixture.getNode(created.rootNodeId!)

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
    expect(fixture.page.explicitVariableModes).toEqual({
      [collection.id]: darkMode.modeId
    })
    expect(created.verification.status).toBe('passed')

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
    expect(fixture.page.explicitVariableModes).toEqual({
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message:
        'Variable authoring key "product/color/surafce" could not be resolved. [INVALID_CANVAS_SPEC]'
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
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

  it.each(['OPACITY', 'ALL_SCOPES'] as const)(
    'compares opacity fallbacks in native percentages with %s scope',
    async (scope) => {
      const fixture = createFixture()
      const input = {
        mode: 'create' as const,
        markup: '<div data-key="root" class="w-20 h-20 opacity-[0.5]"/>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { base: { name: 'Base' } },
            variables: {
              alpha: {
                name: 'Alpha',
                type: 'FLOAT' as const,
                scopes: [scope],
                values: { base: 50 }
              }
            }
          }
        },
        native: { root: { variables: { opacity: { variableKey: 'alpha' } } } }
      }
      const created = await applyCanvasFromTool(input)
      expect(created.verification.warnings).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'variable-fallback-mismatch' })])
      )
      const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
      const variableId = root.boundVariables?.opacity?.id
      expect(Object.values(fixture.variables.get(variableId!)!.valuesByMode)).toEqual([50])
      await expect(
        applyCanvasFromTool({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
      ).resolves.toMatchObject({ mutationCount: 0 })
      const mismatched = await applyCanvasFromTool({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        variableCollections: { tokens: { variables: { alpha: { values: { base: 0.5 } } } } }
      })
      expect(mismatched.verification.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'variable-fallback-mismatch',
            message: expect.stringContaining('0–100')
          })
        ])
      )
      expect(root.boundVariables?.opacity?.id).toBe(variableId)
      await applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: input.markup,
        native: { root: { variables: { opacity: null } } }
      })
      expect(root.opacity).toBe(0.5)
      expect(root.boundVariables?.opacity).toBeUndefined()
    }
  )

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

  it.each([
    { utility: 'font-semibold', value: 700, fallback: 600 },
    { utility: 'font-semibold', value: 600, fallback: undefined },
    { utility: 'font-[650]', value: 700, fallback: 650 },
    { utility: '', value: 700, fallback: undefined },
    { utility: '', value: 700, fallback: undefined, style: 'Custom Display' }
  ])(
    'compares only explicit numeric font weight fallbacks: $utility / $value / $style',
    async ({ utility, value, fallback, style }) => {
      createFixture()
      const result = await applyCanvas({
        mode: 'create',
        markup: `<div data-key="root" class="flex flex-col w-80 h-40"><span data-key="copy" class="w-fit h-fit ${utility}">Copy</span></div>`,
        variableCollections: {
          tokens: {
            name: 'Typography',
            modes: { default: { name: 'Default' } },
            variables: {
              weight: {
                name: 'Weight',
                type: 'FLOAT',
                scopes: ['FONT_WEIGHT'],
                values: { default: value }
              }
            }
          }
        },
        bindings: {
          copy: {
            variables: { fontWeight: { variableKey: 'weight' } },
            ...(style ? { figma: { text: { fontName: { family: 'Inter', style } } } } : {})
          }
        }
      })
      const warnings = result.verification.warnings.filter(
        (warning) => warning.code === 'variable-fallback-mismatch'
      )
      if (fallback === undefined) expect(warnings).toEqual([])
      else
        expect(warnings).toEqual([
          expect.objectContaining({
            key: 'copy',
            message: expect.stringContaining(`fontWeight ${fallback}`)
          })
        ])
    }
  )

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
    const fixture = createFixture()
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

    vi.mocked(figma.variables.createVariableCollection).mockClear()
    fixture.commitUndo.mockClear()
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('Authoring keys are file-wide')
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
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
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still selected')
    })

    await applyCanvas(update)

    expect(fixture.variables.has(surface.id)).toBe(false)
    expect(tokens.modes).not.toContainEqual(darkMode)
    expect(brand.modes).not.toContainEqual(inheritedDarkMode)
    expect(surfaceAlias.valuesByMode).toEqual({
      [tokens.defaultModeId]: { r: 0.5, g: 0.5, b: 0.5 }
    })
    expect(fixture.page.explicitVariableModes).toEqual({})
    expect(fixture.getNode(created.rootNodeId!).boundVariables.fills).toBeUndefined()
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup,
        variableCollections: {
          tokens: { modes: { light: null } }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('must retain at least one mode')
    })
  })

  it.each(['collection', 'variable', 'mode'] as const)(
    'loads cold pages before any write for an existing %s removal',
    async (kind) => {
      const fixture = createFixture()
      const created = await applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
            variables: { size: { name: 'Size', type: 'FLOAT', values: { light: 4, dark: 8 } } }
          }
        }
      })
      const page = figma.createPage()
      const loading = Promise.withResolvers<void>()
      vi.mocked(page.loadAsync).mockImplementationOnce(async () => {
        await loading.promise
        throw new Error('Cold page unavailable')
      })
      fixture.commitUndo.mockClear()
      const createCollection = vi.mocked(figma.variables.createVariableCollection)
      createCollection.mockClear()
      const removal = {
        collection: null,
        variable: { variables: { size: null } },
        mode: { modes: { dark: null } }
      }[kind]
      const pending = applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { figma: { name: 'Changed' } } },
        variableCollections: {
          added: { name: 'Added', modes: { base: { name: 'Base' } } },
          tokens: removal
        }
      }).catch((error: unknown) => error)
      let error: unknown
      try {
        await vi.waitFor(() => expect(page.loadAsync).toHaveBeenCalled())
        expect(fixture.commitUndo).not.toHaveBeenCalled()
        expect(createCollection).not.toHaveBeenCalled()
        expect(fixture.getNode(created.rootNodeId!).name).not.toBe('Changed')
      } finally {
        loading.resolve()
        error = await pending
      }
      expect(error).toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
        message: expect.stringContaining(`Page "${page.id}" could not be inspected`)
      })
    }
  )

  it.each(['existing page', 'new page'] as const)(
    'checks a late variable consumer on a %s after preloading pages',
    async (location) => {
      const fixture = createFixture()
      const created = await applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { base: { name: 'Base' } },
            variables: { size: { name: 'Size', type: 'FLOAT', values: { base: 4 } } }
          }
        }
      })
      const variable = [...fixture.variables.values()].find(
        (candidate) => candidate.getSharedPluginData?.('tempad_dev', 'variable-key') === 'size'
      )!
      let page = figma.createPage()
      const originalPage = page
      const root = fixture.getNode(created.rootNodeId!)
      let name = root.name
      let consumerId = ''
      Object.defineProperty(root, 'name', {
        configurable: true,
        get: () => name,
        set(value: string) {
          name = value
          if (value !== 'Changed') return
          if (location === 'new page') {
            originalPage.remove()
            page = figma.createPage()
          }
          const consumer = fixture.createNode('FRAME')
          consumer.boundVariables = { width: { type: 'VARIABLE_ALIAS', id: variable.id } }
          page.appendChild(consumer as SceneNode)
          consumerId = consumer.id
        }
      })
      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: root.id,
          native: { root: { figma: { name: 'Changed' } } },
          variableCollections: { tokens: { variables: { size: null } } }
        })
      ).rejects.toThrow(/Variable .*still used by node/)
      expect(consumerId).not.toBe('')
      expect(page.loadAsync).toHaveBeenCalledOnce()
      expect(originalPage.loadAsync).toHaveBeenCalledOnce()
      expect(variable.remove).not.toHaveBeenCalled()
    }
  )

  it('preloads pages without retaining bindings removed by the same variable patch', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { base: { name: 'Base' } },
          variables: {
            surface: { name: 'Surface', type: 'COLOR', values: { base: { r: 1, g: 1, b: 1 } } }
          }
        }
      },
      native: { root: { variables: { fill: { variableKey: 'surface' } } } }
    })
    const page = figma.createPage()
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { variables: { fill: null } } },
        variableCollections: { tokens: { variables: { surface: null } } }
      })
    ).resolves.toMatchObject({ verification: { status: 'passed' } })
    expect([...fixture.variables.values()].some((variable) => variable.name === 'Surface')).toBe(
      false
    )
    expect(page.loadAsync).toHaveBeenCalledOnce()
  })

  it('does not load pages for absent variable resource removals', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      variableCollections: { tokens: { name: 'Tokens', modes: { base: { name: 'Base' } } } }
    })
    const page = figma.createPage()
    vi.mocked(page.loadAsync).mockRejectedValue(new Error('Unrelated page unavailable'))
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { figma: { name: 'Changed' } } },
        variableCollections: {
          absent: null,
          tokens: { modes: { absent: null }, variables: { absent: null } }
        }
      })
    ).resolves.toMatchObject({ verification: { status: 'passed' } })
    expect(page.loadAsync).not.toHaveBeenCalled()
    expect(fixture.getNode(created.rootNodeId!).name).toBe('Changed')
  })

  it.each(['shader', 'rich text'] as const)(
    'removes only a mode without depending on unrelated %s reads',
    async (unavailable) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { light: { name: 'Light' }, dark: { name: 'Dark' } }
          }
        }
      })
      const text = fixture.createNode('TEXT')
      fixture.page.appendChild(text)
      const segments = vi.spyOn(text as unknown as TextNode, 'getStyledTextSegments')
      if (unavailable === 'rich text') {
        segments.mockImplementation(() => {
          throw new Error('Unrelated text cannot be read')
        })
      } else {
        vi.mocked(figma.listAvailableShaders).mockRejectedValue(new Error('Shaders unavailable'))
      }

      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          native: { root: { figma: { name: 'Updated' } } },
          variableCollections: { tokens: { modes: { dark: null } } }
        })
      ).resolves.toMatchObject({ verification: { status: 'passed' } })
      expect(figma.listAvailableShaders).not.toHaveBeenCalled()
      expect(segments).not.toHaveBeenCalled()
      const collection = [...fixture.variableCollections.values()].find(
        (candidate) =>
          candidate.getSharedPluginData?.('tempad_dev', 'variable-collection-key') === 'tokens'
      )!
      expect(collection.modes.map((mode) => mode.name)).toEqual(['Light'])
    }
  )

  it.each(['page', 'hidden node'] as const)(
    'still rejects mode-only removal selected by a %s',
    async (consumer) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { light: { name: 'Light' }, dark: { name: 'Dark' } }
          }
        }
      })
      const collection = [...fixture.variableCollections.values()].find(
        (candidate) =>
          candidate.getSharedPluginData?.('tempad_dev', 'variable-collection-key') === 'tokens'
      )!
      const dark = collection.modes.find((mode) => mode.name === 'Dark')!.modeId
      const node = fixture.createNode('FRAME')
      node.visible = false
      fixture.page.appendChild(node)
      const target = consumer === 'page' ? fixture.page : node
      target.explicitVariableModes[collection.id] = dark
      vi.mocked(figma.listAvailableShaders).mockRejectedValue(new Error('Shaders unavailable'))

      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          native: { root: { figma: { name: 'root' } } },
          variableCollections: { tokens: { modes: { dark: null } } }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
        message: expect.stringContaining(`still selected on "${target.id}"`)
      })
      expect(collection.modes.some((mode) => mode.modeId === dark)).toBe(true)
      expect(figma.listAvailableShaders).not.toHaveBeenCalled()
    }
  )

  it('keeps variable reference checks when removing a mode and a variable together', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
          variables: {
            surface: {
              name: 'Surface',
              type: 'COLOR',
              values: { light: { r: 1, g: 1, b: 1 }, dark: { r: 0, g: 0, b: 0 } }
            }
          }
        }
      },
      native: { root: { variables: { fill: { variableKey: 'surface' } } } }
    })
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { figma: { name: 'root' } } },
        variableCollections: { tokens: { modes: { dark: null }, variables: { surface: null } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still used by node')
    })
    expect(figma.listAvailableShaders).toHaveBeenCalledOnce()
    expect([...fixture.variables.values()].some((variable) => variable.name === 'Surface')).toBe(
      true
    )
  })

  it('checks references when a mode removal also creates and deletes collections', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px] bg-[#FFFFFF]"></div>',
      variableCollections: {
        modes: {
          name: 'Modes',
          modes: { light: { name: 'Light' }, dark: { name: 'Dark' } }
        },
        colors: {
          name: 'Colors',
          modes: { base: { name: 'Base' } },
          variables: {
            surface: { name: 'Surface', type: 'COLOR', values: { base: { r: 1, g: 1, b: 1 } } }
          }
        }
      },
      native: { root: { variables: { fill: { variableKey: 'surface' } } } }
    })

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { figma: { name: 'root' } } },
        variableCollections: {
          added: { name: 'Added', modes: { base: { name: 'Base' } } },
          modes: { modes: { dark: null } },
          colors: null
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still used by node')
    })
    expect(figma.listAvailableShaders).toHaveBeenCalledOnce()
    const surface = [...fixture.variables.values()].find(
      (variable) => variable.getSharedPluginData?.('tempad_dev', 'variable-key') === 'surface'
    )!
    expect(surface.remove).not.toHaveBeenCalled()
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
        targetNodeId: created.rootNodeId!,
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
    ).resolves.toMatchObject({ rootNodeId: created.rootNodeId! })

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

  it.each(['variable', 'collection'] as const)(
    'protects instance property bindings during %s removal until explicitly replaced',
    async (resource) => {
      const fixture = createFixture()
      const markup =
        '<div data-key="root" class="flex w-[240px] h-[120px]"><div data-key="action" class="w-[80px] h-[40px]"></div></div>'
      const created = await applyCanvas({
        mode: 'create',
        markup,
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { base: { name: 'Base' } },
            variables: {
              label: { name: 'Label', type: 'STRING', values: { base: 'Save' } }
            }
          }
        },
        bindings: {
          action: {
            component: { id: 'component:1' },
            componentProperties: { Label: { variable: { variableKey: 'label' } } }
          }
        }
      })
      const instance = fixture.getNode(created.nodeIdsByKey.action!) as unknown as InstanceNode
      const variableId = instance.componentProperties.Label!.boundVariables!.value!.id
      const variable = fixture.variables.get(variableId)!
      const removal: CanvasResolvedApplyParameters = {
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup,
        variableCollections: {
          tokens: resource === 'collection' ? null : { variables: { label: null } }
        }
      }

      await expect(applyCanvas(removal)).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
        message: expect.stringContaining('still used by')
      })
      expect(variable.remove).not.toHaveBeenCalled()
      expect(instance.componentProperties.Label!.boundVariables!.value!.id).toBe(variableId)

      await expect(
        applyCanvas({
          ...removal,
          bindings: { action: { componentProperties: { Label: 'Save' } } }
        })
      ).resolves.toMatchObject({ verification: { status: 'passed' } })
      expect(fixture.variables.has(variableId)).toBe(false)
      expect(instance.componentProperties.Label!.boundVariables?.value).toBeUndefined()
    }
  )

  it.each(['variable', 'collection'] as const)(
    'protects rich-text decoration colors during %s removal until explicitly cleared',
    async (resource) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-[240px] h-[120px]"><span data-key="copy" class="w-fit h-fit">Read more</span></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { base: { name: 'Base' } },
            variables: {
              accent: { name: 'Accent', type: 'COLOR', values: { base: { r: 1, g: 0, b: 0 } } }
            }
          }
        },
        native: {
          copy: {
            figma: {
              text: {
                ranges: [
                  {
                    start: 0,
                    end: 4,
                    textDecoration: 'UNDERLINE',
                    textDecorationColor: {
                      value: {
                        type: 'SOLID',
                        color: { r: 1, g: 0, b: 0 },
                        variables: { color: { variableKey: 'accent' } }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      })
      const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
      const color = copy.getRangeTextDecorationColor(0, 4) as { value: SolidPaint }
      const variableId = color.value.boundVariables!.color!.id
      const variable = fixture.variables.get(variableId)!
      const removal = {
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!,
        variableCollections: {
          tokens: resource === 'collection' ? null : { variables: { accent: null } }
        }
      }

      await expect(
        applyCanvasFromTool({
          ...removal,
          native: { root: { figma: { name: 'root' } } }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE }
      })
      expect(variable.remove).not.toHaveBeenCalled()
      expect(copy.getRangeTextDecorationColor(0, 4)).toEqual(color)

      await expect(
        applyCanvasFromTool({
          ...removal,
          native: {
            copy: {
              figma: {
                text: {
                  ranges: [{ start: 0, end: 4, textDecorationColor: { value: 'AUTO' } }]
                }
              }
            }
          }
        })
      ).resolves.toMatchObject({ verification: { status: 'passed' } })
      expect(fixture.variables.has(variableId)).toBe(false)
      expect(copy.getRangeTextDecorationColor(0, 4)).toEqual({ value: 'AUTO' })
    }
  )

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
    fixture.page.appendChild(componentSet)

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
        targetNodeId: created.rootNodeId!,
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
      targetNodeId: created.rootNodeId!,
      markup,
      variableCollections: {
        tokens: { variables: { base: null } }
      }
    }

    await expect(applyCanvas(removeBase)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      targetNodeId: created.rootNodeId!,
      markup,
      variableCollections: {
        colors: { variables: { accent: null } }
      }
    }

    await expect(applyCanvas(removeAccent)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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

  it('rejects a retained extension dependency before creating or changing resources', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      variableCollections: {
        tokens: { name: 'Tokens', modes: { base: { name: 'Base' } } },
        brand: { name: 'Brand', extends: { collectionKey: 'tokens' } }
      }
    })
    vi.mocked(figma.variables.createVariableCollection).mockClear()
    fixture.commitUndo.mockClear()
    fixture.triggerUndo.mockClear()
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { figma: { name: 'Changed' } } },
        variableCollections: {
          first: { name: 'First', modes: { base: { name: 'Base' } } },
          tokens: null
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still depends')
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(fixture.getNode(created.rootNodeId!).name).toBe('root')
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
        targetNodeId: created.rootNodeId!,
        markup,
        variableCollections: { tokens: null }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('still depends')
    })

    const removeBoth: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
    expect(fixture.page.explicitVariableModes).toEqual({ [brand.id]: dark.modeId })

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })

    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
    expect(fixture.getNode(result.rootNodeId!).boundVariables.itemSpacing).toEqual({
      type: 'VARIABLE_ALIAS',
      id: spacing.id
    })
  })

  it('creates a local theme, binds its consumers, and reuses it without redefining resources', async () => {
    const fixture = createFixture()
    const theme = {
      variables: {
        '--surface': { variableKey: 'product/surface' },
        '--space': { variableKey: 'product/space' }
      },
      textStyles: { 'type-body': { styleKey: 'product/body' } }
    }
    const markup =
      '<div data-key="card" class="flex flex-col w-[320px] h-[200px] bg-(--surface) gap-(--space)"><span data-key="body" class="w-full h-fit type-body">你好</span></div>'
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup,
      theme,
      variableCollections: {
        product: {
          name: 'Product',
          modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
          variables: {
            'product/surface': {
              name: 'Surface',
              type: 'COLOR',
              values: { light: { r: 1, g: 1, b: 1 }, dark: { r: 0, g: 0, b: 0 } }
            },
            'product/space': { name: 'Space', type: 'FLOAT', values: { light: 16, dark: 20 } }
          }
        }
      },
      styles: {
        'product/body': {
          type: 'TEXT',
          name: 'Product/Body',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 18,
          lineHeight: { unit: 'PIXELS', value: 28 }
        }
      }
    })
    const findVariable = (key: string) =>
      [...fixture.variables.values()].find(
        (variable) => variable.getSharedPluginData?.('tempad_dev', 'variable-key') === key
      )!
    const card = fixture.getNode(created.rootNodeId!)
    const body = fixture.getNode(created.nodeIdsByKey.body!) as unknown as TextNode
    expect(card.boundVariables.itemSpacing).toMatchObject({ id: findVariable('product/space').id })
    expect((card.fills as SolidPaint[])[0]!.boundVariables?.color).toMatchObject({
      id: findVariable('product/surface').id
    })
    expect(body.textStyleId).toBe(
      [...fixture.styles.values()].find((style) => style.name === 'Product/Body')!.id
    )
    expect(body.fontSize).toBe(18)
    expect(created.verification.warnings).toEqual([])
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: card.id,
      markup,
      theme
    })
    expect(updated.mutationCount).toBe(0)
    expect(
      [...fixture.styles.values()].filter((style) => style.name === 'Product/Body')
    ).toHaveLength(1)
    const changed = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: card.id,
      markup,
      theme,
      variableCollections: {
        product: { variables: { 'product/space': { values: { light: 24, dark: 32 } } } }
      }
    })
    expect(changed.verification.warnings).toEqual([])
    expect(card.boundVariables.itemSpacing).toMatchObject({ id: findVariable('product/space').id })
  })

  it.each(['key', 'id'])(
    'adds and consumes theme tokens in an existing collection identified by %s',
    async (identity) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: '<div data-key="root" class="flex flex-col w-[320px] h-[200px] gap-4"/>',
        variableCollections: {
          metrics: {
            name: 'Metrics',
            modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
            variables: {
              small: { name: 'Small', type: 'FLOAT', values: { light: 16, dark: 20 } }
            }
          }
        }
      })
      const collection = [...fixture.variableCollections.values()].find(
        (value) => value.name === 'Metrics'
      )!
      const update = {
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!,
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px] gap-(--space) p-(--inset)"/>',
        theme: {
          variables: {
            '--space': { variableKey: 'large-alias' },
            '--inset': { variableKey: 'large' }
          }
        },
        variableCollections: {
          metrics: {
            ...(identity === 'id' ? { id: collection.id } : {}),
            variables: {
              large: { name: 'Large', type: 'FLOAT', values: { light: 24, dark: 32 } },
              'large-alias': {
                name: 'Large alias',
                type: 'FLOAT',
                values: {
                  light: { variable: { variableKey: 'large' } },
                  dark: { variable: { variableKey: 'large' } }
                }
              }
            }
          }
        }
      }
      const updated = await applyCanvasFromTool(update)
      const root = fixture.getNode(updated.rootNodeId!)
      const large = [...fixture.variables.values()].find((value) => value.name === 'Large')!
      const alias = [...fixture.variables.values()].find((value) => value.name === 'Large alias')!
      expect(root.boundVariables.itemSpacing).toMatchObject({ id: alias.id })
      expect(root.boundVariables.paddingTop).toMatchObject({ id: large.id })
      expect(large.valuesByMode[collection.defaultModeId]).toBe(24)
      expect(collection.modes.map((mode) => mode.name)).toEqual(['Light', 'Dark'])
      expect((await applyCanvasFromTool(update)).mutationCount).toBe(0)
    }
  )

  it('places absolute edges from live mode and same-call variable values, idempotently', async () => {
    const fixture = createFixture()
    vi.mocked(figma.createFrame).mockImplementation(() => {
      const node = fixture.createNode('FRAME')
      for (const axis of ['width', 'height'] as const) {
        let literal = node[axis]
        Object.defineProperty(node, axis, {
          get: () => {
            const alias = node.boundVariables[axis] as VariableAlias | undefined
            const value = alias && fixture.variables.get(alias.id)?.resolveForConsumer(node).value
            return typeof value === 'number' ? value : literal
          },
          set: (value: number) => {
            literal = value
          }
        })
      }
      return node as unknown as FrameNode
    })
    const spec: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="w-(--parent-w) h-(--parent-h)"><div data-key="badge" class="absolute right-[16px] bottom-[12px] w-(--child-w) h-(--child-h)"/></div>',
      theme: {
        variables: {
          '--parent-w': { variableKey: 'parent-w' },
          '--parent-h': { variableKey: 'parent-h' },
          '--child-w': { variableKey: 'child-w' },
          '--child-h': { variableKey: 'child-h' }
        }
      },
      variableCollections: {
        metrics: {
          name: 'Metrics',
          modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
          variables: {
            'parent-w': { name: 'Parent width', type: 'FLOAT', values: { light: 320, dark: 640 } },
            'parent-h': { name: 'Parent height', type: 'FLOAT', values: { light: 180, dark: 360 } },
            'child-w': { name: 'Child width', type: 'FLOAT', values: { light: 100, dark: 200 } },
            'child-h': { name: 'Child height', type: 'FLOAT', values: { light: 30, dark: 60 } }
          }
        }
      },
      bindings: { root: { variableModes: { metrics: 'dark' } } }
    }
    const created = await applyCanvas(spec)
    const badge = fixture.getNode(created.nodeIdsByKey.badge!)
    expect([badge.x, badge.y]).toEqual([424, 288])
    spec.mode = 'update'
    spec.targetNodeId = created.rootNodeId!
    delete spec.variableCollections
    expect((await applyCanvas(spec)).mutationCount).toBe(0)
    spec.bindings!.root!.variableModes = { metrics: 'light' }
    await applyCanvas(spec)
    expect([badge.x, badge.y]).toEqual([204, 138])
    spec.variableCollections = {
      metrics: {
        variables: {
          'parent-w': { values: { light: 800 } },
          'child-w': { values: { light: 120 } }
        }
      }
    }
    await applyCanvas(spec)
    expect([badge.x, badge.y]).toEqual([664, 138])
    delete spec.variableCollections
    expect((await applyCanvas(spec)).mutationCount).toBe(0)
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
    const card = fixture.getNode(created.rootNodeId!)
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
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
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
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({
      verification: { status: 'passed', warnings: [] }
    })
  })

  it('adopts local styles and rejects unsafe or incompatible style resources', async () => {
    const fixture = createFixture()
    vi.mocked(figma.getStyleByIdAsync).mockImplementationOnce(async (id) => {
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      return fixture.styles.get(id) ?? null
    })
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
    expect(fixture.getNode(adopted.rootNodeId!).fillStyleId).toBe(legacy.id)
    expect(figma.createPaintStyle).not.toHaveBeenCalled()
    expect(figma.getStyleByIdAsync).toHaveBeenCalledOnce()

    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="missing" class="w-[100px] h-[100px]"></div>',
        styles: {
          missing: { type: 'PAINT' }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('must already exist')
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
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
      targetNodeId: created.rootNodeId!,
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      styles: {
        surface: null,
        orphan: null
      }
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      updatedNodeIds: [created.rootNodeId!]
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

  it('validates new variable resources and values before resource or canvas creation', async () => {
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('must be COLOR')
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('reconciles explicit state on the page containing the result', async () => {
    const fixture = createFixture()
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
    expect(created.updatedNodeIds).toContain(fixture.page.id)
    expect(fixture.page).toMatchObject({
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

    const update = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId! }
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
      updatedNodeIds: [fixture.page.id]
    })
    expect(fixture.page.explicitVariableModes).toEqual({})
    expect(fixture.page.guides).toEqual([])
    expect(fixture.page.name).toBe('Checkout')
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('has no mode')
    })
    expect(fixture.page.name).toBe('Checkout')
    expect(figma.createFrame).toHaveBeenCalledTimes(1)

    const otherPage = createMockPage('0:2', 'Other')
    const root = fixture.page.children.shift()!
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
    expect(fixture.page.name).toBe('Checkout')
  })

  it('preserves the current page and selection when creating on new or existing pages', async () => {
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
    expect(figma.currentPage).toBe(fixture.page)
    expect(created.page).toMatchObject({ id: checkout.id, active: false, selectionCount: 0 })
    expect(checkout).toMatchObject({
      name: 'Checkout',
      children: [{ id: created.rootNodeId! }]
    })
    expect(checkout.getSharedPluginData('tempad_dev', 'page-key')).toBe('flows/checkout')
    expect(fixture.page.children).toEqual([])

    await expect(
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })

    const second = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="second" class="w-[100px] h-[100px]"></div>',
      page: { pageKey: 'flows/checkout' }
    })
    expect(figma.createPage).toHaveBeenCalledOnce()
    expect(checkout.children.map((node) => node.id)).toEqual([
      created.rootNodeId!,
      second.rootNodeId!
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
    expect(existing.children[0]?.id).toBe(adopted.rootNodeId!)
    expect(existing.getSharedPluginData('tempad_dev', 'page-key')).toBe('flows/existing')
  })

  it('creates, updates, activates, reads context from, and removes an exact managed page', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      page: { pageKey: 'eval/fresh', name: 'Fresh evaluation' }
    })
    const page = fixture.pages[1]!

    expect(created).toMatchObject({
      page: {
        id: page.id,
        pageKey: 'eval/fresh',
        name: 'Fresh evaluation',
        active: false,
        childCount: 0,
        selectionCount: 0
      }
    })
    expect(created.rootNodeId).toBeUndefined()

    await expect(
      applyCanvas({
        mode: 'update',
        page: { pageKey: 'eval/fresh', name: 'Renamed evaluation' }
      })
    ).resolves.toMatchObject({ page: { name: 'Renamed evaluation', active: false } })

    const root = await applyCanvas({
      mode: 'create',
      page: { pageKey: 'eval/fresh' },
      markup: '<div data-key="eval/root" class="w-[320px] h-[200px]"></div>'
    })
    await applyCanvas({ mode: 'activate', page: { id: fixture.page.id }, selection: [] })
    expect(figma.currentPage).toBe(fixture.page)
    await expect(
      applyCanvas({
        mode: 'activate',
        page: { pageKey: 'eval/fresh' },
        selection: [root.rootNodeId!]
      })
    ).resolves.toMatchObject({
      mutationCount: 0,
      page: { id: page.id, active: true, selectionCount: 1 }
    })

    const removed = await applyCanvas({
      mode: 'remove',
      page: { id: page.id, pageKey: 'eval/fresh' }
    })
    expect(removed).toMatchObject({
      page: { id: page.id, pageKey: 'eval/fresh', removed: true, active: false },
      mutationCount: 1
    })
    expect(removed.removedNodeIds).toContain(root.rootNodeId!)
    expect(fixture.pages).toEqual([fixture.page])
    expect(figma.currentPage).toBe(fixture.page)
  })

  it('removes a managed page with an opaque SVG subtree but protects manual siblings', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      page: { pageKey: 'eval/svg', name: 'SVG' },
      markup: '<div data-key="icon" class="w-[24px] h-[24px]"></div>',
      assets: {
        icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' }
      },
      bindings: { icon: { figma: { svg: { assetKey: 'icon' } } } }
    })
    const wrapper = fixture.getNode(created.rootNodeId!)
    const imported = wrapper.children[0]!
    const manual = fixture.createNode('RECTANGLE')
    wrapper.appendChild(manual)
    const removal: CanvasResolvedApplyParameters = {
      mode: 'remove',
      page: { id: created.page!.id, pageKey: 'eval/svg' }
    }

    await expect(applyCanvas(removal)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('not owned')
    })
    expect(wrapper.removed).toBe(false)
    expect(imported.removed).toBe(false)
    expect(manual.removed).toBe(false)

    manual.remove()
    await expect(applyCanvas(removal)).resolves.toMatchObject({
      page: { id: created.page!.id, removed: true },
      removedNodeIds: expect.arrayContaining([wrapper.id, imported.id])
    })
    expect(fixture.pages).toEqual([fixture.page])
  })

  it('refuses to remove the last page or a managed page containing manual content', async () => {
    const fixture = createFixture()
    fixture.page.setSharedPluginData('tempad_dev', 'page-key', 'eval/only')
    await expect(
      applyCanvas({ mode: 'remove', page: { pageKey: 'eval/only' } })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE }
    })

    const created = await applyCanvas({
      mode: 'create',
      page: { pageKey: 'eval/manual', name: 'Manual content' }
    })
    const page = fixture.pages.find((candidate) => candidate.id === created.page?.id)!
    page.appendChild(fixture.createNode('RECTANGLE'))
    await expect(
      applyCanvas({ mode: 'remove', page: { pageKey: 'eval/manual' } })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('not owned')
    })
    expect(page.removed).toBe(false)
  })

  it('rejects an unavailable variable mode before creating the requested page', async () => {
    const fixture = createFixture()
    await expect(
      applyCanvas({
        mode: 'create',
        page: {
          pageKey: 'eval/rollback',
          name: 'Rollback',
          variableModes: { 'collection:tokens': 'mode:missing' }
        },
        markup: '<div data-key="rollback/root" class="w-[320px] h-[200px]"></div>'
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })

    expect(fixture.pages).toEqual([fixture.page])
    expect(figma.currentPage).toBe(fixture.page)
    expect(figma.triggerUndo).not.toHaveBeenCalled()
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
    expect(existing.children[0]?.id).toBe(created.rootNodeId!)
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
    expect(fixture.pages).toEqual([checkout, fixture.page])
    expect(figma.currentPage).toBe(fixture.page)

    const insertChild = vi.fn((index: number, page: ReturnType<typeof createMockPage>) => {
      const current = fixture.pages.indexOf(page)
      let target = index
      if (current >= 0) {
        fixture.pages.splice(current, 1)
        if (current < target) target -= 1
      }
      if (target > fixture.pages.length) throw new RangeError('page index is out of range')
      fixture.pages.splice(target, 0, page)
      page.parent = figma.root
    })
    ;(
      figma.root as unknown as {
        insertChild: typeof insertChild
      }
    ).insertChild = insertChild

    const moved = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      markup,
      page: { index: 1 }
    }
    await expect(applyCanvas(moved)).resolves.toMatchObject({
      updatedNodeIds: [checkout.id],
      mutationCount: 1
    })
    expect(fixture.pages).toEqual([fixture.page, checkout])
    expect(insertChild.mock.calls.map(([index]) => index)).toEqual([1, 2])
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('more than one')
    })

    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="owned" class="w-[100px] h-[100px]"></div>'
    })
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="owned" class="w-[100px] h-[100px]"></div>',
        page: { id: first.id }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('expected COLOR')
    })
    expect(fixture.page.children).toEqual([])
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
        targetNodeId: created.rootNodeId!,
        markup: '<div data-key="root" class="w-[320px] h-[200px] bg-[#000000]"></div>'
      })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(
      (fixture.getNode(created.rootNodeId!) as unknown as FrameNode).boundVariables?.fills
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
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
    ).resolves.toMatchObject({ mutationCount: 1 })
    expect(root.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(root.id)
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
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

  it('rejects nodes outside the update scope before mutation', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    const foreign = fixture.createNode('TEXT')
    fixture.commitUndo.mockClear()
    fixture.triggerUndo.mockClear()

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: `<div data-key="card" class="flex flex-col w-[320px] h-[200px]"><span data-key="foreign" data-node-id="${foreign.id}" class="w-full h-fit">Foreign</span></div>`
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE }
    })
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(fixture.nodes.has(created.rootNodeId!)).toBe(true)
  })

  it.each([
    { count: 99, rootKey: `root-${'r'.repeat(120)}`, keyLength: 115 },
    // Fits the raw 64 KiB limit, but exceeds it once the Hub adds runtime evidence.
    { count: 55, rootKey: 'root', keyLength: 117 }
  ])(
    'rolls back an apply result that would exceed the final response budget ($count nodes)',
    async ({ count, rootKey, keyLength }) => {
      const fixture = createFixture()
      const children = Array.from({ length: count }, (_, index) => {
        const key = `item-${index}-${'x'.repeat(keyLength)}`
        return `<span data-key="${key}" class="absolute left-[-10px] top-[0px] w-fit h-fit">X</span>`
      }).join('')

      await expect(
        applyCanvasFromTool({
          mode: 'create',
          markup: `<div data-key="${rootKey}" class="w-[100px] h-[100px]">${children}</div>`
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
        message: expect.stringContaining('64 KiB inline budget')
      })
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    }
  )

  it.each(['characters', 'fills'] as const)(
    'reports incomplete rollback of existing text %s',
    async (field) => {
      const fixture = createFixture()
      const created = await applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit text-[#112233]">Before</span></div>'
      })
      const copy = fixture.getNode(created.nodeIdsByKey.copy!) as TextNode
      vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
        throw new Error('paint unavailable')
      })
      fixture.triggerUndo.mockImplementationOnce(() => {
        if (field === 'characters') copy.characters = 'Corrupted'
        else Object.assign((copy.fills as SolidPaint[])[0]!.color, { r: 1 })
      })
      await expect(
        applyCanvas({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          markup:
            '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><div data-key="new" class="w-[12px] h-[12px] bg-[#112233]"></div></div>'
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        message: expect.stringContaining(`Rollback changed pre-existing node ${copy.id}`),
        cause: expect.objectContaining({ message: expect.stringContaining('paint unavailable') })
      })
    }
  )

  it.each([
    { mode: 'create', reference: 'whole hyperlink' },
    { mode: 'native update', reference: 'range hyperlink' },
    { mode: 'create', reference: 'image hash' },
    { mode: 'native update', reference: 'Pattern source' }
  ] as const)(
    'rejects a missing $reference in $mode before creating unrelated resources',
    async ({ mode, reference }) => {
      const fixture = createFixture()
      const markup =
        '<div data-key="root" class="flex flex-col w-80 h-40"><span data-key="label" class="w-fit h-fit">Label</span></div>'
      const created =
        mode === 'native update' ? await applyCanvasFromTool({ mode: 'create', markup }) : undefined
      const nodeIds = [...fixture.nodes.keys()]
      const styleIds = [...fixture.styles.keys()]
      fixture.commitUndo.mockClear()
      let properties: CanvasFigmaProperties
      if (reference === 'whole hyperlink') {
        properties = { text: { hyperlink: { type: 'NODE', value: 'missing:reference' } } }
      } else if (reference === 'range hyperlink') {
        properties = {
          text: {
            ranges: [{ start: 0, end: 5, hyperlink: { type: 'NODE', value: 'missing:reference' } }]
          }
        }
      } else if (reference === 'image hash') {
        properties = {
          fills: [{ type: 'IMAGE', imageHash: 'missing:reference', scaleMode: 'FILL' }]
        }
      } else {
        properties = {
          fills: [
            {
              type: 'PATTERN',
              sourceNodeId: 'missing:reference',
              tileType: 'RECTANGULAR',
              scalingFactor: 1,
              spacing: { x: 0, y: 0 },
              horizontalAlignment: 'START'
            }
          ]
        }
      }

      await expect(
        applyCanvasFromTool({
          ...(created
            ? { mode: 'update', targetNodeId: created.rootNodeId! }
            : { mode: 'create', markup }),
          styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } },
          native: { label: { figma: properties } }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
        message: expect.stringContaining('"missing:reference"')
      })
      expect(figma.createPaintStyle).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
      expect([...fixture.nodes.keys()]).toEqual(nodeIds)
      expect([...fixture.styles.keys()]).toEqual(styleIds)
      if (created) {
        const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
        expect(label.characters).toBe('Label')
        expect(label.hyperlink).toBeNull()
      }
    }
  )

  it.each([
    'missing property reference',
    'missing slot metadata',
    'variant property definition',
    'unknown instance property',
    'missing instance-swap default'
  ] as const)('rejects %s before creating unrelated declared resources', async (failure) => {
    const fixture = createFixture()
    let markup =
      '<div data-key="card" class="flex flex-col w-80 h-40"><span data-key="title" class="w-fit h-fit">Title</span></div>'
    let native: NonNullable<ApplyCanvasParametersInput['native']> = {
      card: { figma: { component: { type: 'COMPONENT' } } },
      title: { figma: { componentPropertyReferences: { characters: 'missing' } } }
    }
    let message = 'is missing, expected TEXT'
    if (failure === 'missing slot metadata') {
      markup =
        '<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" class="w-full h-20"></div></div>'
      native = {
        card: { figma: { component: { type: 'COMPONENT' } } },
        content: { figma: { slot: {} } }
      }
      message = 'requires property metadata'
    } else if (failure === 'variant property definition') {
      markup =
        '<div data-key="set" class="flex flex-row w-80 h-40"><div data-key="variant" class="w-20 h-10"></div></div>'
      native = {
        set: { figma: { component: { type: 'COMPONENT_SET' } } },
        variant: {
          figma: {
            name: 'State=Default',
            component: {
              type: 'COMPONENT',
              properties: { label: { type: 'TEXT', name: 'Label', defaultValue: 'Label' } }
            }
          }
        }
      }
      message = 'belong on its component set'
    } else if (failure === 'unknown instance property') {
      markup =
        '<div data-key="root" class="flex flex-row w-80 h-40"><div data-key="action" class="w-20 h-10"></div></div>'
      native = {
        action: { component: { id: 'component:1' }, componentProperties: { Missing: 'value' } }
      }
      message = 'has no property "Missing"'
    } else if (failure === 'missing instance-swap default') {
      native = {
        card: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: {
                icon: {
                  type: 'INSTANCE_SWAP',
                  name: 'Icon',
                  defaultValue: { id: 'missing:component' }
                }
              }
            }
          }
        }
      }
      message = 'The requested component could not be resolved.'
    }
    const nodeIds = [...fixture.nodes.keys()]
    const styleIds = [...fixture.styles.keys()]
    await expect(
      applyCanvasFromTool({
        mode: 'create',
        markup,
        native,
        styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining(message)
    })
    expect(figma.createPaintStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect([...fixture.nodes.keys()]).toEqual(nodeIds)
    expect([...fixture.styles.keys()]).toEqual(styleIds)
  })

  it('rejects retained slot bounds before a native update creates unrelated resources', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" class="w-full h-20"></div></div>',
      native: {
        card: { figma: { component: { type: 'COMPONENT' } } },
        content: {
          figma: { slot: { property: { name: 'Content', settings: { maxChildren: 4 } } } }
        }
      }
    })
    const card = fixture.getNode(created.rootNodeId!) as unknown as ComponentNode
    const definitions = structuredClone(card.componentPropertyDefinitions)
    fixture.commitUndo.mockClear()
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } },
        native: {
          content: {
            figma: { slot: { property: { name: 'Content', settings: { minChildren: 5 } } } }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('cannot exceed maxChildren')
    })
    expect(figma.createPaintStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(card.componentPropertyDefinitions).toEqual(definitions)
  })

  it('rejects exposing a page instance before a native update creates unrelated resources', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-80 h-40"><div data-key="action" class="w-20 h-10"></div></div>',
      native: { action: { component: { id: 'component:1' } } }
    })
    const action = fixture.getNode(created.nodeIdsByKey.action!) as unknown as InstanceNode
    fixture.commitUndo.mockClear()
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } },
        native: { action: { figma: { instance: { exposed: true } } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('requires an existing primary instance inside a component')
    })
    expect(figma.createPaintStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(action.isExposedInstance).toBe(false)
  })

  it.each(['component set', 'native update'] as const)(
    'preflights same-call property and variable declarations for a %s',
    async (mode) => {
      const fixture = createFixture()
      const created =
        mode === 'native update'
          ? await applyCanvasFromTool({
              mode: 'create',
              markup:
                '<div data-key="card" class="flex flex-col w-80 h-40"><span data-key="title" class="w-fit h-fit">Title</span></div>',
              native: { card: { figma: { component: { type: 'COMPONENT' } } } }
            })
          : undefined
      const result = await applyCanvasFromTool({
        ...(created
          ? { mode: 'update', targetNodeId: created.rootNodeId! }
          : {
              mode: 'create',
              markup:
                '<div data-key="card" class="flex flex-row w-80 h-40"><div data-key="variant" class="flex flex-col w-40 h-20"><span data-key="title" class="w-fit h-fit">Title</span></div></div>'
            }),
        variableCollections: {
          copy: {
            name: 'Copy',
            modes: { base: { name: 'Base' } },
            variables: { label: { type: 'STRING', name: 'Label', values: { base: 'Title' } } }
          }
        },
        native: {
          // Deliberately list the dependent sublayer before its owner in native-only input.
          title: { figma: { componentPropertyReferences: { characters: 'title' } } },
          card: {
            figma: {
              component: {
                type: created ? 'COMPONENT' : 'COMPONENT_SET',
                properties: {
                  title: {
                    type: 'TEXT',
                    name: 'Title',
                    defaultValue: { variable: { variableKey: 'label' } }
                  }
                }
              }
            }
          },
          ...(created
            ? {}
            : {
                variant: {
                  figma: { name: 'State=Default', component: { type: 'COMPONENT' } }
                }
              })
        }
      })
      const card = fixture.getNode(result.rootNodeId!) as unknown as
        | ComponentNode
        | ComponentSetNode
      const title = fixture.getNode(result.nodeIdsByKey.title!) as unknown as TextNode
      const property = Object.keys(card.componentPropertyDefinitions).find((name) =>
        name.startsWith('Title#')
      )!
      expect(title.componentPropertyReferences).toEqual({ characters: property })
      expect(card.componentPropertyDefinitions[property]).toMatchObject({
        type: 'TEXT',
        boundVariables: { defaultValue: { type: 'VARIABLE_ALIAS', id: expect.any(String) } }
      })
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['component', 'swap default', 'instance variable'] as const)(
    'prepares library %s without delaying component imports until resource writes',
    async (reference) => {
      const fixture = createFixture()
      const importComponent = vi.mocked(figma.importComponentByKeyAsync).getMockImplementation()!
      vi.mocked(figma.importComponentByKeyAsync).mockImplementation(async (key) => {
        expect(fixture.commitUndo).not.toHaveBeenCalled()
        expect(figma.createPaintStyle).not.toHaveBeenCalled()
        return importComponent(key)
      })
      const importVariable = vi
        .mocked(figma.variables.importVariableByKeyAsync)
        .getMockImplementation()!
      vi.mocked(figma.variables.importVariableByKeyAsync).mockImplementation(async (key) => {
        expect(fixture.commitUndo).toHaveBeenCalledOnce()
        return importVariable(key)
      })
      await applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="card" class="flex flex-row w-80 h-40"><div data-key="action" class="w-20 h-10"></div></div>',
        styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } },
        bindings: {
          action: {
            component: reference === 'component' ? { key: 'component-key' } : { id: 'component:1' },
            ...(reference === 'instance variable'
              ? { componentProperties: { Label: { variable: { key: 'component-label-key' } } } }
              : {})
          },
          ...(reference === 'swap default'
            ? {
                card: {
                  figma: {
                    component: {
                      type: 'COMPONENT',
                      properties: {
                        icon: {
                          type: 'INSTANCE_SWAP',
                          name: 'Icon',
                          defaultValue: { key: 'component-key' }
                        }
                      }
                    }
                  }
                }
              }
            : {})
        }
      })
      if (reference === 'instance variable') {
        expect(figma.variables.importVariableByKeyAsync).toHaveBeenCalledWith('component-label-key')
        expect(fixture.importComponentByKeyAsync).not.toHaveBeenCalled()
      } else expect(fixture.importComponentByKeyAsync).toHaveBeenCalledWith('component-key')
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it('rejects an unavailable library component before creating declared resources', async () => {
    const fixture = createFixture()
    fixture.importComponentByKeyAsync.mockRejectedValue(new Error('Library unavailable'))
    await expect(
      applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-row w-80 h-40"><div data-key="action" class="w-20 h-10"/></div>',
        styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } },
        bindings: { action: { component: { key: 'unavailable-component' } } }
      })
    ).rejects.toThrow('unavailable-component')
    expect(figma.createPaintStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('rejects known text range bounds before creating declared resources', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">Copy</span></div>'
    })
    fixture.commitUndo.mockClear()
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        styles: {
          body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
        },
        native: { copy: { figma: { text: { ranges: [{ start: 0, end: 8, fontSize: 24 }] } } } }
      })
    ).rejects.toThrow('exceeds 4 UTF-16 code units')
    expect(figma.createTextStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it.each(['range variable', 'declared range variable', 'existing style', 'range style'] as const)(
    'rejects an incompatible %s before creating unrelated declared resources',
    async (binding) => {
      const fixture = createFixture()
      const created = await applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">Copy</span></div>'
      })
      fixture.commitUndo.mockClear()
      await expect(
        applyCanvas({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          styles: {
            body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
          },
          ...(binding === 'declared range variable'
            ? {
                variableCollections: {
                  tokens: {
                    name: 'Tokens',
                    modes: { default: { name: 'Default' } },
                    variables: {
                      spacing: { name: 'Spacing', type: 'FLOAT' as const, values: { default: 8 } }
                    }
                  }
                }
              }
            : {}),
          bindings: {
            copy:
              binding === 'existing style'
                ? { styles: { fill: { id: 'style:text' } } }
                : {
                    figma: {
                      text: {
                        ranges: [
                          {
                            start: 0,
                            end: 4,
                            ...(binding === 'range style'
                              ? { fillStyle: { id: 'style:text' } }
                              : {
                                  variables: {
                                    fontFamily:
                                      binding === 'declared range variable'
                                        ? { variableKey: 'spacing' }
                                        : { id: 'variable:spacing' }
                                  }
                                })
                          }
                        ]
                      }
                    }
                  }
          }
        })
      ).rejects.toThrow(binding.includes('style') ? 'expected PAINT' : 'expected STRING')
      expect(figma.createTextStyle).not.toHaveBeenCalled()
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it('does not import library-only bindings before rejecting a locally invalid range', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">Copy</span></div>'
    })
    fixture.commitUndo.mockClear()
    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        styles: {
          body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
        },
        bindings: {
          copy: {
            styles: { fill: { key: 'library-fill' } },
            figma: {
              text: {
                ranges: [
                  { start: 0, end: 2, variables: { fontFamily: { key: 'library-family' } } },
                  { start: 2, end: 4, variables: { fontFamily: { id: 'variable:spacing' } } }
                ]
              }
            }
          }
        }
      })
    ).rejects.toThrow('expected STRING')
    expect(figma.importStyleByKeyAsync).not.toHaveBeenCalled()
    expect(figma.variables.importVariableByKeyAsync).not.toHaveBeenCalled()
    expect(figma.createTextStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it.each(
    (['solid', 'gradient', 'effect', 'paint resource', 'effect resource'] as const).flatMap(
      (usage) => (['create', 'update'] as const).map((mode) => ({ usage, mode }))
    )
  )(
    'rejects incompatible $usage variables in $mode before creating declared resources',
    async ({ usage, mode }) => {
      const fixture = createFixture()
      const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      const created = mode === 'update' ? await applyCanvas({ mode: 'create', markup }) : undefined
      fixture.commitUndo.mockClear()
      const paint: NonNullable<CanvasFigmaProperties['fills']>[number] =
        usage === 'gradient'
          ? {
              type: 'GRADIENT_LINEAR',
              gradientTransform: [
                [1, 0, 0],
                [0, 1, 0]
              ],
              gradientStops: [
                {
                  position: 0,
                  color: { r: 0, g: 0, b: 0, a: 1 },
                  variables: { color: { variableKey: 'wrong' } }
                },
                { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
              ]
            }
          : {
              type: 'SOLID',
              color: { r: 0, g: 0, b: 0 },
              variables: { color: { variableKey: 'wrong' } }
            }
      const effect: NonNullable<CanvasFigmaProperties['effects']>[number] = {
        type: 'LAYER_BLUR',
        blurType: 'NORMAL',
        radius: 8,
        variables: { radius: { variableKey: 'wrong-color' } }
      }
      const paints: CanvasFigmaProperties['fills'] = [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, variables: { color: { key: 'color-key' } } },
        paint
      ]
      const effects: CanvasFigmaProperties['effects'] = [
        {
          type: 'LAYER_BLUR',
          blurType: 'NORMAL',
          radius: 8,
          variables: { radius: { key: 'remote-radius' } }
        },
        effect
      ]
      let styles: CanvasResolvedApplyParameters['styles']
      if (usage === 'paint resource')
        styles = { resource: { type: 'PAINT', name: 'Paint', paints } }
      if (usage === 'effect resource')
        styles = { resource: { type: 'EFFECT', name: 'Effect', effects } }
      let properties: CanvasFigmaProperties = {}
      if (usage === 'effect') properties = { effects }
      else if (!usage.includes('resource')) properties = { fills: paints }
      await expect(
        applyCanvas({
          mode,
          ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
          variableCollections: {
            tokens: {
              name: 'Tokens',
              modes: { base: { name: 'Base' } },
              variables: {
                wrong: { name: 'Wrong', type: 'FLOAT', values: { base: 8 } },
                'wrong-color': {
                  name: 'Wrong color',
                  type: 'COLOR',
                  values: { base: { r: 0, g: 0, b: 0 } }
                }
              }
            }
          },
          styles,
          bindings: { root: { figma: properties } }
        })
      ).rejects.toThrow(usage.includes('effect') ? 'expected FLOAT' : 'expected COLOR')
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(figma.createPaintStyle).not.toHaveBeenCalled()
      expect(figma.createEffectStyle).not.toHaveBeenCalled()
      expect(figma.variables.importVariableByKeyAsync).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(
    (['text resource', 'grid resource', 'layout grid'] as const).flatMap((usage) =>
      (['create', 'update'] as const).map((mode) => ({ usage, mode }))
    )
  )(
    'rejects incompatible $usage variables in $mode before preparing resources',
    async ({ usage, mode }) => {
      const fixture = createFixture()
      const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      const created = mode === 'update' ? await applyCanvas({ mode: 'create', markup }) : undefined
      fixture.commitUndo.mockClear()
      const layoutGrids: CanvasFigmaProperties['layoutGrids'] = [
        { pattern: 'GRID', sectionSize: 8, variables: { sectionSize: { key: 'spacing-key' } } },
        { pattern: 'GRID', sectionSize: 8, variables: { sectionSize: { variableKey: 'wrong' } } }
      ]
      let styles: CanvasResolvedApplyParameters['styles']
      if (usage === 'text resource') {
        styles = {
          body: {
            type: 'TEXT',
            name: 'Body',
            variables: {
              fontSize: { key: 'spacing-key' },
              fontFamily: { variableKey: 'wrong' }
            }
          }
        }
      } else if (usage === 'grid resource') {
        styles = { grid: { type: 'GRID', name: 'Grid', layoutGrids } }
      }
      await expect(
        applyCanvas({
          mode,
          ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
          variableCollections: {
            tokens: {
              name: 'Tokens',
              modes: { base: { name: 'Base' } },
              variables: { wrong: { name: 'Wrong', type: 'BOOLEAN', values: { base: true } } }
            }
          },
          styles,
          bindings: { root: { figma: usage === 'layout grid' ? { layoutGrids } : {} } }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
        message: expect.stringContaining(
          usage === 'text resource' ? 'expected STRING' : 'expected FLOAT'
        )
      })
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(figma.createTextStyle).not.toHaveBeenCalled()
      expect(figma.createGridStyle).not.toHaveBeenCalled()
      expect(figma.variables.importVariableByKeyAsync).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(
    (['TEXT', 'BOOLEAN'] as const).flatMap((type) =>
      (['create', 'update'] as const).map((mode) => ({ type, mode }))
    )
  )(
    'rejects incompatible $type component defaults in $mode before preparing resources',
    async ({ type, mode }) => {
      const fixture = createFixture()
      const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      const created =
        mode === 'update'
          ? await applyCanvas({
              mode: 'create',
              markup,
              bindings: { root: { figma: { component: { type: 'COMPONENT' } } } }
            })
          : undefined
      fixture.commitUndo.mockClear()
      await expect(
        applyCanvas({
          mode,
          ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
          variableCollections: {
            tokens: {
              name: 'Tokens',
              modes: { base: { name: 'Base' } },
              variables: { wrong: { name: 'Wrong', type: 'FLOAT', values: { base: 8 } } }
            }
          },
          bindings: {
            root: {
              figma: {
                component: {
                  type: 'COMPONENT',
                  properties: {
                    remote: {
                      type: 'TEXT',
                      name: 'Remote',
                      defaultValue: { variable: { key: 'font-key' } }
                    },
                    invalid: {
                      type,
                      name: 'Invalid',
                      defaultValue: { variable: { variableKey: 'wrong' } }
                    }
                  }
                }
              }
            }
          }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
        message: expect.stringContaining(
          `component property "invalid" is FLOAT, expected ${type === 'TEXT' ? 'STRING' : 'BOOLEAN'}`
        )
      })
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(figma.variables.importVariableByKeyAsync).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(
    (['missing id', 'wrong type', 'owned', 'duplicate adoption'] as const).flatMap((failure) =>
      (['create', 'update'] as const).map((mode) => ({ failure, mode }))
    )
  )(
    'rejects a later style declaration with $failure in $mode before creating or claiming resources',
    async ({ failure, mode }) => {
      const fixture = createFixture()
      const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      const created = mode === 'update' ? await applyCanvas({ mode: 'create', markup }) : undefined
      fixture.commitUndo.mockClear()
      const adopted = figma.createPaintStyle()
      const rejected = figma.createPaintStyle()
      if (failure === 'owned') rejected.setSharedPluginData('tempad_dev', 'style-key', 'existing')
      vi.mocked(figma.createPaintStyle).mockClear()
      const adoptionWrite = vi.spyOn(adopted, 'setSharedPluginData')
      let invalid: NonNullable<CanvasResolvedApplyParameters['styles']>[string] = {
        type: 'PAINT',
        id: 'missing-style'
      }
      if (failure === 'wrong type') invalid = { type: 'TEXT', id: rejected.id }
      if (failure === 'owned') invalid = { type: 'PAINT', id: rejected.id }
      if (failure === 'duplicate adoption') invalid = { type: 'PAINT', id: adopted.id }
      await expect(
        applyCanvas({
          mode,
          ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
          styles: {
            first: { type: 'PAINT', name: 'First' },
            adoption: { type: 'PAINT', id: adopted.id },
            invalid
          },
          bindings: { root: {} }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
      })
      expect(figma.createPaintStyle).not.toHaveBeenCalled()
      expect(adoptionWrite).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(
    (
      [
        'missing collection',
        'owned collection',
        'duplicate collection',
        'owned variable',
        'wrong collection',
        'duplicate variable',
        'collection key mismatch',
        'variable key mismatch',
        'remote collection',
        'remote variable'
      ] as const
    ).flatMap((failure) => (['create', 'update'] as const).map((mode) => ({ failure, mode })))
  )(
    'rejects $failure in $mode before creating or claiming any declared resource',
    async ({ failure, mode }) => {
      const fixture = createFixture()
      const markup = '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      const created = mode === 'update' ? await applyCanvas({ mode: 'create', markup }) : undefined
      fixture.commitUndo.mockClear()
      const collection = figma.variables.createVariableCollection('Existing')
      const other = figma.variables.createVariableCollection('Other')
      const variable = figma.variables.createVariable('Existing', collection, 'FLOAT')
      const adopted = figma.variables.createVariableCollection('Adopted')
      if (failure === 'owned collection')
        collection.setSharedPluginData('tempad_dev', 'variable-collection-key', 'old')
      if (failure === 'owned variable')
        variable.setSharedPluginData('tempad_dev', 'variable-key', 'old-variable')
      if (failure === 'collection key mismatch')
        other.setSharedPluginData('tempad_dev', 'variable-collection-key', 'invalid')
      if (failure === 'variable key mismatch') {
        const keyed = figma.variables.createVariable('Keyed', collection, 'FLOAT')
        keyed.setSharedPluginData('tempad_dev', 'variable-key', 'value')
      }
      if (failure === 'remote collection')
        Object.defineProperty(collection, 'remote', { value: true })
      if (failure === 'remote variable') Object.defineProperty(variable, 'remote', { value: true })
      vi.mocked(figma.variables.createVariableCollection).mockClear()
      vi.mocked(figma.variables.createVariable).mockClear()
      const adoptionWrite = vi.spyOn(adopted, 'setSharedPluginData')
      const invalid: NonNullable<CanvasResolvedApplyParameters['variableCollections']>[string] = {
        id: collection.id
      }
      if (failure === 'missing collection') invalid.id = 'missing-collection'
      if (failure === 'duplicate collection') invalid.id = adopted.id
      if (failure.includes('variable') || failure === 'wrong collection') {
        invalid.id = failure === 'wrong collection' ? other.id : collection.id
        invalid.variables = { value: { id: variable.id } }
        if (failure === 'duplicate variable') invalid.variables.again = { id: variable.id }
      }
      await expect(
        applyCanvas({
          mode,
          ...(created ? { targetNodeId: created.rootNodeId! } : { markup }),
          variableCollections: {
            first: { name: 'First', modes: { base: { name: 'Base' } } },
            adoption: { id: adopted.id },
            invalid
          },
          bindings: { root: {} }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
      })
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(figma.variables.createVariable).not.toHaveBeenCalled()
      expect(adoptionWrite).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it('reuses preflight identities when adopting an existing collection and variable', async () => {
    const fixture = createFixture()
    const collection = figma.variables.createVariableCollection('Existing')
    const variable = figma.variables.createVariable('Existing', collection, 'FLOAT')
    variable.setValueForMode(collection.defaultModeId, 8)
    vi.mocked(figma.variables.createVariableCollection).mockClear()
    vi.mocked(figma.variables.createVariable).mockClear()
    vi.mocked(figma.variables.getVariableCollectionByIdAsync).mockImplementationOnce(async (id) => {
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(id).toBe(collection.id)
      return collection
    })
    vi.mocked(figma.variables.getVariableByIdAsync).mockImplementationOnce(async (id) => {
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(id).toBe(variable.id)
      return variable
    })
    await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      variableCollections: {
        tokens: { id: collection.id, variables: { spacing: { id: variable.id } } }
      }
    })
    expect(collection.getSharedPluginData('tempad_dev', 'variable-collection-key')).toBe('tokens')
    expect(variable.getSharedPluginData('tempad_dev', 'variable-key')).toBe('spacing')
    expect(figma.variables.getVariableCollectionByIdAsync).toHaveBeenCalledOnce()
    expect(figma.variables.getVariableByIdAsync).toHaveBeenCalledOnce()
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(figma.variables.createVariable).not.toHaveBeenCalled()
  })

  it.each([
    'extension modes',
    'base overrides',
    'missing mode',
    'mode key mismatch',
    'mode ownership',
    'duplicate mode adoption',
    'wrong deletion collection'
  ] as const)(
    'rejects %s before opening the undo boundary or preparing other resources',
    async (failure) => {
      const fixture = createFixture()
      const collection = figma.variables.createVariableCollection('Existing')
      const other = figma.variables.createVariableCollection('Other')
      const variable = figma.variables.createVariable('Delete', other, 'FLOAT')
      variable.setSharedPluginData('tempad_dev', 'variable-key', 'delete')
      collection.setSharedPluginData(
        'tempad_dev',
        'variable-mode-keys',
        JSON.stringify({ base: collection.defaultModeId })
      )
      const invalid: NonNullable<CanvasResolvedApplyParameters['variableCollections']>[string] = {
        id: collection.id
      }
      if (failure === 'extension modes') {
        invalid.id = collection.extend('Extended').id
        invalid.modes = { bad: { name: 'Bad' } }
      }
      if (failure === 'base overrides') invalid.overrides = []
      if (failure === 'missing mode') invalid.modes = { bad: { id: 'missing-mode' } }
      if (failure === 'mode key mismatch') invalid.modes = { base: { id: 'other-mode' } }
      if (failure === 'mode ownership') invalid.modes = { bad: { id: collection.defaultModeId } }
      if (failure === 'duplicate mode adoption') {
        collection.setSharedPluginData('tempad_dev', 'variable-mode-keys', '')
        invalid.modes = {
          first: { id: collection.defaultModeId, name: 'Renamed' },
          second: { id: collection.defaultModeId }
        }
      }
      if (failure === 'wrong deletion collection') invalid.variables = { delete: null }
      vi.mocked(figma.variables.createVariableCollection).mockClear()
      await expect(
        applyCanvas({
          mode: 'create',
          markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
          variableCollections: {
            first: { name: 'First', modes: { base: { name: 'Base' } } },
            invalid
          }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
      })
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['pattern scope', 'retained font'] as const)(
    'rejects a style with invalid %s before preparing resources',
    async (failure) => {
      const fixture = createFixture()
      const styles: NonNullable<CanvasResolvedApplyParameters['styles']> = {
        first: { type: 'PAINT', name: 'First' }
      }
      if (failure === 'pattern scope') {
        styles.invalid = {
          type: 'PAINT',
          name: 'Pattern',
          paints: [
            {
              type: 'PATTERN',
              sourceCanvasKey: 'root',
              tileType: 'RECTANGULAR',
              scalingFactor: 1,
              spacing: { x: 0, y: 0 },
              horizontalAlignment: 'START'
            }
          ]
        }
      } else {
        styles.invalid = { type: 'TEXT', id: 'style:text', fontSize: 30 }
        fixture.loadFontAsync.mockRejectedValueOnce(new Error('font unavailable'))
      }
      await expect(
        applyCanvas({
          mode: 'create',
          markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
          styles
        })
      ).rejects.toThrow(failure === 'pattern scope' ? 'must already exist' : 'is unavailable')
      expect(figma.createPaintStyle).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['matching', 'mismatch'] as const)(
    'imports a library-key variable alias inside Undo and handles a type %s',
    async (result) => {
      const fixture = createFixture()
      const importVariable = vi
        .mocked(figma.variables.importVariableByKeyAsync)
        .getMockImplementation()!
      const undoCounts: number[] = []
      vi.mocked(figma.variables.importVariableByKeyAsync).mockImplementation(async (key) => {
        undoCounts.push(fixture.commitUndo.mock.calls.length)
        return importVariable(key)
      })
      const apply = applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { base: { name: 'Base' } },
            variables: {
              alias: {
                name: 'Alias',
                type: 'FLOAT',
                values: {
                  base: { variable: { key: result === 'matching' ? 'spacing-key' : 'font-key' } }
                }
              }
            }
          }
        }
      })
      if (result === 'mismatch') {
        await expect(apply).rejects.toMatchObject({
          code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
          message: expect.stringMatching(
            /is STRING, expected FLOAT.*Rollback did not remove created resource/
          )
        })
      } else {
        await expect(apply).resolves.toMatchObject({ rootNodeId: expect.any(String) })
        const alias = [...fixture.variables.values()].find((variable) => variable.name === 'Alias')
        expect(Object.values(alias?.valuesByMode ?? {})).toEqual([
          { type: 'VARIABLE_ALIAS', id: 'variable:spacing' }
        ])
      }
      expect(undoCounts).toEqual([1])
      // Retained declared resources establish this attempt's own Undo entry.
      expect(fixture.triggerUndo).toHaveBeenCalledTimes(result === 'mismatch' ? 1 : 0)
    }
  )

  it.each([
    'wrong parent id',
    'wrong parent key',
    'unknown value mode',
    'duplicate value mode',
    'foreign override',
    'duplicate override',
    'override literal type',
    'override alias type'
  ] as const)(
    'rejects %s in existing variable resources before any declaration is written',
    async (failure) => {
      const fixture = createFixture()
      const parent = figma.variables.createVariableCollection('Parent')
      const other = figma.variables.createVariableCollection('Other')
      const variable = figma.variables.createVariable('Value', parent, 'FLOAT')
      const foreign = figma.variables.createVariable('Foreign', other, 'FLOAT')
      variable.setValueForMode(parent.defaultModeId, 8)
      parent.setSharedPluginData(
        'tempad_dev',
        'variable-mode-keys',
        JSON.stringify({ base: parent.defaultModeId })
      )
      const extended = parent.extend('Extended')
      const invalid: NonNullable<CanvasResolvedApplyParameters['variableCollections']>[string] = {
        id: extended.id
      }
      if (failure === 'wrong parent id') invalid.extends = { id: other.id }
      if (failure === 'wrong parent key') invalid.extends = { key: 'wrong-parent-key' }
      if (failure.includes('value mode')) {
        invalid.id = parent.id
        invalid.variables = {
          value: {
            id: variable.id,
            values:
              failure === 'unknown value mode'
                ? { missing: 12 }
                : { base: 12, [parent.defaultModeId]: 16 }
          }
        }
      }
      if (failure.includes('override')) {
        invalid.overrides = [
          {
            variable: { id: failure === 'foreign override' ? foreign.id : variable.id },
            values: { [parent.defaultModeId]: 12 }
          }
        ]
        if (failure === 'duplicate override') invalid.overrides.push({ ...invalid.overrides[0]! })
        if (failure === 'override literal type')
          invalid.overrides[0]!.values = { [parent.defaultModeId]: true }
        if (failure === 'override alias type')
          invalid.overrides[0]!.values = {
            [parent.defaultModeId]: { variable: { id: 'variable:font' } }
          }
      }
      vi.mocked(figma.variables.createVariableCollection).mockClear()
      const rename = vi.spyOn(parent, 'setSharedPluginData')
      await expect(
        applyCanvas({
          mode: 'create',
          markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
          variableCollections: {
            first: { name: 'First', modes: { base: { name: 'Base' } } },
            invalid
          }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
      })
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(rename).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['adoption', 'library target', 'library alias'] as const)(
    'preserves existing extension overrides using %s with same-call parent adoption',
    async (reference) => {
      const fixture = createFixture()
      const parent = figma.variables.createVariableCollection('Parent')
      const variable = figma.variables.createVariable('Value', parent, 'FLOAT')
      variable.setValueForMode(parent.defaultModeId, 8)
      const extended = parent.extend('Extended')
      vi.mocked(figma.variables.createVariableCollection).mockClear()
      vi.mocked(figma.variables.createVariable).mockClear()
      const importVariable = vi
        .mocked(figma.variables.importVariableByKeyAsync)
        .getMockImplementation()!
      const undoCounts: number[] = []
      vi.mocked(figma.variables.importVariableByKeyAsync).mockImplementation(async (key) => {
        undoCounts.push(fixture.commitUndo.mock.calls.length)
        return importVariable(key)
      })
      await applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          extended: {
            id: extended.id,
            extends: { collectionKey: 'adopted' },
            overrides: [
              {
                variable:
                  reference === 'library target' ? { key: variable.key } : { variableKey: 'value' },
                values: {
                  [parent.defaultModeId]:
                    reference === 'library alias' ? { variable: { key: 'spacing-key' } } : 12
                }
              }
            ]
          },
          adopted: { id: parent.id, variables: { value: { id: variable.id } } }
        }
      })
      expect(parent.getSharedPluginData('tempad_dev', 'variable-collection-key')).toBe('adopted')
      expect(variable.getSharedPluginData('tempad_dev', 'variable-key')).toBe('value')
      expect(Object.values(extended.variableOverrides[variable.id] ?? {})).toEqual([
        reference === 'library alias' ? { type: 'VARIABLE_ALIAS', id: 'variable:spacing' } : 12
      ])
      expect(undoCounts).toEqual(reference === 'adoption' ? [] : [1])
      expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
      expect(figma.variables.createVariable).not.toHaveBeenCalled()
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['missing', 'complete'] as const)(
    'requires every unchanged existing mode for a new variable with %s values',
    async (coverage) => {
      const fixture = createFixture()
      const collection = figma.variables.createVariableCollection('Existing')
      const alternate = collection.addMode('Alternate')
      vi.mocked(figma.variables.createVariableCollection).mockClear()
      const apply = applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          first: { name: 'First', modes: { base: { name: 'Base' } } },
          existing: {
            id: collection.id,
            variables: {
              fresh: {
                name: 'Fresh',
                type: 'FLOAT',
                values: {
                  [collection.defaultModeId]: 8,
                  ...(coverage === 'complete' ? { [alternate]: 12 } : {})
                }
              }
            }
          }
        }
      })
      if (coverage === 'missing') {
        await expect(apply).rejects.toMatchObject({
          code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
          message:
            'New variable "fresh" requires a value for mode "Alternate". [INVALID_CANVAS_SPEC]'
        })
        expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
        expect(figma.variables.createVariable).not.toHaveBeenCalled()
        expect(fixture.commitUndo).not.toHaveBeenCalled()
      } else {
        await expect(apply).resolves.toMatchObject({ rootNodeId: expect.any(String) })
        const fresh = [...fixture.variables.values()].find((variable) => variable.name === 'Fresh')
        expect(fresh?.valuesByMode).toEqual({ [collection.defaultModeId]: 8, [alternate]: 12 })
      }
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each([
    'unnamed base',
    'unnamed extension',
    'unknown override mode',
    'duplicate override mode'
  ] as const)('rejects %s before writing earlier declared resources', async (failure) => {
    const fixture = createFixture()
    const parent = figma.variables.createVariableCollection('Parent')
    const variable = figma.variables.createVariable('Value', parent, 'FLOAT')
    variable.setValueForMode(parent.defaultModeId, 8)
    const extended = parent.extend('Extended')
    let invalid: NonNullable<CanvasResolvedApplyParameters['variableCollections']>[string]
    if (failure === 'unnamed base') invalid = { modes: { base: { name: 'Base' } } }
    else if (failure === 'unnamed extension') invalid = { extends: { id: parent.id } }
    else {
      invalid = {
        id: extended.id,
        overrides: [
          {
            variable: { id: variable.id },
            values:
              failure === 'unknown override mode'
                ? { missing: 12 }
                : { [parent.defaultModeId]: 12, [extended.defaultModeId]: 16 }
          }
        ]
      }
    }
    vi.mocked(figma.variables.createVariableCollection).mockClear()
    await expect(
      applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          first: { name: 'First', modes: { base: { name: 'Base' } } },
          invalid
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
    expect(figma.variables.createVariableCollection).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'preserves nested extension override mode aliases with ancestor mode adoption=%s',
    async (adoptMode) => {
      const fixture = createFixture()
      const parent = figma.variables.createVariableCollection('Parent')
      const variable = figma.variables.createVariable('Value', parent, 'FLOAT')
      variable.setValueForMode(parent.defaultModeId, 8)
      const extended = parent.extend('Extended').extend('Nested')
      if (!adoptMode) {
        parent.setSharedPluginData(
          'tempad_dev',
          'variable-mode-keys',
          JSON.stringify({ base: parent.defaultModeId })
        )
      }
      await applyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
        variableCollections: {
          parent: {
            id: parent.id,
            ...(adoptMode ? { modes: { base: { id: parent.defaultModeId } } } : {})
          },
          nested: {
            id: extended.id,
            overrides: [{ variable: { id: variable.id }, values: { base: 12 } }]
          }
        }
      })
      expect(extended.variableOverrides[variable.id]).toEqual({ [extended.defaultModeId]: 12 })
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it('loads an existing result page before opening the undo boundary', async () => {
    const fixture = createFixture()
    const page = figma.createPage()
    vi.mocked(page.loadAsync).mockImplementationOnce(async () => {
      expect(fixture.commitUndo).not.toHaveBeenCalled()
    })
    await expect(
      applyCanvas({
        mode: 'create',
        page: { id: page.id },
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      })
    ).resolves.toMatchObject({ page: expect.objectContaining({ id: page.id }) })
    expect(page.loadAsync).toHaveBeenCalledOnce()
  })

  it('rejects a referenced root removal before opening the undo boundary', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>'
    })
    const consumer = fixture.createNode('TEXT') as TextNode
    consumer.hyperlink = { type: 'NODE', value: created.rootNodeId! }
    fixture.commitUndo.mockClear()
    await expect(
      applyCanvas({ mode: 'remove', targetNodeId: created.rootNodeId! })
    ).rejects.toThrow('still referenced outside')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.getNode(created.rootNodeId!).removed).toBe(false)
  })

  it('reports when rollback changes an unrelated existing top-level root', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    const unrelated = fixture.createNode('COMPONENT') as unknown as ComponentNode
    unrelated.resize(342, 68)
    const propertyName = unrelated.addComponentProperty('Artist', 'TEXT', 'Mara Vale')
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    fixture.triggerUndo.mockImplementationOnce(() => {
      delete unrelated.componentPropertyDefinitions[propertyName]
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup:
          '<div data-key="card" class="flex flex-col w-[321px] h-[200px]"><div data-key="card/new" class="w-[12px] h-[12px] bg-[#112233]"></div></div>'
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringMatching(
        new RegExp(`Rollback changed pre-existing nodes? .*${unrelated.id}`)
      )
    })
  })

  it('reports when rollback removes the pre-existing update root', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(createSpec())
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    fixture.triggerUndo.mockImplementationOnce(() => {
      fixture.getNode(created.rootNodeId!).remove()
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup:
          '<div data-key="card" class="flex flex-col w-[321px] h-[200px]"><div data-key="card/new" class="w-[12px] h-[12px] bg-[#112233]"></div></div>'
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
    const nodeIdsBefore = new Set(fixture.nodes.keys())

    await expect(applyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('is unavailable in the current Figma context')
    })
    expect(new Set(fixture.nodes.keys())).toEqual(nodeIdsBefore)
    expect(fixture.triggerUndo).not.toHaveBeenCalled()

    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    const nodeIdsBeforePaintFailure = new Set(fixture.nodes.keys())
    await expect(applyCanvas(createSpec())).rejects.toThrow('paint unavailable')
    expect(new Set(fixture.nodes.keys())).toEqual(nodeIdsBeforePaintFailure)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()

    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })
    fixture.triggerUndo.mockImplementationOnce(() => {
      throw new Error('undo unavailable')
    })
    await expect(applyCanvas(createSpec())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringMatching(
        /paint unavailable.*automatic rollback was not available.*undo unavailable/
      ),
      cause: expect.objectContaining({ message: expect.stringContaining('paint unavailable') })
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
    expect(fixture.page.loadAsync).toHaveBeenCalledOnce()
    expect(fixture.loadFontAsync).toHaveBeenCalledTimes(3)
  })

  it('rejects concurrent apply requests within one Figma session', async () => {
    const fixture = createFixture()
    const loading = Promise.withResolvers<void>()
    fixture.loadFontAsync.mockReturnValueOnce(loading.promise)
    const input = {
      mode: 'create' as const,
      markup:
        '<div data-key="root" class="flex flex-col w-[120px] h-[80px]"><span data-key="label" class="w-fit h-fit">Hello</span></div>'
    }

    const first = applyCanvasFromTool(input)
    void first.catch(() => undefined)
    try {
      await vi.waitFor(() => expect(fixture.loadFontAsync).toHaveBeenCalled())
      await expect(applyCanvasFromTool(input)).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
        message: expect.stringContaining('CANVAS_BUSY')
      })
    } finally {
      loading.resolve()
      await first.catch(() => undefined)
    }
    await expect(first).resolves.toMatchObject({ rootNodeId: expect.any(String) })
  })
})
