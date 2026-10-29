import type { CanvasFigmaProperties } from '@tempad-dev/shared'

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

import { createFixture } from '../../fakes/figma'

afterEach(() => {
  resetAssetCache()
  setAssetDownloader(null)
  setAssetServerUrl(null)
  setAssetUploader(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/canvas native updates', () => {
  it('preserves the size produced by a native-only variant change', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><div data-key="button" class="w-16 h-8"/></div>',
      bindings: { button: { component: { id: 'component:1' } } }
    })
    const button = fixture.getNode(created.nodeIdsByKey.button!) as unknown as InstanceNode
    const setProperties = vi.mocked(button.setProperties).getMockImplementation()
    if (!setProperties) throw new Error('Expected the fixture instance setter.')
    vi.spyOn(button, 'setProperties').mockImplementation((properties) => {
      setProperties(properties)
      button.resize(160, 64)
    })
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { button: { componentProperties: { State: 'Hover' } } }
    })
    expect(button).toMatchObject({ width: 160, height: 64 })
    expect(updated.verification.status).toBe('passed')
  })

  it('validates native-only assets before downloading or mutating', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-20 h-20"/>'
    })
    const before = fixture.getNode(created.rootNodeId!).name
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: {
          root: {
            figma: {
              name: 'Changed',
              fills: [{ type: 'IMAGE', assetKey: 'missing', scaleMode: 'FILL' }]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining('not declared')
    })
    expect(fixture.getNode(created.rootNodeId!).name).toBe(before)
  })

  it('updates native state by stable key without moving nested nodes', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[240px]"><div data-key="media" class="flex flex-col w-full h-[180px]"><div data-key="photo" class="w-full h-[150px]"></div><span data-key="caption" class="w-fit h-fit">Pool</span></div><span data-key="footer" class="w-fit h-fit">Book</span></div>'
    })
    const root = fixture.getNode(created.rootNodeId!)
    const media = fixture.getNode(created.nodeIdsByKey.media!)
    const photo = fixture.getNode(created.nodeIdsByKey.photo!)
    const rootChildren = root.children.map((node) => node.id)
    const mediaChildren = media.children.map((node) => node.id)
    const imageUrl = 'https://images.example.com/pool.png'
    const update = {
      mode: 'update' as const,
      targetNodeId: root.id,
      native: {
        photo: {
          figma: { fills: [{ type: 'IMAGE' as const, imageUrl, scaleMode: 'FILL' as const }] }
        }
      }
    }

    const updated = await applyCanvasFromTool(update)

    expect(root.children.map((node) => node.id)).toEqual(rootChildren)
    expect(media.children.map((node) => node.id)).toEqual(mediaChildren)
    expect(photo.parent).toBe(media)
    expect(photo.fills).toEqual([
      expect.objectContaining({ type: 'IMAGE', imageHash: `image:${imageUrl}`, scaleMode: 'FILL' })
    ])
    expect(updated).toMatchObject({
      rootNodeId: root.id,
      nodeIdsByKey: { photo: photo.id },
      createdNodeIds: [],
      updatedNodeIds: [photo.id],
      removedNodeIds: [],
      verification: {
        status: 'passed',
        nodesChecked: 1,
        referencesChecked: 0,
        nativeFieldsChecked: 1,
        warnings: []
      }
    })
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each(['include the bound node', 'separate native-only update'] as const)(
    'repairs a mixed update by choosing to %s without replacing existing nodes',
    async (repair) => {
      const fixture = createFixture()
      const content =
        '<div data-key="content" class="flex flex-col w-full h-fit"><div data-key="panel" class="w-full h-[32px] bg-black"></div></div>'
      const markup = (children: string) =>
        `<div data-key="root" class="flex flex-col w-[320px] h-[200px]">${children}</div>`
      const created = await applyCanvasFromTool({ mode: 'create', markup: markup(content) })
      const root = fixture.getNode(created.rootNodeId!)
      const parent = fixture.getNode(created.nodeIdsByKey.content!)
      const panel = fixture.getNode(created.nodeIdsByKey.panel!)
      const update = {
        mode: 'update' as const,
        targetNodeId: root.id,
        native: { panel: { figma: { name: 'Updated panel' } } }
      }
      const banner = '<div data-key="banner" class="w-full h-[24px]"></div>'
      vi.mocked(figma.createFrame).mockClear()
      fixture.commitUndo.mockClear()

      await expect(applyCanvasFromTool({ ...update, markup: markup(banner) })).rejects.toThrow(
        'Binding "panel" has no matching data-key in the supplied markup.'
      )
      expect(figma.createFrame).not.toHaveBeenCalled()
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(root.children.map((node) => node.id)).toEqual([parent.id])
      expect(panel.name).toBe('panel')

      if (repair === 'include the bound node') {
        await applyCanvasFromTool({ ...update, markup: markup(banner + content) })
      } else {
        await applyCanvasFromTool({
          mode: 'update',
          targetNodeId: root.id,
          markup: markup(banner)
        })
        await applyCanvasFromTool(update)
      }

      expect(panel.name).toBe('Updated panel')
      expect(panel.parent).toBe(parent)
      expect(parent.parent).toBe(root)
      expect(parent.children.map((node) => node.id)).toEqual([panel.id])
      expect(root.children).toHaveLength(2)
      expect(root.children.map((node) => node.name)).toEqual(
        expect.arrayContaining(['banner', 'content'])
      )
      expect(figma.createFrame).toHaveBeenCalledOnce()
    }
  )

  it('updates native display names without changing stable identity or omitted state', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-fit h-fit">Guest</span></div>'
    })
    const root = fixture.getNode(created.rootNodeId!)
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
    const update = {
      mode: 'update' as const,
      targetNodeId: root.id,
      native: {
        root: { figma: { name: 'Seating plan' } },
        copy: { figma: { name: 'Guest name' } }
      }
    }

    const updated = await applyCanvasFromTool(update)

    expect(root.name).toBe('Seating plan')
    expect(copy).toMatchObject({ name: 'Guest name', characters: 'Guest' })
    expect(root.children.map((node) => node.id)).toEqual([copy.id])
    expect(updated).toMatchObject({
      nodeIdsByKey: created.nodeIdsByKey,
      createdNodeIds: [],
      updatedNodeIds: [root.id, copy.id],
      removedNodeIds: []
    })
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })

    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: root.id,
      native: {
        root: { figma: { locked: true } },
        copy: { figma: { locked: true } }
      }
    })
    expect(root.name).toBe('Seating plan')
    expect(copy.name).toBe('Guest name')

    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: root.id,
      native: { root: { figma: { name: '' } } }
    })
    expect(root.name).toBe('')
  })

  it('updates native text properties without markup and preserves omitted typography', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-[240px] h-[80px] text-[20px] leading-[28px]">Guest</span></div>'
    })
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
    const update = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      native: {
        copy: {
          figma: {
            text: {
              fontName: { family: 'IBM Plex Sans', style: 'Medium' },
              verticalAlign: 'CENTER' as const,
              paragraphSpacing: 8
            }
          }
        }
      }
    }

    await applyCanvasFromTool(update)
    expect(copy).toMatchObject({
      characters: 'Guest',
      textAutoResize: 'NONE',
      fontName: { family: 'IBM Plex Sans', style: 'Medium' },
      textAlignVertical: 'CENTER',
      fontSize: 20,
      lineHeight: { unit: 'PIXELS', value: 28 },
      width: 240,
      height: 80
    })
    expect(copy.getRangeParagraphSpacing(0, copy.characters.length)).toBe(8)
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })

    copy.setRangeFontName(0, 2, { family: 'IBM Plex Sans', style: 'Medium' })
    copy.setRangeFontName(2, copy.characters.length, { family: 'IBM Plex Sans', style: 'Regular' })
    copy.fontName = figma.mixed
    copy.textAutoResize = 'TRUNCATE'
    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { copy: { figma: { name: 'Guest name' } } }
    })
    expect(copy.fontName).toBe(figma.mixed)
    expect(copy.getRangeAllFontNames(0, copy.characters.length)).toEqual([
      { family: 'IBM Plex Sans', style: 'Medium' },
      { family: 'IBM Plex Sans', style: 'Regular' }
    ])
    expect(copy.textAutoResize).toBe('TRUNCATE')
    expect(copy.characters).toBe('Guest')
    expect(copy.textAlignVertical).toBe('CENTER')
  })

  it('updates native-only Auto Layout spacing and stacking while preserving the live layout', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px] gap-[8px] p-[16px] items-center"><div data-key="child" class="w-[40px] h-[20px]"></div></div>'
    })
    const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
    const update = {
      mode: 'update' as const,
      targetNodeId: root.id,
      native: {
        root: {
          figma: {
            autoLayout: { itemSpacing: -12, counterAxisSpacing: 20, itemReverseZIndex: true }
          }
        }
      }
    }

    await applyCanvasFromTool(update)
    expect(root).toMatchObject({
      itemSpacing: -12,
      counterAxisSpacing: 20,
      itemReverseZIndex: true,
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'WRAP',
      paddingLeft: 16,
      paddingRight: 16,
      counterAxisAlignItems: 'CENTER',
      width: 320,
      height: 200
    })
    expect(root.children.map((node) => node.id)).toEqual([created.nodeIdsByKey.child])
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })

    const synchronized = {
      ...update,
      native: {
        root: {
          figma: {
            autoLayout: { itemSpacing: 0, counterAxisSpacing: null, itemReverseZIndex: false }
          }
        }
      }
    }
    await applyCanvasFromTool(synchronized)
    expect(root).toMatchObject({ itemSpacing: 0, counterAxisSpacing: 0, itemReverseZIndex: false })
    await expect(applyCanvasFromTool(synchronized)).resolves.toMatchObject({ mutationCount: 0 })

    await applyCanvasFromTool({
      ...update,
      native: { root: { figma: { autoLayout: { itemSpacing: 6 } } } }
    })
    expect(root).toMatchObject({ itemSpacing: 6, counterAxisSpacing: 6, itemReverseZIndex: false })
    await applyCanvasFromTool({
      ...update,
      native: { root: { figma: { autoLayout: { counterAxisSpacing: 6 } } } }
    })
    await applyCanvasFromTool({
      ...update,
      native: { root: { figma: { autoLayout: { itemSpacing: 12 } } } }
    })
    expect(root).toMatchObject({ itemSpacing: 12, counterAxisSpacing: 6 })
  })

  it.each<CanvasFigmaProperties>([
    { text: { paragraphSpacing: 8 } },
    { shape: { type: 'RECTANGLE' } },
    { section: { contentsHidden: true } },
    { group: true },
    { booleanOperation: 'UNION' },
    { component: { type: 'COMPONENT' } },
    { slot: {} }
  ])(
    'rejects native-only type declarations that do not match the live frame: %j',
    async (properties) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: '<div data-key="root" class="w-[120px] h-[80px]"></div>'
      })
      const root = fixture.getNode(created.rootNodeId!)

      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: root.id,
          native: { root: { figma: { ...properties, name: 'Must not be applied' } } }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
      })
      expect(root).toMatchObject({ name: 'root', type: 'FRAME', width: 120, height: 80 })
    }
  )

  it.each([
    { classes: 'w-[120px] h-[80px]', autoLayout: { itemSpacing: 4 } },
    { classes: 'grid grid-cols-2 w-[120px] h-[80px]', autoLayout: { itemSpacing: 4 } },
    { classes: 'flex flex-row w-[120px] h-[80px]', autoLayout: { counterAxisSpacing: 4 } }
  ])(
    'rejects native-only Auto Layout state incompatible with the live layout: %j',
    async ({ classes, autoLayout }) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: `<div data-key="root" class="${classes}"></div>`
      })
      const root = fixture.getNode(created.rootNodeId!)
      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: root.id,
          native: { root: { figma: { autoLayout, name: 'Must not be applied' } } }
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
      })
      expect(root.name).toBe('root')
    }
  )

  it.each<CanvasFigmaProperties>([
    { corners: { radius: 8 } },
    { corners: { smoothing: 0.5 } },
    { stroke: { weights: { top: 1, right: 2, bottom: 3, left: 4 } } }
  ])('rejects native-only geometry unsupported by a text node: %j', async (properties) => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[120px] h-[80px]"><span data-key="copy" class="w-fit h-fit">Text</span></div>'
    })
    const copy = fixture.getNode(created.nodeIdsByKey.copy!)
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: copy.id,
        native: { copy: { figma: { ...properties, name: 'Must not be applied' } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
    expect(copy.name).toBe('copy')
  })

  it('resolves native-only component property definitions before dependent sublayer bindings', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="card" class="flex flex-col w-[200px] h-[100px]"><span data-key="title" class="w-fit h-fit">Title</span></div>',
      native: { card: { figma: { component: { type: 'COMPONENT' } } } }
    })
    const card = fixture.getNode(created.rootNodeId!) as unknown as ComponentNode
    const title = fixture.getNode(created.nodeIdsByKey.title!) as unknown as TextNode
    const update = {
      mode: 'update' as const,
      targetNodeId: card.id,
      native: {
        title: { figma: { componentPropertyReferences: { characters: 'title' } } },
        card: {
          figma: {
            component: {
              type: 'COMPONENT' as const,
              properties: { title: { type: 'TEXT' as const, name: 'Title', defaultValue: 'Title' } }
            }
          }
        }
      }
    }

    await applyCanvasFromTool(update)
    const propertyName = Object.keys(card.componentPropertyDefinitions).find((name) =>
      name.startsWith('Title#')
    )!
    expect(propertyName).toBeDefined()
    expect(title.componentPropertyReferences).toEqual({ characters: propertyName })
    expect(card.children.map((node) => node.id)).toEqual([title.id])
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preserves Auto Layout translation while resolving native-only vector Pattern references', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[200px] h-[100px]"><div data-key="icon" class="w-[24px] h-[24px]"></div><div data-key="source" class="w-[24px] h-[24px]"></div></div>',
      native: {
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
    const icon = fixture.getNode(created.nodeIdsByKey.icon!) as unknown as VectorNode
    const source = fixture.getNode(created.nodeIdsByKey.source!)
    const translation = [icon.relativeTransform[0][2], icon.relativeTransform[1][2]]
    const update = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      native: {
        icon: {
          figma: {
            relativeTransform: [
              [0, -1, 300],
              [1, 0, 400]
            ],
            shape: {
              type: 'VECTOR',
              network: {
                vertices: [
                  { x: 0, y: 0 },
                  { x: 24, y: 0 },
                  { x: 0, y: 24 }
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
                    fills: [
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
                ]
              }
            }
          }
        }
      }
    }

    await applyCanvasFromTool(update)
    expect(icon.relativeTransform).toEqual([
      [0, -1, translation[0]],
      [1, 0, translation[1]]
    ])
    expect(icon.vectorNetwork.regions?.[0]?.fills).toMatchObject([
      { type: 'PATTERN', sourceNodeId: source.id }
    ])
    expect(icon).toMatchObject({ width: 24, height: 24 })
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects conflicting native-only exact fonts and text styles before mutation', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[200px] h-[100px]"><span data-key="copy" class="w-fit h-fit">Text</span></div>',
      styles: {
        body: {
          type: 'TEXT',
          name: 'Body',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16
        }
      }
    })
    const copy = fixture.getNode(created.nodeIdsByKey.copy!) as unknown as TextNode
    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: {
          copy: {
            styles: { text: { styleKey: 'body' } },
            figma: {
              name: 'Must not be applied',
              text: { fontName: { family: 'Roboto', style: 'Bold' } }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
    expect(copy).toMatchObject({ name: 'copy', textStyleId: '' })
    const update = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      native: { copy: { styles: { text: { styleKey: 'body' } } } }
    }
    await applyCanvasFromTool(update)
    expect(copy.textStyleId).not.toBe('')
    expect(copy.fontName).toEqual({ family: 'Inter', style: 'Regular' })
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })

    const unlinked = {
      ...update,
      native: {
        copy: {
          styles: { text: null },
          figma: { text: { fontName: { family: 'Roboto', style: 'Bold' } } }
        }
      }
    }
    await applyCanvasFromTool(unlinked)
    expect(copy).toMatchObject({ textStyleId: '', fontName: { family: 'Roboto', style: 'Bold' } })
    await expect(applyCanvasFromTool(unlinked)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects a markup-less native key outside the update scope', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="root" class="w-[120px] h-[80px]"></div>'
    })

    await expect(
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { missing: { figma: { locked: true } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE },
      message: expect.stringContaining('does not exist inside the update scope')
    })
    expect(fixture.getNode(created.rootNodeId!).locked).toBe(false)
  })

  it('preserves float32 transform translations without hiding position or axis changes', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup: '<div data-key="root" class="w-20 h-20"/>'
    })
    const root = fixture.getNode(created.rootNodeId!)
    const descriptor = Object.getOwnPropertyDescriptor(root, 'relativeTransform')!
    const write = vi.fn((value: Transform) => {
      const rounded = value.map((row) => row.map(Math.fround)) as Transform
      descriptor.set!.call(root, rounded)
    })
    Object.defineProperty(root, 'relativeTransform', { ...descriptor, set: write })
    const update = (relativeTransform: Transform) =>
      applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        native: { root: { figma: { relativeTransform } } }
      })
    const transform: Transform = [
      [1, 0, 1000.1],
      [0, 1, -1000.1]
    ]
    await update(transform)
    expect(root.x).toBe(Math.fround(1000.1))
    expect(root.y).toBe(Math.fround(-1000.1))
    expect(write).toHaveBeenCalledOnce()
    await expect(update(transform)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(write).toHaveBeenCalledOnce()

    transform[0][2] = 1000.1002
    await expect(update(transform)).resolves.toMatchObject({ mutationCount: 1 })
    expect(root.x).toBe(Math.fround(1000.1002))
    expect(write).toHaveBeenCalledTimes(2)
    await expect(update(transform)).resolves.toMatchObject({ mutationCount: 0 })

    const angle = 2e-6
    transform[0][0] = transform[1][1] = Math.cos(angle)
    transform[0][1] = Math.sin(angle)
    transform[1][0] = -Math.sin(angle)
    await expect(update(transform)).resolves.toMatchObject({ mutationCount: 1 })
    expect(root.relativeTransform[0][1]).toBe(Math.fround(Math.sin(angle)))
    expect(write).toHaveBeenCalledTimes(3)
    await expect(update(transform)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('updates native stroke and corner geometry without markup and preserves omitted appearance', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[80px] h-[48px] bg-[#112233] border-[2px] border-[#445566] rounded-[4px] opacity-50"></div></div>',
      native: { shape: { figma: { shape: { type: 'RECTANGLE' } } } }
    })
    const root = fixture.getNode(created.rootNodeId!)
    const shape = fixture.getNode(created.nodeIdsByKey.shape!) as unknown as RectangleNode
    const fills = shape.fills
    const strokes = shape.strokes
    const update = {
      mode: 'update' as const,
      targetNodeId: root.id,
      native: {
        shape: {
          figma: {
            stroke: {
              weight: 5,
              align: 'OUTSIDE' as const,
              cap: 'SQUARE' as const,
              join: 'BEVEL' as const,
              miterLimit: 6,
              dashPattern: [4, 3]
            },
            corners: { radius: 10, smoothing: 0.75 }
          }
        }
      }
    }

    await applyCanvasFromTool(update)
    expect(shape).toMatchObject({
      strokeWeight: 5,
      strokeAlign: 'OUTSIDE',
      strokeCap: 'SQUARE',
      strokeJoin: 'BEVEL',
      strokeMiterLimit: 6,
      dashPattern: [4, 3],
      cornerRadius: 10,
      cornerSmoothing: 0.75,
      width: 80,
      height: 48,
      opacity: 0.5,
      fills,
      strokes
    })
    expect(root.children.map((node) => node.id)).toEqual([shape.id])
    await expect(applyCanvasFromTool(update)).resolves.toMatchObject({ mutationCount: 0 })

    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: root.id,
      native: {
        shape: { figma: { stroke: { dashPattern: [] }, corners: { smoothing: 0 } } }
      }
    })
    expect(shape).toMatchObject({
      strokeWeight: 5,
      strokeAlign: 'OUTSIDE',
      dashPattern: [],
      cornerRadius: 10,
      cornerSmoothing: 0
    })

    const individual = {
      mode: 'update' as const,
      targetNodeId: root.id,
      native: {
        shape: {
          figma: {
            stroke: { weights: { top: 0, right: 2, bottom: 3, left: 4 } },
            corners: { radii: { topLeft: 0, topRight: 6, bottomRight: 7, bottomLeft: 8 } }
          }
        }
      }
    }
    await applyCanvasFromTool(individual)
    expect(shape).toMatchObject({
      strokeTopWeight: 0,
      strokeRightWeight: 2,
      strokeBottomWeight: 3,
      strokeLeftWeight: 4,
      topLeftRadius: 0,
      topRightRadius: 6,
      bottomRightRadius: 7,
      bottomLeftRadius: 8,
      fills,
      strokes
    })
    await expect(applyCanvasFromTool(individual)).resolves.toMatchObject({ mutationCount: 0 })
  })
})
