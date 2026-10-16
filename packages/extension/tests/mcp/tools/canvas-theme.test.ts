import type { CanvasResolvedApplyParameters, CanvasVariableValue } from '@tempad-dev/shared'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseCanvasMarkup } from '@/mcp/tools/canvas/markup'
import { prepareCanvasTheme } from '@/mcp/tools/canvas/theme'
import { registerDesignSystemCatalog } from '@/mcp/tools/design-system-catalog'

afterEach(() => vi.unstubAllGlobals())

function input(
  classes: string,
  value: CanvasVariableValue = 16,
  text = false
): CanvasResolvedApplyParameters {
  return {
    mode: text ? 'update' : 'create',
    ...(text ? { targetNodeId: 'text:existing' } : {}),
    markup: text
      ? `<span data-key="root" class="w-[300px] h-[50px] ${classes}">中文 text</span>`
      : `<div data-key="root" class="flex flex-col w-[300px] h-[200px] ${classes}"></div>`,
    theme: { variables: { '--token': { variableKey: 'token' } } },
    variableCollections: {
      system: {
        name: 'System',
        modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
        variables: {
          token: {
            name: 'Token',
            type:
              typeof value === 'number' ? 'FLOAT' : typeof value === 'string' ? 'STRING' : 'COLOR',
            values: { light: value, dark: value }
          }
        }
      }
    }
  }
}

