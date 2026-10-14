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

import type { FigmaFixture } from '../../fakes/figma'

import { createFixture } from '../../fakes/figma'
import { createFontLoadingFixture } from '../../fakes/font-loading'

function deferFont(fixture: FigmaFixture, target: FontName) {
  const requested = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const fonts = createFontLoadingFixture(async (font) => {
    if (font.family === target.family && font.style === target.style) {
      requested.resolve()
      await ready.promise
    }
  })
  fixture.loadFontAsync.mockImplementation(fonts.loadFontAsync)
  return { ...fonts, requested: requested.promise, release: () => ready.resolve() }
}

async function waitForDeferredFont(pending: Promise<unknown>, requested: Promise<void>) {
  await Promise.race([
    requested,
    pending.then(() => {
      throw new Error('The update completed without requesting the deferred font')
    })
  ])
  // Drain runnable promise continuations while the font remains unavailable. A
  // missing await must not be hidden by releasing the font in the same microtask.
  await new Promise<void>((resolve) => setImmediate(resolve))
}

afterEach(() => {
  resetAssetCache()
  setAssetDownloader(null)
  setAssetServerUrl(null)
  setAssetUploader(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/tools/canvas font loading', () => {
  it.each(['resize', 'autoResize', 'unbind'] as const)(
    'waits for the unchanged current font before a %s-only update',
    async (operation) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-24 h-8">Label</span></div>'
      })
      const label = fixture.getNode(created.nodeIdsByKey.label!) as TextNode
      if (operation === 'unbind')
        label.setBoundVariable('fontSize', fixture.variables.get('variable:spacing')!)
      const current = label.fontName as FontName
      const fonts = deferFont(fixture, current)
      const writes = vi.fn(() => fonts.requireLoadedFont(current, operation))
      if (operation === 'resize') {
        const resize = label.resize.bind(label)
        vi.spyOn(label, 'resize').mockImplementation((width, height) => {
          writes()
          resize(width, height)
        })
      } else if (operation === 'autoResize') {
        const set = Object.getOwnPropertyDescriptor(label, 'textAutoResize')!.set!
        vi.spyOn(label, 'textAutoResize', 'set').mockImplementation((value) => {
          writes()
          set.call(label, value)
        })
      } else {
        const bind = vi.mocked(label.setBoundVariable).getMockImplementation()!
        vi.spyOn(label, 'setBoundVariable').mockImplementation((field, variable) => {
          if (field === 'fontSize' && variable === null) writes()
          bind(field, variable)
        })
      }
      const pending = applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        ...(operation === 'unbind'
          ? { native: { label: { variables: { fontSize: null } } } }
          : {
              markup: `<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="${operation === 'resize' ? 'w-40 h-8' : 'w-24 h-fit'}">Label</span></div>`
            })
      })
      void pending.catch(() => undefined)
      try {
        await waitForDeferredFont(pending, fonts.requested)
        expect(writes).not.toHaveBeenCalled()
        expect(label).toMatchObject({ width: 96, height: 32, textAutoResize: 'NONE' })
        if (operation === 'unbind') expect(label.boundVariables?.fontSize).toBeDefined()
      } finally {
        fonts.release()
        await pending
      }
      expect(writes).toHaveBeenCalled()
      expect(label.fontName).toEqual(current)
      if (operation === 'resize') expect(label.width).toBe(160)
      if (operation === 'autoResize') expect(label.textAutoResize).toBe('HEIGHT')
      if (operation === 'unbind') expect(label.boundVariables?.fontSize).toBeUndefined()
    }
  )

  it('waits for the exact weight-only target face before binding its variable', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="size-fit">Label</span></div>',
      variableCollections: {
        typography: {
          name: 'Typography',
          modes: { base: { name: 'Base' } },
          variables: { weight: { name: 'Weight', type: 'FLOAT', values: { base: 600 } } }
        }
      }
    })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as TextNode
    const target = { family: 'Inter', style: 'Semi Bold' }
    const fonts = deferFont(fixture, target)
    const bind = vi.mocked(label.setBoundVariable).getMockImplementation()!
    const writes = vi.fn(() => fonts.requireLoadedFont(target, 'bind fontWeight'))
    vi.spyOn(label, 'setBoundVariable').mockImplementation((field, variable) => {
      if (field === 'fontWeight') writes()
      bind(field, variable)
    })
    const pending = applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { label: { variables: { fontWeight: { variableKey: 'weight' } } } }
    })
    void pending.catch(() => undefined)
    try {
      await waitForDeferredFont(pending, fonts.requested)
      expect(writes).not.toHaveBeenCalled()
      expect(label.boundVariables?.fontWeight).toBeUndefined()
    } finally {
      fonts.release()
      await pending
    }
    expect(writes).toHaveBeenCalledOnce()
    expect(label.boundVariables?.fontWeight).toBeDefined()
  })

  it('waits for a cold TextStyle font before changing only its font size', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="size-fit">Label</span></div>',
      styles: {
        body: {
          type: 'TEXT',
          name: 'Body',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16
        }
      },
      native: { label: { styles: { text: { styleKey: 'body' } } } }
    })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as TextNode
    const style = fixture.styles.get(label.textStyleId as string) as TextStyle
    const fonts = deferFont(fixture, style.fontName)
    let fontSize = style.fontSize
    const writes = vi.fn((value: number) => {
      fonts.requireLoadedFont(style.fontName, 'write TextStyle.fontSize')
      fontSize = value
    })
    Object.defineProperty(style, 'fontSize', {
      configurable: true,
      get: () => fontSize,
      set: writes
    })
    const pending = applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { root: { figma: { name: 'Restyled' } } },
      styles: { body: { type: 'TEXT', fontSize: 24 } }
    })
    void pending.catch(() => undefined)
    try {
      await waitForDeferredFont(pending, fonts.requested)
      expect(writes).not.toHaveBeenCalled()
      expect(style.fontSize).toBe(16)
    } finally {
      fonts.release()
      await pending
    }
    expect(writes).toHaveBeenCalledOnce()
    expect(style.fontSize).toBe(24)
  })

  it('preserves portable weights when family and weight classes change independently', async () => {
    const fixture = createFixture()
    const markup = (textClass: string) => `
      <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
        <span data-key="title" class="w-fit h-fit ${textClass}">Title</span>
      </div>
    `
    const created = await applyCanvas({ mode: 'create', markup: markup('font-sans font-semibold') })
    const title = fixture.getNode(created.nodeIdsByKey.title ?? '') as unknown as TextNode

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: markup('font-serif')
    })
    expect(title.fontName).toEqual({ family: 'Noto Serif', style: 'SemiBold' })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: markup('font-extrabold')
    })
    expect(title.fontName).toEqual({ family: 'Noto Serif', style: 'ExtraBold' })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: markup('font-sans')
    })
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Extra Bold' })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: markup('font-extralight')
    })
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Extra Light' })

    await applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: markup('font-mono')
    })
    expect(title.fontName).toEqual({ family: 'Noto Sans Mono', style: 'ExtraLight' })
  })

  it('resolves a portable family and closest weight from fonts available to the editor', async () => {
    const fixture = createFixture()
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Roboto Mono', style: 'Regular' } },
      { fontName: { family: 'Roboto Mono', style: 'Medium' } }
    ] satisfies Font[])

    const result = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="title" class="size-fit font-mono font-semibold">01:24:08</span></div>'
    })
    const title = fixture.getNode(result.nodeIdsByKey.title ?? '') as unknown as TextNode

    expect(title.fontName).toEqual({ family: 'Roboto Mono', style: 'Medium' })
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({
      family: 'Roboto Mono',
      style: 'Medium'
    })
  })

  it.each(['markup', 'native'] as const)(
    'loads cold desired fonts before declaring resources in a %s update',
    async (kind) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="title" class="size-fit">Before</span></div>'
      })
      const title = fixture.getNode(created.nodeIdsByKey.title!) as TextNode
      const beforeCollections = [...fixture.variableCollections.keys()]
      const beforeStyles = [...fixture.styles.keys()]
      fixture.commitUndo.mockClear()
      fixture.triggerUndo.mockClear()
      const started = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
        if (font.family === 'Noto Serif' && font.style === 'SemiBold') {
          started.resolve()
          await ready.promise
        }
      })
      const pending = applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        ...(kind === 'markup'
          ? {
              markup:
                '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="title" class="size-fit font-serif font-semibold">After</span></div>',
              variableCollections: {
                fresh: { name: 'Fresh tokens', modes: { base: { name: 'Base' } } }
              }
            }
          : {
              native: {
                title: {
                  figma: { text: { fontName: { family: 'Noto Serif', style: 'SemiBold' } } }
                }
              },
              styles: { fresh: { type: 'PAINT', name: 'Fresh paint', paints: [] } }
            })
      })
      void pending.catch(() => undefined)
      try {
        await Promise.race([
          started.promise,
          pending.then(() => {
            throw new Error('The desired font was not requested')
          })
        ])
        expect([...fixture.variableCollections.keys()]).toEqual(beforeCollections)
        expect([...fixture.styles.keys()]).toEqual(beforeStyles)
        expect(title.characters).toBe('Before')
        expect(title.fontName).toEqual({ family: 'Inter', style: 'Regular' })
        expect(fixture.commitUndo).not.toHaveBeenCalled()
      } finally {
        ready.resolve()
        await pending
      }
      expect(title.fontName).toEqual({ family: 'Noto Serif', style: 'SemiBold' })
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['fontFamily', 'fontStyle'] as const)(
    'defers mixed literal font candidates until a same-call %s variable update is applied',
    async (field) => {
      const fixture = createFixture()
      const initial = field === 'fontFamily' ? 'Inter' : 'Regular'
      const desired = field === 'fontFamily' ? 'Display' : 'Condensed'
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="title" class="size-fit">Title</span></div>',
        variableCollections: {
          typography: {
            name: 'Typography',
            modes: { base: { name: 'Base' } },
            variables: { axis: { name: 'Axis', type: 'STRING', values: { base: initial } } }
          }
        }
      })
      const title = fixture.getNode(created.nodeIdsByKey.title!) as TextNode
      const variable = [...fixture.variables.values()].find((value) => value.name === 'Axis')!
      title.setBoundVariable(field, variable)
      let literalFont: FontName = { family: 'Inter', style: 'Regular' }
      // This fixture models fontName reflecting a bound variable; it is not a native Figma check.
      Object.defineProperty(title, 'fontName', {
        configurable: true,
        get: () => ({
          ...literalFont,
          [field === 'fontFamily' ? 'family' : 'style']: variable.resolveForConsumer(title).value
        }),
        set: (font: FontName) => {
          literalFont = font
        }
      })
      const staleCandidate =
        field === 'fontFamily'
          ? { family: 'Inter', style: 'Condensed' }
          : { family: 'Display', style: 'Regular' }
      fixture.loadFontAsync.mockClear()
      fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
        if (font.family === staleCandidate.family && font.style === staleCandidate.style)
          throw new Error('The old bound value and new literal do not form an available font')
      })
      await applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        variableCollections: {
          typography: {
            variables: { axis: { type: 'STRING', values: { base: desired } } }
          }
        },
        native: {
          title: { figma: { text: { fontName: { family: 'Display', style: 'Condensed' } } } }
        }
      })
      expect(variable.resolveForConsumer(title).value).toBe(desired)
      expect(title.fontName).toEqual({ family: 'Display', style: 'Condensed' })
      expect(fixture.loadFontAsync).not.toHaveBeenCalledWith(staleCandidate)
    }
  )

  it('rejects unavailable desired fonts before creating declared resources or a page', async () => {
    const fixture = createFixture()
    const beforeCollections = [...fixture.variableCollections.keys()]
    const beforeStyles = [...fixture.styles.keys()]
    fixture.loadFontAsync.mockRejectedValue(new Error('Font unavailable'))
    await expect(
      applyCanvasFromTool({
        mode: 'create',
        page: { pageKey: 'cold-font', name: 'Cold font' },
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="title" class="size-fit font-serif">Title</span></div>',
        variableCollections: { fresh: { name: 'Fresh tokens', modes: { base: { name: 'Base' } } } },
        styles: { fresh: { type: 'PAINT', name: 'Fresh paint', paints: [] } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: expect.stringContaining('Font "Noto Serif Regular" is unavailable')
    })
    expect([...fixture.variableCollections.keys()]).toEqual(beforeCollections)
    expect([...fixture.styles.keys()]).toEqual(beforeStyles)
    expect(fixture.pages).toEqual([fixture.page])
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('matches named weights against an existing custom font family before resizing text', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="title" class="w-fit h-fit">Title</span></div>'
    })
    const title = fixture.getNode(created.nodeIdsByKey.title!) as unknown as TextNode
    title.fontName = { family: 'Poppins', style: 'Regular' }
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Poppins', style: 'Regular' } },
      { fontName: { family: 'Poppins', style: 'SemiBold' } }
    ])
    fixture.loadFontAsync.mockClear()
    const regular = Promise.withResolvers<void>()
    const semibold = Promise.withResolvers<void>()
    const regularStarted = Promise.withResolvers<void>()
    const semiboldStarted = Promise.withResolvers<void>()
    const fonts = createFontLoadingFixture(async (font) => {
      if (font.family === 'Poppins' && font.style === 'Regular') {
        regularStarted.resolve()
        await regular.promise
      }
      if (font.family === 'Poppins' && font.style === 'SemiBold') {
        semiboldStarted.resolve()
        await semibold.promise
      }
    })
    fixture.loadFontAsync.mockImplementation(fonts.loadFontAsync)
    let fontName: FontName = { family: 'Poppins', style: 'Regular' }
    const setFontName = vi.fn((font: FontName) => {
      fonts.requireLoadedFont(font)
      fontName = font
    })
    Object.defineProperty(title, 'fontName', {
      configurable: true,
      get: () => fontName,
      set: setFontName
    })
    const resize = title.resize.bind(title)
    vi.spyOn(title, 'resize').mockImplementation((width, height) => {
      fonts.requireLoadedFont(fontName)
      resize(width, height)
    })
    const update = applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="title" class="w-40 h-10 font-semibold">Title</span></div>'
    })
    void update.catch(() => undefined)
    try {
      await regularStarted.promise
      expect(title.resize).not.toHaveBeenCalled()
      expect(setFontName).not.toHaveBeenCalled()
      regular.resolve()
      await semiboldStarted.promise
      expect(title.resize).not.toHaveBeenCalled()
      expect(setFontName).not.toHaveBeenCalled()
    } finally {
      regular.resolve()
      semibold.resolve()
    }
    await update
    expect(title.fontName).toEqual({ family: 'Poppins', style: 'SemiBold' })
    expect(title.width).toBe(160)
    expect(title.height).toBe(40)
    expect(title.resize).toHaveBeenCalled()
  })

  it('replaces an authored typography variable with a TextStyle in one update', async () => {
    const fixture = createFixture()
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[300px] h-[100px]"><span data-key="label" class="w-full h-fit text-(length:--size)">Hello</span></div>',
      theme: { variables: { '--size': { variableKey: 'type/size' } } },
      variableCollections: {
        typography: {
          name: 'Typography',
          modes: { base: { name: 'Base' } },
          variables: { 'type/size': { name: 'Size', type: 'FLOAT', values: { base: 18 } } }
        }
      }
    })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    expect(label.boundVariables?.fontSize).toBeDefined()
    const updated = await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-[300px] h-[100px]"><span data-key="label" class="w-full h-fit type-body">Hello</span></div>',
      theme: { textStyles: { 'type-body': { styleKey: 'type/body' } } },
      native: { label: { variables: { fontSize: null } } },
      styles: {
        'type/body': {
          type: 'TEXT',
          name: 'Body',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16
        }
      }
    })
    expect(updated.nodeIdsByKey.label).toBe(label.id)
    expect(label.boundVariables?.fontSize).toBeUndefined()
    expect(label.textStyleId).not.toBe('')
    expect(label.fontSize).toBe(16)
  })

  it.each([
    { styles: ['Light', 'Medium', 'Regular Italic'], weight: 'font-[400]', expected: 'Light' },
    { styles: ['Medium', 'Light', 'Regular Italic'], weight: 'font-[400]', expected: 'Medium' },
    { styles: ['Light', 'Regular', 'Medium'], weight: 'font-[400]', expected: 'Regular' },
    { styles: ['Bold Italic', 'Regular', 'Light'], weight: 'font-bold', expected: 'Regular' }
  ])(
    'preserves closest-font ordering and slant for $styles with $weight',
    async ({ styles, weight, expected }) => {
      const fixture = createFixture()
      fixture.listAvailableFontsAsync.mockResolvedValue(
        styles.map((style) => ({ fontName: { family: 'Test Family', style } }))
      )
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup: `<div data-key="root" class="flex flex-col w-[300px] h-[100px]"><span data-key="label" class="w-fit h-fit font-[family-name:Test_Family] ${weight}">Text</span></div>`
      })
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      expect(label.fontName).toEqual({ family: 'Test Family', style: expected })
    }
  )

  it('loads the available font face for the consumer mode before binding family and weight tokens', async () => {
    const fixture = createFixture()
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Noto Sans SC', style: 'Regular' } },
      { fontName: { family: 'Noto Sans SC', style: 'SemiBold' } },
      { fontName: { family: 'Noto Sans TC', style: 'DemiBold' } }
    ])
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="label" class="w-full h-fit font-(family-name:--family) font-(--weight)">中文</span></div>',
      theme: {
        variables: {
          '--family': { variableKey: 'type/family' },
          '--weight': { variableKey: 'type/weight' }
        }
      },
      variableCollections: {
        typography: {
          name: 'Typography',
          modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
          variables: {
            'type/family': {
              name: 'Family',
              type: 'STRING',
              values: { light: 'Noto Sans SC', dark: 'Noto Sans TC' }
            },
            'type/weight': { name: 'Weight', type: 'FLOAT', values: { light: 600, dark: 600 } }
          }
        }
      },
      native: { root: { variableModes: { typography: 'dark' } } }
    })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    expect(label.fontName).toEqual({ family: 'Noto Sans TC', style: 'DemiBold' })
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({
      family: 'Noto Sans TC',
      style: 'DemiBold'
    })
    expect(label.boundVariables?.fontFamily).toBeDefined()
    expect(label.boundVariables?.fontWeight).toBeDefined()
    expect(fixture.loadFontAsync).not.toHaveBeenCalledWith({
      family: 'Noto Sans TC',
      style: 'Semi Bold'
    })
  })

  it.each([
    { target: 'node', changeStyle: false },
    { target: 'node', changeStyle: true },
    { target: 'range', changeStyle: false },
    { target: 'range', changeStyle: true },
    { target: 'style', changeStyle: false },
    { target: 'style', changeStyle: true }
  ] as const)(
    'loads each font reached by sequential $target bindings with style change $changeStyle',
    async ({ target, changeStyle }) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-fit h-fit">Label</span></div>',
        variableCollections: {
          typography: {
            name: 'Typography',
            modes: { base: { name: 'Base' } },
            variables: {
              family: { name: 'Family', type: 'STRING', values: { base: 'Noto Serif' } },
              style: { name: 'Style', type: 'STRING', values: { base: 'SemiBold' } }
            }
          }
        },
        ...(target === 'style'
          ? {
              styles: {
                body: {
                  type: 'TEXT',
                  name: 'Body',
                  fontName: { family: 'Inter', style: 'Regular' }
                }
              },
              native: { label: { styles: { text: { styleKey: 'body' } } } }
            }
          : {})
      })
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const variables = {
        fontFamily: { variableKey: 'family' },
        ...(changeStyle ? { fontStyle: { variableKey: 'style' } } : {})
      }
      const fonts = createFontLoadingFixture()
      fixture.loadFontAsync.mockImplementation(fonts.loadFontAsync)

      let currentFont = () => label.fontName as FontName
      if (target === 'style') {
        const style = fixture.styles.get(label.textStyleId as string) as TextStyle
        const bind = style.setBoundVariable.bind(style)
        vi.spyOn(style, 'setBoundVariable').mockImplementation((field, variable) => {
          const next = fonts.resolveBoundFont(style.fontName, field, variable, label)
          bind(field, variable)
          style.fontName = next
        })
        currentFont = () => style.fontName
      } else if (target === 'range') {
        const bind = vi.mocked(label.setRangeBoundVariable).getMockImplementation()!
        vi.spyOn(label, 'setRangeBoundVariable').mockImplementation(
          (start, end, field, variable) => {
            const next = fonts.resolveBoundFont(
              label.getRangeFontName(start, end) as FontName,
              field,
              variable,
              label
            )
            bind(start, end, field, variable)
            label.setRangeFontName(start, end, next)
          }
        )
        currentFont = () => label.getRangeFontName(0, 5) as FontName
      } else {
        const bind = vi.mocked(label.setBoundVariable).getMockImplementation()!
        vi.spyOn(label, 'setBoundVariable').mockImplementation((field, variable) => {
          const next = fonts.resolveBoundFont(label.fontName as FontName, field, variable, label)
          bind(field, variable)
          label.fontName = next
        })
      }

      await expect(
        applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          ...(target === 'style'
            ? {
                styles: { body: { type: 'TEXT', variables } },
                native: { root: { figma: { name: 'Updated' } } }
              }
            : target === 'range'
              ? {
                  native: {
                    label: { figma: { text: { ranges: [{ start: 0, end: 5, variables }] } } }
                  }
                }
              : { native: { label: { variables } } })
        })
      ).resolves.toMatchObject({ verification: { status: 'passed' } })
      expect(currentFont()).toEqual({
        family: 'Noto Serif',
        style: changeStyle ? 'SemiBold' : 'Regular'
      })
    }
  )

  it('loads fonts in binding order when a theme family follows a native style on styled text', async () => {
    const fixture = createFixture()
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Inter', style: 'Bold' } },
      { fontName: { family: 'Noto Serif', style: 'Regular' } },
      { fontName: { family: 'Noto Serif', style: 'Bold' } }
    ])
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-fit h-fit">Label</span></div>',
      variableCollections: {
        typography: {
          name: 'Typography',
          modes: { base: { name: 'Base' } },
          variables: {
            family: { name: 'Family', type: 'STRING', values: { base: 'Noto Serif' } },
            style: { name: 'Style', type: 'STRING', values: { base: 'Bold' } }
          }
        }
      },
      styles: {
        body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
      },
      native: { label: { styles: { text: { styleKey: 'body' } } } }
    })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const fonts = createFontLoadingFixture()
    fixture.loadFontAsync.mockImplementation(fonts.loadFontAsync)
    const bindings: string[] = []
    const bind = vi.mocked(label.setBoundVariable).getMockImplementation()!
    vi.spyOn(label, 'setBoundVariable').mockImplementation((field, variable) => {
      if (variable && (field === 'fontFamily' || field === 'fontStyle')) {
        const next = fonts.resolveBoundFont(label.fontName as FontName, field, variable, label)
        bindings.push(field)
        label.fontName = next
      }
      bind(field, variable)
    })

    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-fit h-fit font-(family-name:--family)">Label</span></div>',
      theme: { variables: { '--family': { variableKey: 'family' } } },
      native: { label: { variables: { fontStyle: { variableKey: 'style' } } } }
    })
    expect(bindings).toEqual(['fontStyle', 'fontFamily'])
    expect(label.fontName).toEqual({ family: 'Noto Serif', style: 'Bold' })
  })

  it('loads TextStyle variable font targets before binding, including aliases and retained bindings', async () => {
    const fixture = createFixture()
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Poppins', style: 'Regular' } },
      { fontName: { family: 'Poppins', style: 'SemiBold' } },
      { fontName: { family: 'Noto Sans SC', style: 'SemiBold' } }
    ])
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-fit h-fit">Label</span></div>',
      styles: {
        body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
      },
      native: { label: { styles: { text: { styleKey: 'body' } } } }
    })
    const body = [...fixture.styles.values()].find(
      (style) => style.getSharedPluginData('tempad_dev', 'style-key') === 'body'
    ) as TextStyle
    const bind = body.setBoundVariable.bind(body)
    vi.spyOn(body, 'setBoundVariable').mockImplementation((field, variable) => {
      expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Poppins', style: 'SemiBold' })
      bind(field, variable)
    })
    fixture.loadFontAsync.mockClear()
    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { root: { figma: { name: 'Styled' } } },
      variableCollections: {
        typography: {
          name: 'Typography',
          modes: { base: { name: 'Base' }, alternate: { name: 'Alternate' } },
          variables: {
            family: {
              name: 'Family',
              type: 'STRING',
              values: { base: 'Poppins', alternate: 'Noto Sans SC' }
            },
            alias: {
              name: 'Family alias',
              type: 'STRING',
              values: {
                base: { variable: { variableKey: 'family' } },
                alternate: { variable: { variableKey: 'family' } }
              }
            },
            weight: { name: 'Weight', type: 'FLOAT', values: { base: 600, alternate: 600 } }
          }
        }
      },
      styles: {
        body: {
          type: 'TEXT',
          variables: { fontFamily: { variableKey: 'alias' }, fontWeight: { variableKey: 'weight' } }
        }
      }
    })
    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { root: { variableModes: { typography: 'alternate' } } }
    })
    fixture.loadFontAsync.mockClear()
    await applyCanvasFromTool({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { root: { figma: { name: 'Restyled' } } },
      styles: { body: { type: 'TEXT', fontSize: 24 } }
    })
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Poppins', style: 'SemiBold' })
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({
      family: 'Noto Sans SC',
      style: 'SemiBold'
    })
  })

  it.each(['available', 'unavailable'] as const)(
    'preloads an existing TextStyle consumer font before resource writes when it is %s',
    async (availability) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="size-fit">Label</span></div>',
        styles: {
          body: {
            type: 'TEXT',
            name: 'Body',
            fontName: { family: 'Inter', style: 'Regular' },
            fontSize: 16
          }
        },
        native: { label: { styles: { text: { styleKey: 'body' } } } }
      })
      const root = fixture.getNode(created.rootNodeId!)
      const label = fixture.getNode(created.nodeIdsByKey.label!) as TextNode
      const body = fixture.styles.get(label.textStyleId as string) as TextStyle
      const collection = figma.variables.createVariableCollection('Typography')
      const alternate = collection.addMode('Alternate')
      const family = figma.variables.createVariable('Family', collection, 'STRING')
      family.setValueForMode(collection.defaultModeId, 'Inter')
      family.setValueForMode(alternate, 'Roboto')
      const weight = figma.variables.createVariable('Weight', collection, 'FLOAT')
      weight.setValueForMode(collection.defaultModeId, 400)
      weight.setValueForMode(alternate, 600)
      body.setBoundVariable('fontFamily', family)
      body.setBoundVariable('fontWeight', weight)
      label.setExplicitVariableModeForCollection(collection, alternate)
      fixture.listAvailableFontsAsync.mockResolvedValue([
        { fontName: { family: 'Inter', style: 'Regular' } },
        { fontName: { family: 'Roboto', style: 'Regular' } },
        { fontName: { family: 'Roboto', style: 'SemiBold' } }
      ])
      const beforeStyles = [...fixture.styles.keys()]
      const beforeName = root.name
      fixture.commitUndo.mockClear()
      fixture.triggerUndo.mockClear()
      const requested = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
        if (font.family !== 'Roboto' || font.style !== 'SemiBold') return
        requested.resolve()
        await ready.promise
        if (availability === 'unavailable') throw new Error('Font unavailable')
      })
      const pending = applyCanvasFromTool({
        mode: 'update',
        targetNodeId: root.id,
        native: { root: { figma: { name: 'Restyled' } } },
        styles: {
          fresh: { type: 'PAINT', name: 'Fresh paint' },
          body: { type: 'TEXT', fontSize: 24 }
        }
      })
      void pending.catch(() => undefined)
      try {
        await waitForDeferredFont(pending, requested.promise)
        expect([...fixture.styles.keys()]).toEqual(beforeStyles)
        expect(body.fontSize).toBe(16)
        expect(root.name).toBe(beforeName)
        expect(fixture.commitUndo).not.toHaveBeenCalled()
      } finally {
        ready.resolve()
        if (availability === 'unavailable') await expect(pending).rejects.toThrow('Roboto SemiBold')
        else await pending
      }
      if (availability === 'unavailable') {
        expect([...fixture.styles.keys()]).toEqual(beforeStyles)
        expect(body.fontSize).toBe(16)
        expect(root.name).toBe(beforeName)
        expect(fixture.commitUndo).not.toHaveBeenCalled()
      } else {
        expect(fixture.styles.size).toBe(beforeStyles.length + 1)
        expect(body.fontSize).toBe(24)
        expect(root.name).toBe('Restyled')
      }
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(['variable declaration', 'library import'] as const)(
    'defers existing TextStyle font targets that depend on a %s',
    async (dependency) => {
      const fixture = createFixture()
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="size-fit">Label</span></div>',
        styles: {
          body: {
            type: 'TEXT',
            name: 'Body',
            fontName: { family: 'Inter', style: 'Regular' },
            fontSize: 16
          }
        },
        native: { label: { styles: { text: { styleKey: 'body' } } } }
      })
      const label = fixture.getNode(created.nodeIdsByKey.label!) as TextNode
      const body = fixture.styles.get(label.textStyleId as string) as TextStyle
      const collection = figma.variables.createVariableCollection('Typography')
      const family = figma.variables.createVariable('Family', collection, 'STRING')
      const declaresVariable = dependency === 'variable declaration'
      family.setValueForMode(collection.defaultModeId, declaresVariable ? 'Unavailable' : 'Roboto')
      if (declaresVariable) body.setBoundVariable('fontFamily', family)
      fixture.listAvailableFontsAsync.mockResolvedValue([
        { fontName: { family: 'Inter', style: 'Regular' } },
        { fontName: { family: 'Roboto', style: 'Regular' } }
      ])
      fixture.commitUndo.mockClear()
      fixture.triggerUndo.mockClear()
      fixture.loadFontAsync.mockClear()
      const importVariable = vi
        .mocked(figma.variables.importVariableByKeyAsync)
        .getMockImplementation()!
      vi.mocked(figma.variables.importVariableByKeyAsync).mockImplementation((key) => {
        expect(fixture.commitUndo).toHaveBeenCalledOnce()
        return importVariable(key)
      })

      await applyCanvasFromTool({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { root: { figma: { name: 'Restyled' } } },
        ...(declaresVariable
          ? {
              variableCollections: {
                typography: {
                  id: collection.id,
                  variables: {
                    family: { id: family.id, values: { [collection.defaultModeId]: 'Roboto' } }
                  }
                }
              }
            }
          : {}),
        styles: {
          body: {
            type: 'TEXT',
            fontSize: 24,
            ...(!declaresVariable ? { variables: { fontFamily: { key: family.key } } } : {})
          }
        }
      })

      expect(body.fontSize).toBe(24)
      expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'Regular' })
      expect(fixture.loadFontAsync).not.toHaveBeenCalledWith(
        expect.objectContaining({ family: 'Unavailable' })
      )
      if (!declaresVariable)
        expect(figma.variables.importVariableByKeyAsync).toHaveBeenCalledWith(family.key)
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it.each(
    (['page-only', 'create', 'update'] as const).flatMap((operation) =>
      (['available', 'unavailable'] as const).map((availability) => ({ operation, availability }))
    )
  )(
    'preloads the first changed page mode before $operation writes when its font is $availability',
    async ({ operation, availability }) => {
      const fixture = createFixture()
      const existing =
        operation === 'update'
          ? await applyCanvasFromTool({
              mode: 'create',
              markup: '<div data-key="root" class="size-[40px]"></div>'
            })
          : undefined
      const root = existing ? fixture.getNode(existing.rootNodeId!) : undefined
      const collection = figma.variables.createVariableCollection('Typography')
      const alternate = collection.addMode('Alternate')
      const family = figma.variables.createVariable('Family', collection, 'STRING')
      family.setValueForMode(collection.defaultModeId, 'Inter')
      family.setValueForMode(alternate, 'Roboto')
      const label = figma.createText()
      label.characters = 'Label'
      label.setBoundVariable('fontFamily', family)
      fixture.page.setExplicitVariableModeForCollection(collection, collection.defaultModeId)
      fixture.listAvailableFontsAsync.mockResolvedValue([
        { fontName: { family: 'Inter', style: 'Regular' } },
        { fontName: { family: 'Roboto', style: 'Regular' } }
      ])
      const unchanged = figma.variables.createVariableCollection('Unchanged')
      const before = {
        name: fixture.page.name,
        backgrounds: fixture.page.backgrounds,
        guides: fixture.page.guides,
        explicitVariableModes: { ...fixture.page.explicitVariableModes }
      }
      const previousChildren = fixture.page.children.map((node) => node.id)
      fixture.commitUndo.mockClear()
      fixture.triggerUndo.mockClear()
      const requested = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
        if (font.family !== 'Roboto') return
        requested.resolve()
        await ready.promise
        if (availability === 'unavailable') throw new Error('Font unavailable')
      })
      const pending = applyCanvasFromTool({
        mode: operation === 'create' ? 'create' : 'update',
        ...(operation === 'page-only'
          ? {}
          : {
              markup: '<div data-key="root" class="w-[80px] h-[40px]"></div>',
              ...(existing ? { targetNodeId: existing.rootNodeId! } : {})
            }),
        page: {
          id: fixture.page.id,
          name: 'After',
          background: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
          guides: [{ axis: 'Y', offset: 12 }],
          variableModes: { [unchanged.id]: null, [collection.id]: alternate }
        }
      })
      void pending.catch(() => undefined)
      try {
        await waitForDeferredFont(pending, requested.promise)
        expect(fixture.page).toMatchObject(before)
        expect(fixture.page.children.map((node) => node.id)).toEqual(previousChildren)
        if (root) expect(root).toMatchObject({ width: 40, height: 40 })
        expect(fixture.commitUndo).not.toHaveBeenCalled()
        expect(fixture.triggerUndo).not.toHaveBeenCalled()
      } finally {
        ready.resolve()
        if (availability === 'unavailable') await expect(pending).rejects.toThrow('Roboto Regular')
        else await pending
      }
      if (availability === 'unavailable') {
        expect(fixture.page).toMatchObject(before)
        expect(fixture.page.children.map((node) => node.id)).toEqual(previousChildren)
        if (root) expect(root).toMatchObject({ width: 40, height: 40 })
        expect(fixture.commitUndo).not.toHaveBeenCalled()
      } else {
        expect(fixture.page).toMatchObject({
          name: 'After',
          backgrounds: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 1 }],
          guides: [{ axis: 'Y', offset: 12 }],
          explicitVariableModes: { [collection.id]: alternate }
        })
        if (root) expect(root).toMatchObject({ width: 80, height: 40 })
        if (operation === 'create')
          expect(fixture.page.children).toHaveLength(previousChildren.length + 1)
      }
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
    }
  )

  it('rechecks live page font requirements after the first mode is preloaded', async () => {
    const fixture = createFixture()
    const collection = figma.variables.createVariableCollection('Typography')
    const alternate = collection.addMode('Alternate')
    const family = figma.variables.createVariable('Family', collection, 'STRING')
    family.setValueForMode(collection.defaultModeId, 'Inter')
    family.setValueForMode(alternate, 'Roboto')
    const label = figma.createText()
    label.characters = 'Label'
    label.setBoundVariable('fontFamily', family)
    fixture.page.setExplicitVariableModeForCollection(collection, collection.defaultModeId)
    fixture.listAvailableFontsAsync.mockResolvedValue(
      ['Inter', 'Roboto', 'Noto Serif'].map((family) => ({
        fontName: { family, style: 'Regular' }
      }))
    )
    const fonts = createFontLoadingFixture(async (font) => {
      if (font.family === 'Roboto') family.setValueForMode(alternate, 'Noto Serif')
    })
    fixture.loadFontAsync.mockImplementation(fonts.loadFontAsync)
    const setMode = fixture.page.setExplicitVariableModeForCollection.bind(fixture.page)
    vi.spyOn(fixture.page, 'setExplicitVariableModeForCollection').mockImplementation(
      (collection, mode) => {
        fonts.requireLoadedFont({ family: 'Noto Serif', style: 'Regular' }, 'change page mode')
        setMode(collection, mode)
      }
    )

    await applyCanvasFromTool({
      mode: 'update',
      page: { id: fixture.page.id, variableModes: { [collection.id]: alternate } }
    })

    expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Noto Serif', style: 'Regular' })
    expect(fixture.page.explicitVariableModes[collection.id]).toBe(alternate)
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it('loads later page mode fonts against the preceding applied collection mode', async () => {
    const fixture = createFixture()
    const families = figma.variables.createVariableCollection('Families')
    const familyMode = families.addMode('Alternate')
    const family = figma.variables.createVariable('Family', families, 'STRING')
    family.setValueForMode(families.defaultModeId, 'Inter')
    family.setValueForMode(familyMode, 'Roboto')
    const styles = figma.variables.createVariableCollection('Styles')
    const styleMode = styles.addMode('Alternate')
    const style = figma.variables.createVariable('Style', styles, 'STRING')
    style.setValueForMode(styles.defaultModeId, 'Regular')
    style.setValueForMode(styleMode, 'SemiBold')
    const label = figma.createText()
    label.characters = 'Label'
    label.setBoundVariable('fontFamily', family)
    label.setBoundVariable('fontStyle', style)
    fixture.page.setExplicitVariableModeForCollection(families, families.defaultModeId)
    fixture.page.setExplicitVariableModeForCollection(styles, styles.defaultModeId)
    fixture.listAvailableFontsAsync.mockResolvedValue(
      ['Inter', 'Roboto'].flatMap((family) =>
        ['Regular', 'SemiBold'].map((style) => ({ fontName: { family, style } }))
      )
    )
    fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
      if (font.style !== 'SemiBold') return
      expect(font.family).toBe('Roboto')
      expect(fixture.page.explicitVariableModes[families.id]).toBe(familyMode)
    })

    await applyCanvasFromTool({
      mode: 'update',
      page: {
        id: fixture.page.id,
        variableModes: { [families.id]: familyMode, [styles.id]: styleMode }
      }
    })

    expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'SemiBold' })
    expect(fixture.loadFontAsync).not.toHaveBeenCalledWith({ family: 'Inter', style: 'SemiBold' })
    expect(fixture.page.explicitVariableModes).toEqual({
      [families.id]: familyMode,
      [styles.id]: styleMode
    })
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
  })

  it.each(['label', 'root', 'page'])(
    'preloads retained TextStyle target and transitional fonts before changing modes on %s',
    async (key) => {
      const fixture = createFixture()
      fixture.listAvailableFontsAsync.mockResolvedValue([
        { fontName: { family: 'Inter', style: 'Regular' } },
        { fontName: { family: 'Roboto', style: 'Regular' } },
        { fontName: { family: 'Roboto', style: 'SemiBold' } }
      ])
      const created = await applyCanvasFromTool({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-fit h-fit">Label</span></div>',
        variableCollections: {
          typography: {
            name: 'Typography',
            modes: { base: { name: 'Base' }, alt: { name: 'Alt' } },
            variables: {
              family: { name: 'Family', type: 'STRING', values: { base: 'Inter', alt: 'Roboto' } },
              alias: {
                name: 'Alias',
                type: 'STRING',
                values: {
                  base: { variable: { variableKey: 'family' } },
                  alt: { variable: { variableKey: 'family' } }
                }
              },
              weight: { name: 'Weight', type: 'FLOAT', values: { base: 400, alt: 600 } }
            }
          }
        },
        styles: {
          body: {
            type: 'TEXT',
            name: 'Body',
            fontName: { family: 'Inter', style: 'Regular' },
            variables: {
              fontFamily: { variableKey: 'alias' },
              fontWeight: { variableKey: 'weight' }
            }
          }
        },
        native: { label: { styles: { text: { styleKey: 'body' } } } }
      })
      const target = key === 'page' ? fixture.page : fixture.getNode(created.nodeIdsByKey[key]!)
      const setMode = vi.isMockFunction(target.setExplicitVariableModeForCollection)
        ? vi.mocked(target.setExplicitVariableModeForCollection).getMockImplementation()!
        : target.setExplicitVariableModeForCollection.bind(target)
      vi.spyOn(target, 'setExplicitVariableModeForCollection').mockImplementation(
        (collection, modeId) => {
          expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'Regular' })
          expect(fixture.loadFontAsync).toHaveBeenCalledWith({
            family: 'Roboto',
            style: 'SemiBold'
          })
          setMode(collection, modeId)
        }
      )
      fixture.loadFontAsync.mockClear()
      if (key === 'page') {
        await applyCanvasFromTool({
          mode: 'update',
          page: { id: fixture.page.id, variableModes: { typography: 'alt' } }
        })
      } else {
        await applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          native: { [key]: { variableModes: { typography: 'alt' } } }
        })
      }
      if (key === 'root') {
        const label = fixture.getNode(created.nodeIdsByKey.label!)
        await applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          native: { label: { variableModes: { typography: 'base' } } }
        })
        const clearMode = vi
          .mocked(label.clearExplicitVariableModeForCollection)
          .getMockImplementation()!
        vi.spyOn(label, 'clearExplicitVariableModeForCollection').mockImplementation(
          (collection) => {
            expect(fixture.loadFontAsync).toHaveBeenCalledWith({
              family: 'Roboto',
              style: 'Regular'
            })
            expect(fixture.loadFontAsync).toHaveBeenCalledWith({
              family: 'Roboto',
              style: 'SemiBold'
            })
            clearMode(collection)
          }
        )
        fixture.loadFontAsync.mockClear()
        await applyCanvasFromTool({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          native: { label: { variableModes: { typography: null } } }
        })
      }
    }
  )

  it.each([
    'extension',
    'page-auto',
    'native-auto',
    'mixed-runs',
    'descendant-override',
    'unavailable-explicit'
  ])('preloads mode font candidates without guessing native selection: %s', async (scenario) => {
    const fixture = createFixture()
    fixture.listAvailableFontsAsync.mockResolvedValue([
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Roboto', style: 'Regular' } },
      { fontName: { family: 'Roboto', style: 'SemiBold' } },
      { fontName: { family: 'Noto Serif', style: 'Regular' } },
      { fontName: { family: 'Noto Serif', style: 'Bold' } }
    ])
    const created = await applyCanvasFromTool({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-fit h-fit">Label</span></div>',
      styles: {
        body: { type: 'TEXT', name: 'Body', fontName: { family: 'Inter', style: 'Regular' } }
      },
      native: { label: { styles: { text: { styleKey: 'body' } } } }
    })
    const root = fixture.getNode(created.rootNodeId!)
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const style = fixture.styles.get(label.textStyleId as string) as TextStyle
    const collection = figma.variables.createVariableCollection('Type')
    const base = collection.defaultModeId
    const alt = collection.addMode('Alt')
    const missing = collection.addMode('Missing')
    const family = figma.variables.createVariable('Family', collection, 'STRING')
    family.setValueForMode(base, 'Inter')
    family.setValueForMode(alt, 'Roboto')
    family.setValueForMode(missing, 'Unavailable Font')
    const weight = figma.variables.createVariable('Weight', collection, 'FLOAT')
    weight.setValueForMode(base, 400)
    weight.setValueForMode(alt, 600)
    weight.setValueForMode(missing, 400)
    style.setBoundVariable('fontFamily', family)
    style.setBoundVariable('fontWeight', weight)
    let targetCollection: VariableCollection = collection
    let targetMode: string | null = alt
    if (scenario === 'extension') {
      const extended = collection.extend('Extended')
      targetCollection = extended as unknown as VariableCollection
      targetMode = extended.modes.find((mode) => mode.parentModeId === alt)!.modeId
      family.setValueForMode(alt, 'Inter')
      family.setValueForMode(targetMode, 'Roboto')
    }
    if (scenario === 'native-auto') {
      const other = figma.variables.createVariableCollection('Unrelated')
      targetCollection = other
      targetMode = other.defaultModeId
      Object.defineProperty(label, 'resolvedVariableModes', {
        configurable: true,
        value: { [collection.id]: alt }
      })
    }
    if (scenario === 'mixed-runs') {
      const alternateFamily = figma.variables.createVariable('Other family', collection, 'STRING')
      alternateFamily.setValueForMode(base, 'Inter')
      alternateFamily.setValueForMode(alt, 'Noto Serif')
      label.setRangeBoundVariable(0, 2, 'fontFamily', alternateFamily)
      label.setRangeFontName(2, 5, { family: 'Inter', style: 'Regular' })
    }
    if (scenario === 'descendant-override')
      label.setExplicitVariableModeForCollection(collection, base)
    if (scenario === 'unavailable-explicit') targetMode = missing
    const pageAuto = scenario === 'page-auto'
    if (pageAuto) {
      fixture.page.setExplicitVariableModeForCollection(collection, base)
      targetMode = null
    }
    fixture.loadFontAsync.mockClear()
    const target = pageAuto ? fixture.page : root
    const setter = pageAuto
      ? 'clearExplicitVariableModeForCollection'
      : 'setExplicitVariableModeForCollection'
    const spy = vi.spyOn(target, setter).mockImplementation((changed, mode) => {
      const expected = scenario === 'descendant-override' ? 'Inter' : 'Roboto'
      expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: expected, style: 'Regular' })
      if (expected === 'Roboto')
        expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'SemiBold' })
      if (scenario === 'mixed-runs')
        expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Noto Serif', style: 'Bold' })
      if (scenario === 'descendant-override')
        expect(fixture.loadFontAsync).not.toHaveBeenCalledWith(
          expect.objectContaining({ family: 'Roboto' })
        )
      if (pageAuto) delete target.explicitVariableModes[changed.id]
      else target.explicitVariableModes[changed.id] = mode!
    })
    const modes = { [targetCollection.id]: targetMode }
    const result = pageAuto
      ? applyCanvasFromTool({ mode: 'update', page: { id: fixture.page.id, variableModes: modes } })
      : applyCanvasFromTool({
          mode: 'update',
          targetNodeId: root.id,
          native: { root: { variableModes: modes } }
        })
    if (scenario === 'unavailable-explicit') {
      await expect(result).rejects.toThrow('Unavailable Font')
      expect(spy).not.toHaveBeenCalled()
    } else {
      await result
      expect(spy).toHaveBeenCalledOnce()
    }
    if (scenario === 'extension')
      expect(family.valuesByModeForCollectionAsync).toHaveBeenCalledWith(targetCollection)
  })
})