describe('Canvas theme compilation', () => {
  it.each(['gap-[8px]', 'gap-(--child)'])(
    'keeps a nested diagnostic tied to its own %s class',
    (childClass) => {
      const spec = input('gap-(--token)', 8)
      spec.theme = {
        variables: {
          '--token': { variableKey: 'token' },
          '--child': { variableKey: 'token' }
        }
      }
      spec.markup = `<div data-key="root" class="flex flex-col size-80 gap-(--token)"><div data-key="child" class="size-10 ${childClass}"/></div>`
      expect(() => parseCanvasMarkup(spec)).toThrow(
        `Layout class "${childClass}" requires flex or grid on "child".`
      )
    }
  )

  it('preserves original CSS-variable classes in diagnostics', () => {
    expect(() => parseCanvasMarkup(input('text-(--token)', { r: 1, g: 0, b: 0, a: 1 }))).toThrow(
      'Class "text-(--token)" is not supported on div'
    )
  })

  it('serializes tiny numeric fallbacks without exponent notation', () => {
    expect(parseCanvasMarkup(input('opacity-(--token)', 1e-7)).root.appearance?.opacity).toBe(
      1e-7 / 100
    )
  })

  it.each([
    [0, 0],
    [0.5, 0.005],
    [50, 0.5],
    [100, 1]
  ])('converts opacity variable %s percent to literal %s', (percent, opacity) => {
    const spec = input('opacity-(--token) gap-(--token)', percent)
    const parsed = parseCanvasMarkup(spec)
    expect(parsed.root.appearance?.opacity).toBe(opacity)
    expect(parsed.root.layout).toMatchObject({ gap: percent })
    expect(parsed.root.variables).toMatchObject({
      opacity: { variableKey: 'token' },
      gap: { variableKey: 'token' }
    })
    expect(spec.variableCollections!.system!.variables!.token!.values).toEqual({
      light: percent,
      dark: percent
    })
  })

  it.each([-1, 101])(
    'rejects out-of-range opacity variable %s using its original class',
    (value) => {
      expect(() => parseCanvasMarkup(input('opacity-(--token)', value))).toThrow(
        'opacity-(--token)'
      )
    }
  )

  it('normalizes opacity aliases without changing their binding or values', () => {
    const spec = input('opacity-(--alias)', 50)
    spec.variableCollections!.system!.variables!.alias = {
      name: 'Alias',
      type: 'FLOAT',
      values: { light: { variable: { variableKey: 'token' } }, dark: 100 }
    }
    spec.theme!.variables!['--alias'] = { variableKey: 'alias' }
    const parsed = parseCanvasMarkup(spec)
    expect(parsed.root.appearance?.opacity).toBe(0.5)
    expect(parsed.root.variables?.opacity).toEqual({ variableKey: 'alias' })
  })

  it('uses an existing keyed collection default instead of declaration order', async () => {
    const collection = {
      id: 'collection:existing',
      defaultModeId: 'mode:dark',
      modes: [{ modeId: 'mode:light' }, { modeId: 'mode:dark' }],
      getSharedPluginData: (_namespace: string, key: string) =>
        key === 'variable-collection-key'
          ? 'system'
          : JSON.stringify({ light: 'mode:light', dark: 'mode:dark' })
    }
    vi.stubGlobal('figma', {
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([collection]),
        getVariableCollectionByIdAsync: vi.fn().mockResolvedValue(null),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([])
      }
    })
    const spec = input('gap-(--token) opacity-(--token)')
    spec.variableCollections!.system!.variables!.token!.values = { light: 16, dark: 32 }
    const prepared = await prepareCanvasTheme(spec)
    const parsed = parseCanvasMarkup(spec, undefined, undefined, prepared)
    expect(parsed.root.layout).toMatchObject({
      gap: 32
    })
    expect(parsed.root.appearance?.opacity).toBe(0.32)
  })

  it('converts catalog opacity values only at the bound field', () => {
    const catalog = registerDesignSystemCatalog([
      {
        kind: 'variable',
        ref: 'v1',
        name: 'Alpha',
        reference: { id: 'variable:alpha' },
        resolvedType: 'FLOAT',
        defaultValue: 50,
        definition: {}
      }
    ])
    const parsed = parseCanvasMarkup(
      {
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-80 h-80 opacity-(--alpha) gap-(--alpha)"/>'
      },
      catalog
    )
    expect(parsed.root.appearance?.opacity).toBe(0.5)
    expect(parsed.root.layout).toMatchObject({ gap: 50 })
    expect(parsed.root.variables).toMatchObject({
      opacity: { id: 'variable:alpha' },
      gap: { id: 'variable:alpha' }
    })
    expect(catalog.entries.get('v1')).toMatchObject({ defaultValue: 50 })
  })
  it('binds new local variables without literal duplication in the markup', () => {
    const parsed = parseCanvasMarkup(input('gap-(--token) p-[var(--token)] rounded-(--token)'))
    expect(parsed.root.layout).toMatchObject({
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 }
    })
    expect(parsed.root.variables).toEqual({
      gap: { variableKey: 'token' },
      paddingTop: { variableKey: 'token' },
      paddingRight: { variableKey: 'token' },
      paddingBottom: { variableKey: 'token' },
      paddingLeft: { variableKey: 'token' },
      cornerRadius: { variableKey: 'token' }
    })
  })

  it('distinguishes color, type size, font family, and font weight', () => {
    expect(
      parseCanvasMarkup(input('bg-(--token)', { r: 1, g: 0.5, b: 0, a: 0.5 })).root.appearance?.fill
    ).toBe('#ff800080')
    expect(
      parseCanvasMarkup(
        input('text-(length:--token) leading-(--token) tracking-(--token)', 18, true)
      ).root.text
    ).toMatchObject({
      fontSize: 18,
      lineHeight: { unit: 'PIXELS', value: 18 },
      letterSpacing: { unit: 'PIXELS', value: 18 }
    })
    expect(
      parseCanvasMarkup(input('font-(family-name:--token)', 'Noto Sans SC', true)).root.text
    ).toMatchObject({ fontFamily: 'Noto Sans SC', fontStyleMatching: true })
    expect(
      parseCanvasMarkup(input('font-(--token)', 600, true)).root.variables?.fontWeight
    ).toEqual({ variableKey: 'token' })
  })

  it('resolves same-call variable aliases and rejects cycles', () => {
    const spec = input('gap-(--token)')
    spec.variableCollections!.system!.variables!.alias = {
      name: 'Alias',
      type: 'FLOAT',
      values: { light: { variable: { variableKey: 'token' } }, dark: 20 }
    }
    spec.theme!.variables!['--alias'] = { variableKey: 'alias' }
    spec.markup = spec.markup!.replace('--token', '--alias')
    expect(parseCanvasMarkup(spec).root.layout).toMatchObject({ gap: 16 })
    spec.variableCollections!.system!.variables!.token!.values!.light = {
      variable: { variableKey: 'alias' }
    }
    expect(() => parseCanvasMarkup(spec)).toThrow('cycle')
  })

  it('maps axis gaps according to native layout direction and wrapping', () => {
    const spec = input('gap-x-(--token) gap-y-(--token)')
    spec.markup = spec.markup!.replace('flex flex-col', 'grid grid-cols-2')
    expect(parseCanvasMarkup(spec).root.variables).toEqual({
      gridColumnGap: { variableKey: 'token' },
      gridRowGap: { variableKey: 'token' }
    })
    spec.markup = spec.markup!.replace('grid grid-cols-2', 'flex flex-row flex-wrap')
    expect(parseCanvasMarkup(spec).root.variables).toEqual({
      gap: { variableKey: 'token' },
      counterAxisSpacing: { variableKey: 'token' }
    })
  })

  it.each([
    ['gap-(--missing)', 16, 'Unknown CSS variable'],
    ['text-(--token)', 16, 'COLOR'],
    ['gap-(--token)', 'Sixteen', 'FLOAT'],
    ['font-(family-name:--token)', 16, 'STRING'],
    ['gap-(--token) gap-4', 16, 'conflicts'],
    ['gap-(--token) gap-[var(--token)]', 16, 'conflicts'],
    ['left-(--token)', 16, 'Unsupported variable utility'],
    ['bg-(length:--token)', 16, 'color type hint']
  ])('rejects invalid or contradictory variable classes: %s', (classes, value, message) => {
    expect(() => parseCanvasMarkup(input(classes, value))).toThrow(message)
  })

  it('rejects a class that competes with an explicit native binding', () => {
    const spec = input('gap-(--token)')
    spec.bindings = { root: { variables: { gap: null } } }
    expect(() => parseCanvasMarkup(spec)).toThrow('another binding')
  })

  it('binds an entire TextStyle by class and preserves independent text color', () => {
    const spec = input('type-body text-[#123456]', 16, true)
    spec.theme!.textStyles = { 'type-body': { styleKey: 'body' } }
    spec.styles = {
      body: {
        type: 'TEXT',
        name: 'Body',
        fontName: { family: 'Noto Sans SC', style: 'Regular' },
        fontSize: 16
      }
    }
    const parsed = parseCanvasMarkup(spec)
    expect(parsed.root.styles?.text).toEqual({ styleKey: 'body' })
    expect(parsed.root.appearance?.fill).toBe('#123456')
    spec.markup = spec.markup!.replace('type-body', 'type-body font-bold')
    expect(() => parseCanvasMarkup(spec)).toThrow('owns typography')
  })

  it('uses authoritative catalog aliases and disambiguates duplicate names', () => {
    const catalog = registerDesignSystemCatalog([
      {
        kind: 'variable',
        ref: 'v1',
        name: 'Surface',
        reference: { id: 'variable:1' },
        resolvedType: 'COLOR',
        defaultValue: { r: 1, g: 1, b: 1 },
        definition: { codeSyntax: { WEB: 'var(--surface)' } }
      },
      {
        kind: 'variable',
        ref: 'v2',
        name: 'Surface',
        reference: { id: 'variable:2' },
        resolvedType: 'COLOR',
        defaultValue: { r: 0, g: 0, b: 0 },
        definition: {}
      },
      {
        kind: 'style',
        ref: 's1',
        name: 'Body',
        reference: { id: 'style:1' },
        styleType: 'TEXT',
        definition: {}
      }
    ])
    expect(catalog.entries.get('v1')).toMatchObject({ cssName: '--surface' })
    expect(catalog.entries.get('v2')).toMatchObject({ cssName: '--surface-v2' })
    const parsed = parseCanvasMarkup(
      {
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[300px] h-[200px] bg-(--surface-v2)"><span data-key="label" class="w-fit h-fit type-body">Hello</span></div>'
      },
      catalog
    )
    expect(parsed.root.variables?.fill).toEqual({ id: 'variable:2' })
    expect(parsed.root.children?.[0]?.styles?.text).toEqual({ id: 'style:1' })
    expect(() =>
      parseCanvasMarkup(
        {
          mode: 'create',
          markup: '<div data-key="root" class="w-[10px] h-[10px]"/>',
          theme: { variables: { '--surface': { ref: 'v2' } } }
        },
        catalog
      )
    ).toThrow('more than one resource')
  })

  it('reads only used local identities on subsequent calls and resolves live aliases', async () => {
    const getVariables = vi.fn().mockResolvedValue([
      {
        id: 'var:alias',
        name: 'Alias',
        variableCollectionId: 'collection:1',
        getSharedPluginData: () => 'token',
        valuesByMode: { light: { type: 'VARIABLE_ALIAS', id: 'var:base' } }
      }
    ])
    const getVariableByIdAsync = vi.fn().mockResolvedValue({
      id: 'var:base',
      name: 'Base',
      variableCollectionId: 'collection:1',
      valuesByMode: { light: 28 }
    })
    vi.stubGlobal('figma', {
      variables: {
        getLocalVariablesAsync: getVariables,
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getVariableByIdAsync,
        getVariableCollectionByIdAsync: vi.fn().mockResolvedValue({ defaultModeId: 'light' })
      }
    })
    const spec = input('gap-(--token)')
    delete spec.variableCollections
    spec.theme!.variables!['--unused'] = { variableKey: 'unknown-unused-key' }
    const prepared = await prepareCanvasTheme(spec)
    expect(parseCanvasMarkup(spec, undefined, undefined, prepared).root.layout).toMatchObject({
      gap: 28
    })
    expect(getVariables).toHaveBeenCalledTimes(1)
    expect(getVariableByIdAsync).toHaveBeenCalledExactlyOnceWith('var:base')
  })

  it.each(['key', 'id'])(
    'reads a new token declaration using the existing default mode %s before creation',
    async (identity) => {
      const collection = {
        id: 'collection:existing',
        defaultModeId: 'mode:dark',
        modes: [{ modeId: 'mode:light' }, { modeId: 'mode:dark' }],
        getSharedPluginData: () => JSON.stringify({ light: 'mode:light', dark: 'mode:dark' })
      }
      const getVariableByIdAsync = vi.fn()
      vi.stubGlobal('figma', {
        variables: {
          getVariableCollectionByIdAsync: vi.fn().mockResolvedValue(collection),
          getVariableByIdAsync
        }
      })
      const spec = input('gap-(--token)')
      spec.variableCollections = {
        system: {
          id: collection.id,
          variables: {
            token: {
              name: 'New token',
              type: 'FLOAT',
              values:
                identity === 'key' ? { light: 16, dark: 0 } : { 'mode:light': 16, 'mode:dark': 0 }
            }
          }
        }
      }
      const prepared = await prepareCanvasTheme(spec)
      expect(parseCanvasMarkup(spec, undefined, undefined, prepared).root.layout).toMatchObject({
        gap: 0
      })
      expect(getVariableByIdAsync).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['EASING', { type: 'LINEAR' }],
    ['EASING', { type: 'VARIABLE_ALIAS', id: 'var:base' }],
    ['TIMING', 200]
  ] as const)('rejects native %s theme values before resolving bindings', async (type, value) => {
    vi.stubGlobal('figma', {
      variables: {
        getLocalVariablesAsync: vi.fn().mockResolvedValue([
          {
            id: 'var:motion',
            name: 'Motion',
            resolvedType: type,
            variableCollectionId: 'collection:1',
            getSharedPluginData: () => 'token',
            valuesByMode: { light: value }
          }
        ]),
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getVariableByIdAsync: vi.fn().mockResolvedValue(null),
        getVariableCollectionByIdAsync: vi.fn().mockResolvedValue({ defaultModeId: 'light' })
      }
    })
    const spec = input('gap-(--token)')
    delete spec.variableCollections
    await expect(prepareCanvasTheme(spec)).rejects.toThrow(
      `Theme variable "Motion" has unsupported type ${type}.`
    )
  })

  it.each([
    { color: { r: 1, g: 0, b: 0 }, opacity: { type: 'VARIABLE_ALIAS', id: 'var:opacity' } },
    { color: { type: 'VARIABLE_ALIAS', id: 'var:color' }, opacity: 50 },
    {
      color: { type: 'VARIABLE_ALIAS', id: 'var:color' },
      opacity: { type: 'VARIABLE_ALIAS', id: 'var:opacity' }
    }
  ] satisfies VariableComposedColor[])(
    'rejects composed theme colors before mutation: %j',
    async (value) => {
      vi.stubGlobal('figma', {
        variables: {
          getLocalVariablesAsync: vi.fn().mockResolvedValue([
            {
              id: 'var:color',
              name: 'Surface',
              resolvedType: 'COLOR',
              variableCollectionId: 'collection:1',
              getSharedPluginData: () => 'token',
              valuesByMode: { light: value }
            }
          ]),
          getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
          getVariableCollectionByIdAsync: vi.fn().mockResolvedValue({ defaultModeId: 'light' })
        },
        createFrame: vi.fn()
      })
      const spec = input('bg-(--token)')
      delete spec.variableCollections
      await expect(prepareCanvasTheme(spec)).rejects.toThrow(
        'Theme variable "Surface" has an unsupported composed-color value.'
      )
      expect(figma.createFrame).not.toHaveBeenCalled()
    }
  )

  it('accepts stable keys and catalog aliases for the same native variable and text style', () => {
    const catalog = registerDesignSystemCatalog([
      {
        kind: 'variable',
        ref: 'v1',
        name: 'Surface',
        reference: { id: 'var:surface', key: 'surface-key' },
        resolvedType: 'COLOR',
        defaultValue: { r: 1, g: 1, b: 1 },
        definition: { authoringKey: 'product/surface' }
      },
      {
        kind: 'style',
        ref: 's1',
        name: 'Body',
        reference: { id: 'style:body', key: 'body-key' },
        styleType: 'TEXT',
        definition: { authoringKey: 'product/body' }
      }
    ])
    const spec: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-[300px] h-[200px] bg-(--surface)"><span data-key="label" class="w-fit h-fit type-body">Hello</span></div>',
      theme: {
        variables: { '--surface': { variableKey: 'product/surface' } },
        textStyles: { 'type-body': { styleKey: 'product/body' } }
      }
    }
    const parsed = parseCanvasMarkup(spec, catalog)
    expect(parsed.root.variables?.fill).toEqual({ variableKey: 'product/surface' })
    expect(parsed.root.appearance?.fill).toBe('#ffffffff')
    expect(parsed.root.children?.[0]?.styles?.text).toEqual({ styleKey: 'product/body' })
    spec.styles = { 'product/body': { type: 'TEXT', id: 'style:different' } }
    expect(() => parseCanvasMarkup(spec, catalog)).toThrow('more than one native resource')
  })

  it('recognizes same-call adoption of catalog resources by native id', () => {
    const catalog = registerDesignSystemCatalog([
      {
        kind: 'variable',
        ref: 'v1',
        name: 'Token',
        reference: { id: 'var:token' },
        resolvedType: 'FLOAT',
        defaultValue: 24,
        definition: {}
      },
      {
        kind: 'style',
        ref: 's1',
        name: 'Body',
        reference: { id: 'style:body' },
        styleType: 'TEXT',
        definition: {}
      }
    ])
    const spec = input('gap-(--token)')
    spec.variableCollections = {
      system: { id: 'collection:system', variables: { token: { id: 'var:token' } } }
    }
    spec.styles = { body: { id: 'style:body', type: 'TEXT' } }
    spec.theme!.textStyles = { 'type-body': { styleKey: 'body' } }
    expect(parseCanvasMarkup(spec, catalog).root.layout).toMatchObject({ gap: 24 })
  })

  it.each(['authoring-key', 'catalog-alias'] as const)(
    'validates bounds using same-call default-mode values through %s instead of stale catalog values',
    async (source) => {
      const catalog = registerDesignSystemCatalog([
        {
          kind: 'variable',
          ref: 'v1',
          name: 'Token',
          reference: { id: 'var:token' },
          resolvedType: 'FLOAT',
          defaultValue: 24,
          definition: {}
        }
      ])
      const collection = {
        id: 'collection:system',
        defaultModeId: 'mode:dark',
        modes: [{ modeId: 'mode:light' }, { modeId: 'mode:dark' }],
        getSharedPluginData: () => JSON.stringify({ light: 'mode:light', dark: 'mode:dark' })
      }
      vi.stubGlobal('figma', {
        variables: {
          getVariableCollectionByIdAsync: vi.fn().mockResolvedValue(collection)
        }
      })
      const spec = input('min-w-(--token) max-w-[28px]')
      spec.markup =
        '<div data-key="root" class="flex flex-col w-[28px] h-[40px] min-w-(--token) max-w-[28px]"></div>'
      if (source === 'catalog-alias') spec.theme = undefined
      spec.variableCollections = {
        system: {
          id: collection.id,
          modes: { light: { name: 'Light' }, dark: { name: 'Dark' } },
          variables: { token: { id: 'var:token', values: { light: 16, dark: 32 } } }
        }
      }
      const prepared = await prepareCanvasTheme(spec, catalog)
      expect(() => parseCanvasMarkup(spec, catalog, undefined, prepared)).toThrow(
        'cannot exceed max-width'
      )
    }
  )

  it.each(['native', 'inline'])(
    'allows %s typography unlinks when applying a text-style class',
    (source) => {
      const spec = input('type-body', 16, true)
      spec.theme!.textStyles = { 'type-body': { styleKey: 'body' } }
      if (source === 'native')
        spec.bindings = { root: { variables: { fontSize: null, fontFamily: null } } }
      else
        spec.markup = spec.markup!.replace(
          'data-key="root"',
          'data-key="root" data-var-font-size="none" data-var-font-family="none"'
        )
      const parsed = parseCanvasMarkup(spec)
      expect(parsed.root.styles?.text).toEqual({ styleKey: 'body' })
      expect(parsed.root.variables).toMatchObject({ fontSize: null, fontFamily: null })
      spec.bindings = { root: { variables: { fontSize: { variableKey: 'token' } } } }
      expect(() => parseCanvasMarkup(spec)).toThrow('conflicts with native typography')
    }
  )
})
