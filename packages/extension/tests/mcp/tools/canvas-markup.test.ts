import type {
  CanvasResolvedApplyParameters,
  CanvasBinding,
  CanvasFigmaProperties
} from '@tempad-dev/shared'

import { describe, expect, it } from 'vitest'

import type { ParsedCanvasTreeInput } from '@/mcp/tools/canvas/model'

import { parseCanvasMarkup } from '@/mcp/tools/canvas/markup'

function parse(
  markup: string,
  overrides: Omit<Partial<CanvasResolvedApplyParameters>, 'markup'> = {}
): ParsedCanvasTreeInput {
  return parseCanvasMarkup({
    mode: 'create',
    markup,
    ...overrides
  } as CanvasResolvedApplyParameters) as ParsedCanvasTreeInput
}

const BLEND_MODE_CLASSES = [
  ['mix-blend-pass-through', 'PASS_THROUGH'],
  ['mix-blend-normal', 'NORMAL'],
  ['mix-blend-darken', 'DARKEN'],
  ['mix-blend-multiply', 'MULTIPLY'],
  ['mix-blend-plus-darker', 'LINEAR_BURN'],
  ['mix-blend-color-burn', 'COLOR_BURN'],
  ['mix-blend-lighten', 'LIGHTEN'],
  ['mix-blend-screen', 'SCREEN'],
  ['mix-blend-plus-lighter', 'LINEAR_DODGE'],
  ['mix-blend-color-dodge', 'COLOR_DODGE'],
  ['mix-blend-overlay', 'OVERLAY'],
  ['mix-blend-soft-light', 'SOFT_LIGHT'],
  ['mix-blend-hard-light', 'HARD_LIGHT'],
  ['mix-blend-difference', 'DIFFERENCE'],
  ['mix-blend-exclusion', 'EXCLUSION'],
  ['mix-blend-hue', 'HUE'],
  ['mix-blend-saturation', 'SATURATION'],
  ['mix-blend-color', 'COLOR'],
  ['mix-blend-luminosity', 'LUMINOSITY']
] as const satisfies ReadonlyArray<readonly [string, BlendMode]>

describe('canvas markup', () => {
  it('normalizes supported layout, appearance, and text classes', () => {
    const result = parse(`
      <div
        data-key="card"
        class="flex flex-col w-[320px] h-[200px] gap-[12px] p-[16px] items-center justify-between bg-[#FFFFFF] border border-[#D0D0D0] rounded-[12px] opacity-[0.9]"
      >
        <span
          data-key="title"
          class="w-full h-fit font-sans font-semibold text-[18px] leading-[24px] tracking-[0.5px] text-center text-[#202020]"
        >
          Settings &amp; profile
        </span>
      </div>
    `)

    expect(result.root).toMatchObject({
      key: 'card',
      type: 'FRAME',
      size: {
        width: 320,
        height: 200,
        horizontal: 'FIXED',
        vertical: 'FIXED'
      },
      grow: false,
      layout: {
        mode: 'VERTICAL',
        gap: 12,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        primaryAlign: 'SPACE_BETWEEN',
        counterAlign: 'CENTER',
        strokesIncluded: true
      },
      appearance: {
        fill: '#FFFFFF',
        stroke: '#D0D0D0',
        strokeWeight: 1,
        cornerRadius: 12,
        opacity: 0.9
      }
    })
    expect(result.root.children?.[0]).toMatchObject({
      key: 'title',
      type: 'TEXT',
      size: { horizontal: 'FILL', vertical: 'HUG' },
      appearance: { fill: '#202020', opacity: 1 },
      text: {
        characters: 'Settings & profile',
        fontFamily: 'Inter',
        fontStyle: 'Semi Bold',
        fontSize: 18,
        lineHeight: { unit: 'PIXELS', value: 24 },
        letterSpacing: { unit: 'PIXELS', value: 0.5 },
        alignHorizontal: 'CENTER',
        autoResize: 'HEIGHT'
      }
    })
  })

  it('normalizes native Tailwind scales when they map exactly to Figma', () => {
    const result = parse(`
      <div
        data-key="card"
        class="flex flex-col w-sm h-48 gap-3.5 px-6 py-4 bg-white border-2 border-black rounded-2xl opacity-90"
      >
        <span
          data-key="title"
          class="w-full h-fit font-extrabold text-lg/7 tracking-wide text-black"
        >Native utilities</span>
      </div>
    `)

    expect(result.root).toMatchObject({
      size: { width: 384, height: 192 },
      layout: {
        gap: 14,
        padding: { top: 16, right: 24, bottom: 16, left: 24 }
      },
      appearance: {
        fill: '#FFFFFF',
        stroke: '#000000',
        strokeWeight: 2,
        cornerRadius: 16,
        opacity: 0.9
      }
    })
    expect(result.root.children?.[0]).toMatchObject({
      text: {
        fontStyle: 'Extra Bold',
        fontSize: 18,
        lineHeight: { unit: 'PIXELS', value: 28 },
        letterSpacing: { unit: 'PERCENT', value: 2.5 }
      },
      appearance: { fill: '#000000' }
    })
  })

  it('normalizes native size, position, border-side, radius, and text defaults', () => {
    const result = parse(`
      <div data-key="root" class="w-xs h-64 border-x-2 border-t border-white rounded-t-xl rounded-br-none">
        <div data-key="badge" class="absolute -left-2 top-px size-6"></div>
        <span data-key="copy" class="absolute left-4 top-12 w-40 h-fit text-sm leading-tight tracking-[0.05em]">Copy</span>
      </div>
    `)

    expect(result.root).toMatchObject({
      size: { width: 320, height: 256 },
      appearance: {
        stroke: '#FFFFFF',
        strokeTopWeight: 1,
        strokeRightWeight: 2,
        strokeBottomWeight: 0,
        strokeLeftWeight: 2,
        topLeftRadius: 12,
        topRightRadius: 12,
        bottomRightRadius: 0,
        bottomLeftRadius: 0
      }
    })
    expect(result.root.children?.[0]).toMatchObject({
      size: { width: 24, height: 24 },
      position: { x: -8, y: 1 }
    })
    expect(result.root.children?.[1]).toMatchObject({
      size: { width: 160 },
      text: {
        fontSize: 14,
        lineHeight: { unit: 'PERCENT', value: 125 },
        letterSpacing: { unit: 'PERCENT', value: 5 }
      }
    })

    const defaultLeading = parse(
      '<div data-key="default" class="flex flex-col w-40 h-20"><span data-key="copy" class="w-fit h-fit text-sm">Copy</span></div>'
    )
    expect(defaultLeading.root.children?.[0]?.text).toMatchObject({
      fontSize: 14,
      lineHeight: { unit: 'PIXELS', value: 20 }
    })
  })

  it('supports size-full where both fill axes are valid', () => {
    const result = parse(
      '<div data-key="root" class="grid grid-cols-1 grid-rows-1 w-[100px] h-[100px]"><div data-key="child" class="size-full"></div></div>'
    )

    expect(result.root.children?.[0]?.size).toMatchObject({
      horizontal: 'FILL',
      vertical: 'FILL'
    })
  })

  it('preserves supported CSS hex forms for native solid paints', () => {
    const result = parse(`
      <div data-key="root" class="flex flex-col w-20 h-20 bg-[#fff] border border-[#ABCDEF80]">
        <span data-key="copy" class="w-fit h-fit text-[#0008]">Copy</span>
      </div>
    `)

    expect(result.root.appearance).toMatchObject({ fill: '#fff', stroke: '#ABCDEF80' })
    expect(result.root.children?.[0]?.appearance).toMatchObject({ fill: '#0008' })
  })

  it('decodes numeric entities and rejects malformed or inherited names', () => {
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">&#65;&#x42;</span></div>'
    )
    expect(result.root.children?.[0]?.text?.characters).toBe('AB')

    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">&#65A;</span></div>'
      )
    ).toThrow('Unsupported HTML entity "&#65A;".')
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">&__proto__;</span></div>'
      )
    ).toThrow('Unsupported HTML entity "&__proto__;".')
  })

  it('preserves ampersands that do not start an entity', () => {
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-fit h-fit">Artists & labels · R&B</span></div>'
    )

    expect(result.root.children?.[0]?.text?.characters).toBe('Artists & labels · R&B')
  })

  it('keeps Figma component, variable, and style identities outside markup syntax', () => {
    const result = parse(
      `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px] bg-[#FFFFFF]">
          <div data-key="button" class="w-full h-fit opacity-[0.8]"></div>
        </div>
      `,
      {
        bindings: {
          root: {
            variables: {
              fill: { key: 'surface-key' },
              gap: { id: 'VariableID:spacing' }
            },
            styles: {
              effect: { key: 'raised-style-key' },
              grid: { id: 'StyleID:grid' }
            }
          },
          button: {
            component: { key: 'button-key' },
            componentProperties: { Label: 'Save', Disabled: false }
          }
        }
      }
    )

    expect(result.root.variables).toEqual({
      fill: { key: 'surface-key' },
      gap: { id: 'VariableID:spacing' }
    })
    expect(result.root.styles).toEqual({
      effect: { key: 'raised-style-key' },
      grid: { id: 'StyleID:grid' }
    })
    expect(result.root.children?.[0]).toMatchObject({
      type: 'INSTANCE',
      component: { key: 'button-key' },
      componentProperties: { Label: 'Save', Disabled: false },
      appearance: { opacity: 0.8 }
    })
  })

  it('treats prototype-like stable keys as ordinary binding keys', () => {
    const bindings = Object.create(null) as Record<string, CanvasBinding>
    bindings.__proto__ = { figma: { name: 'Prototype layer' } }

    const result = parse('<div data-key="__proto__" class="w-[100px] h-[100px]"></div>', {
      bindings
    })

    expect(result.root).toMatchObject({
      key: '__proto__',
      displayName: 'Prototype layer'
    })
  })

  it('trims native node ids and omits update defaults', () => {
    const result = parse(
      '<div data-key="root" data-node-id=" 1:2 " class="flex flex-col w-[100px] h-[100px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
      { mode: 'update', targetNodeId: '1:2' }
    )
    const copy = result.root.children?.[0]

    expect(result.root.nodeId).toBe('1:2')
    expect(result.root).not.toHaveProperty('displayName')
    expect(result.root).not.toHaveProperty('grow')
    expect(result.root.appearance).not.toHaveProperty('opacity')
    expect(copy).not.toHaveProperty('displayName')
    expect(copy?.appearance).not.toHaveProperty('opacity')
    expect(copy?.text).not.toHaveProperty('alignVertical')
    expect(copy?.text).not.toHaveProperty('fontSize')
    expect(copy?.text).not.toHaveProperty('alignHorizontal')
  })

  it('supports explicit inline binding removal and rejects unknown binding attributes', () => {
    const result = parse(
      '<div data-key="root" data-var-opacity="none" data-style-fill="none" class="w-[100px] h-[100px]"></div>'
    )

    expect(result.root).toMatchObject({
      variables: { opacity: null },
      styles: { fill: null }
    })
    expect(() =>
      parse('<div data-key="root" data-var-unknown="none" class="w-[100px] h-[100px]"></div>')
    ).toThrow('Unsupported attribute "data-var-unknown"')
  })

  it('supports explicit update identities and preserves stable keys', () => {
    const result = parse(
      `
        <div data-key="root" data-node-id="1:2" class="flex flex-row w-[400px] h-[200px]">
          <span data-key="copy" data-node-id="1:3" class="grow w-fit h-fit">Copy</span>
        </div>
      `,
      { mode: 'update', targetNodeId: '1:2' }
    )

    expect(result.root.nodeId).toBe('1:2')
    expect(result.root.children?.[0]).toMatchObject({
      key: 'copy',
      nodeId: '1:3',
      grow: true,
      size: { horizontal: 'FILL', vertical: 'HUG' },
      text: { autoResize: 'HEIGHT' }
    })
  })

  it('allows a supported non-frame root only for update', () => {
    const markup = '<div data-key="button" class="w-[120px] h-[40px]"></div>'
    const bindings = {
      button: {
        component: { id: 'component:1' },
        figma: { instance: { scaleFactor: 1.25 } }
      }
    } satisfies Record<string, CanvasBinding>

    expect(
      parse(markup, { mode: 'update', targetNodeId: 'instance:1', bindings }).root
    ).toMatchObject({
      type: 'INSTANCE',
      component: { id: 'component:1' },
      figma: { instance: { scaleFactor: 1.25 } }
    })
    expect(() => parse(markup, { bindings })).toThrow(
      /Create mode requires a frame, section, group, boolean-operation, component, or component-set canvas root/
    )
  })

  it('normalizes wrapping, bounded sizing, clipping, and absolute auto-layout children', () => {
    const result = parse(`
      <div
        data-key="root"
        class="flex flex-row flex-wrap content-between box-border overflow-hidden w-[400px] h-[240px] gap-x-[12px] gap-y-[20px]"
      >
        <span data-key="one" class="grow w-fit h-fit min-w-[80px] max-w-[160px]">One</span>
        <span data-key="two" class="grow w-fit h-fit">Two</span>
        <div
          data-key="badge"
          class="absolute left-[-4px] top-[8px] w-[24px] h-[24px]"
        ></div>
      </div>
    `)

    expect(result.root).toMatchObject({
      layout: {
        mode: 'HORIZONTAL',
        gap: 12,
        counterGap: 20,
        wrap: 'WRAP',
        counterAlignContent: 'SPACE_BETWEEN',
        strokesIncluded: true
      },
      appearance: { clipsContent: true }
    })
    expect(result.root.children?.[0]).toMatchObject({
      grow: true,
      size: {
        minWidth: 80,
        maxWidth: 160,
        horizontal: 'FILL'
      }
    })
    expect(result.root.children?.[1]).toMatchObject({
      grow: true,
      size: { horizontal: 'FILL' }
    })
    expect(result.root.children?.[2]).toMatchObject({
      position: { x: -4, y: 8 }
    })
  })

  it('normalizes explicitly positioned children in a freeform frame', () => {
    const relativeTransform: Transform = [
      [1, 0.6, 24],
      [0, 0.8, -12]
    ]
    const result = parse(
      `
        <div data-key="root" class="w-[400px] h-[240px]">
          <div data-key="offset" class="absolute left-[-4px] top-[8px] w-[24px] h-[24px]"></div>
          <div data-key="transformed" class="w-[80px] h-[48px]"></div>
        </div>
      `,
      {
        bindings: {
          transformed: { figma: { relativeTransform } }
        }
      }
    )

    expect(result.root.layout).toEqual({ mode: 'NONE' })
    expect(result.root.children?.[0]?.position).toEqual({ x: -4, y: 8 })
    expect(result.root.children?.[1]?.figma?.relativeTransform).toEqual(relativeTransform)
  })

  it('normalizes native sections and nested freeform content', () => {
    const result = parse(
      `
        <div data-key="review" class="w-[1200px] h-[900px] bg-[#F5F5F5] border-[2px] border-[#CCCCCC] rounded-[24px]">
          <div data-key="screen" class="absolute left-[80px] top-[120px] w-[320px] h-[240px]"></div>
          <div data-key="variants" class="absolute left-[480px] top-[80px] w-[600px] h-[700px]">
            <div data-key="variant" class="absolute left-[40px] top-[80px] w-[320px] h-[240px]"></div>
          </div>
        </div>
      `,
      {
        bindings: {
          review: { figma: { section: { contentsHidden: true } } },
          variants: { figma: { section: {} } }
        }
      }
    )

    expect(result.root).toMatchObject({
      type: 'SECTION',
      size: { width: 1200, height: 900 },
      appearance: {
        fill: '#F5F5F5',
        stroke: '#CCCCCC',
        strokeWeight: 2,
        cornerRadius: 24
      },
      figma: { section: { contentsHidden: true } }
    })
    expect(result.root.children?.[1]).toMatchObject({
      type: 'SECTION',
      position: { x: 480, y: 80 },
      figma: { section: {} }
    })
    expect(result.root.children?.[1]?.children?.[0]?.position).toEqual({ x: 40, y: 80 })
  })

  it.each([
    [
      'inside a frame',
      '<div data-key="root" class="w-[320px] h-[200px]"><div data-key="section" class="absolute left-[0px] top-[0px] w-[100px] h-[100px]"></div></div>',
      { section: { figma: { section: {} } } },
      /only be a canvas root or a direct child of a section/
    ],
    [
      'with Auto Layout',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"></div>',
      { root: { figma: { section: {} } } },
      /Layout class "flex"/
    ],
    [
      'with non-fixed sizing',
      '<div data-key="root" class="w-fit h-[200px]"></div>',
      { root: { figma: { section: {} } } },
      /requires fixed width and height/
    ],
    [
      'with opacity',
      '<div data-key="root" class="w-[320px] h-[200px] opacity-[0.5]"></div>',
      { root: { figma: { section: {} } } },
      /Opacity and blend modes/
    ],
    [
      'with rotation',
      '<div data-key="root" class="w-[320px] h-[200px] rotate-[15deg]"></div>',
      { root: { figma: { section: {} } } },
      /Rotation classes/
    ],
    [
      'with effects',
      '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      {
        root: {
          figma: {
            section: {},
            effects: [{ type: 'LAYER_BLUR', radius: 4 }]
          }
        }
      },
      /Direct effects are not supported/
    ],
    [
      'with a mask',
      '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      { root: { figma: { section: {}, mask: { type: 'ALPHA' } } } },
      /Masks are not supported/
    ],
    [
      'with a stroke cap',
      '<div data-key="root" class="w-[320px] h-[200px] border border-[#000000]"></div>',
      { root: { figma: { section: {}, stroke: { cap: 'ROUND' } } } },
      /Stroke caps and miter limits/
    ]
  ])('rejects a section %s', (_case, markup, bindings, error) => {
    expect(() =>
      parse(markup, {
        bindings: bindings as CanvasResolvedApplyParameters['bindings']
      })
    ).toThrow(error)
  })

  it('normalizes intrinsic groups and non-destructive boolean operations', () => {
    const result = parse(
      `
        <div data-key="icon" class="w-fit h-fit opacity-[0.8] mix-blend-multiply">
          <div data-key="cutout" class="absolute left-[0px] top-[0px] w-fit h-fit bg-[#112233] border-[2px] border-[#445566] rounded-[8px]">
            <div data-key="base" class="absolute left-[0px] top-[0px] w-[120px] h-[120px]"></div>
            <div data-key="hole" class="absolute left-[40px] top-[24px] w-[64px] h-[72px]"></div>
          </div>
          <span data-key="label" class="absolute left-[144px] top-[48px] w-[80px] h-fit">Icon</span>
        </div>
      `,
      {
        bindings: {
          icon: {
            figma: {
              group: true,
              effects: [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 2 }]
            }
          },
          cutout: {
            figma: {
              booleanOperation: 'SUBTRACT',
              name: 'Cutout'
            }
          },
          base: { figma: { shape: { type: 'RECTANGLE' } } },
          hole: { figma: { shape: { type: 'ELLIPSE' } } }
        }
      }
    )

    expect(result.root).toMatchObject({
      type: 'GROUP',
      size: { horizontal: 'HUG', vertical: 'HUG' },
      layout: { mode: 'NONE' },
      blendMode: 'MULTIPLY',
      appearance: { opacity: 0.8 },
      figma: {
        group: true,
        effects: [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 2 }]
      }
    })
    expect(result.root.children?.[0]).toMatchObject({
      type: 'BOOLEAN_OPERATION',
      displayName: 'Cutout',
      position: { x: 0, y: 0 },
      size: { horizontal: 'HUG', vertical: 'HUG' },
      appearance: {
        fill: '#112233',
        stroke: '#445566',
        strokeWeight: 2,
        cornerRadius: 8
      },
      figma: { booleanOperation: 'SUBTRACT' }
    })
    expect(result.root.children?.[0]?.children?.map(({ type }) => type)).toEqual([
      'RECTANGLE',
      'ELLIPSE'
    ])
  })

  it.each([
    [
      'a fixed-size group',
      '<div data-key="root" class="w-[100px] h-[100px]"><div data-key="child" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div></div>',
      { root: { figma: { group: true } } },
      /requires intrinsic w-fit and h-fit/
    ],
    [
      'an empty group',
      '<div data-key="root" class="w-fit h-fit"></div>',
      { root: { figma: { group: true } } },
      /requires at least one child/
    ],
    [
      'group fill appearance',
      '<div data-key="root" class="w-fit h-fit bg-[#FFFFFF]"><div data-key="child" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div></div>',
      { root: { figma: { group: true } } },
      /Appearance class/
    ],
    [
      'a one-child boolean operation',
      '<div data-key="root" class="w-fit h-fit"><div data-key="shape" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div></div>',
      {
        root: { figma: { booleanOperation: 'UNION' } },
        shape: { figma: { shape: { type: 'RECTANGLE' } } }
      },
      /requires at least two children/
    ],
    [
      'a frame inside a boolean operation',
      '<div data-key="root" class="w-fit h-fit"><div data-key="frame" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div><div data-key="shape" class="absolute left-[20px] top-[0px] w-[20px] h-[20px]"></div></div>',
      {
        root: { figma: { booleanOperation: 'UNION' } },
        shape: { figma: { shape: { type: 'RECTANGLE' } } }
      },
      /can contain only text, basic shapes, or nested boolean operations/
    ],
    [
      'overflow on a boolean operation',
      '<div data-key="root" class="w-fit h-fit overflow-hidden"><div data-key="a" class="absolute left-[0px] top-[0px] w-[20px] h-[20px]"></div><div data-key="b" class="absolute left-[10px] top-[0px] w-[20px] h-[20px]"></div></div>',
      {
        root: { figma: { booleanOperation: 'UNION' } },
        a: { figma: { shape: { type: 'RECTANGLE' } } },
        b: { figma: { shape: { type: 'RECTANGLE' } } }
      },
      /Overflow classes/
    ]
  ])('rejects %s', (_case, markup, bindings, error) => {
    expect(() =>
      parse(markup, {
        bindings: bindings as CanvasResolvedApplyParameters['bindings']
      })
    ).toThrow(error)
  })

  it('normalizes authored components and variant sets as frame containers', () => {
    const result = parse(
      `
        <div data-key="button-set" class="w-[480px] h-[160px]">
          <div data-key="default" class="absolute left-[24px] top-[24px] flex flex-row items-center justify-center w-[200px] h-[48px]">
            <span data-key="default-label" class="w-fit h-fit">Continue</span>
          </div>
          <div data-key="hover" class="absolute left-[248px] top-[24px] flex flex-row items-center justify-center w-[200px] h-[48px]">
            <span data-key="hover-label" class="w-fit h-fit">Continue</span>
          </div>
        </div>
      `,
      {
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
    )

    expect(result.root).toMatchObject({
      type: 'COMPONENT_SET',
      size: { width: 480, height: 160 },
      layout: { mode: 'NONE' },
      figma: {
        component: {
          type: 'COMPONENT_SET',
          descriptionMarkdown: '**Button** variants',
          documentationLink: 'https://example.com/button'
        }
      }
    })
    expect(result.root.children?.map(({ type, displayName }) => ({ type, displayName }))).toEqual([
      { type: 'COMPONENT', displayName: 'State=Default' },
      { type: 'COMPONENT', displayName: 'State=Hover' }
    ])
    expect(result.root.children?.[0]).toMatchObject({
      layout: { mode: 'HORIZONTAL' },
      position: { x: 24, y: 24 }
    })
  })

  it('normalizes component sublayer references and slots as frame containers', () => {
    const result = parse(
      `
        <div data-key="card" class="flex flex-col gap-[12px] p-[16px] w-[320px] h-[240px]">
          <span data-key="title" class="w-fit h-fit">Card title</span>
          <div data-key="content" class="flex flex-col grow gap-[8px] p-[12px] w-full h-fit">
            <span data-key="body" class="w-fit h-fit">Default content</span>
          </div>
        </div>
      `,
      {
        bindings: {
          card: {
            figma: {
              component: {
                type: 'COMPONENT',
                properties: {
                  title: {
                    type: 'TEXT',
                    name: 'Title',
                    defaultValue: 'Card title'
                  },
                  'show-title': {
                    type: 'BOOLEAN',
                    name: 'Show title',
                    defaultValue: true
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
          content: {
            figma: {
              slot: {
                property: {
                  name: 'Content',
                  settings: { minChildren: 0, maxChildren: 4 }
                }
              }
            }
          }
        }
      }
    )

    expect(result.root.children?.[0]).toMatchObject({
      type: 'TEXT',
      figma: {
        componentPropertyReferences: {
          characters: 'title',
          visible: 'show-title'
        }
      }
    })
    expect(result.root.children?.[1]).toMatchObject({
      type: 'SLOT',
      layout: { mode: 'VERTICAL', gap: 8 },
      figma: {
        slot: {
          property: {
            name: 'Content',
            settings: { minChildren: 0, maxChildren: 4 }
          }
        }
      }
    })
  })

  it.each([
    [
      'an empty component set',
      '<div data-key="root" class="w-[320px] h-[160px]"></div>',
      { root: { figma: { component: { type: 'COMPONENT_SET' } } } },
      /requires at least one component child/
    ],
    [
      'a non-component variant',
      '<div data-key="root" class="w-[320px] h-[160px]"><div data-key="frame" class="absolute left-[0px] top-[0px] w-[100px] h-[40px]"></div></div>',
      { root: { figma: { component: { type: 'COMPONENT_SET' } } } },
      /can contain only component nodes/
    ],
    [
      'a nested authored component',
      '<div data-key="root" class="w-[320px] h-[160px]"><div data-key="frame" class="absolute left-[0px] top-[0px] w-[200px] h-[100px]"><div data-key="nested" class="absolute left-[0px] top-[0px] w-[100px] h-[40px]"></div></div></div>',
      {
        root: { figma: { component: { type: 'COMPONENT' } } },
        nested: { figma: { component: { type: 'COMPONENT' } } }
      },
      /cannot be nested inside another component/
    ],
    [
      'an authored component span',
      '<span data-key="root" class="w-fit h-fit">Label</span>',
      { root: { figma: { component: { type: 'COMPONENT' } } } },
      /requires a div/
    ],
    [
      'a slot outside a component',
      '<div data-key="root" class="w-[320px] h-[160px]"><div data-key="slot" class="absolute left-[0px] top-[0px] w-[100px] h-[40px]"></div></div>',
      {
        slot: {
          figma: {
            slot: { property: { name: 'Content' } }
          }
        }
      },
      /must be nested inside an authored component/
    ],
    [
      'a slot canvas root',
      '<div data-key="root" class="w-[320px] h-[160px]"></div>',
      {
        root: {
          figma: {
            slot: { property: { name: 'Content' } }
          }
        }
      },
      /must be nested inside an authored component/
    ],
    [
      'a mainComponent reference on a frame',
      '<div data-key="root" class="w-[320px] h-[160px]"></div>',
      {
        root: {
          figma: {
            componentPropertyReferences: { mainComponent: 'icon' }
          }
        }
      },
      /requires an instance/
    ]
  ])('rejects %s', (_case, markup, bindings, error) => {
    expect(() =>
      parse(markup, {
        bindings: bindings as CanvasResolvedApplyParameters['bindings']
      })
    ).toThrow(error)
  })

  it.each([
    ['linear in-flow', 'flex flex-row', ''],
    ['grid in-flow', 'grid grid-cols-1 grid-rows-1', ''],
    ['linear absolute', 'flex flex-row', 'absolute left-[24px] top-[12px]']
  ])(
    'preserves axes-only native transforms on %s Auto Layout children',
    (_case, layout, position) => {
      const relativeTransform: Transform = [
        [1, 0.6, 0],
        [0, 0.8, 0]
      ]
      const result = parse(
        `<div data-key="root" class="${layout} w-[320px] h-[200px]"><div data-key="child" class="${position} w-[20px] h-[20px]"></div></div>`,
        { bindings: { child: { figma: { relativeTransform } } } }
      )

      expect(result.root.children?.[0]?.figma?.relativeTransform).toEqual(relativeTransform)
    }
  )

  it('rejects ambiguous or inapplicable native relative transforms', () => {
    const binding: CanvasBinding = {
      figma: {
        relativeTransform: [
          [1, 0, 24],
          [0, 1, 12]
        ]
      }
    }
    const child = (classes = '') =>
      `<div data-key="root" class="w-[320px] h-[200px]"><div data-key="child" class="w-[20px] h-[20px] ${classes}"></div></div>`

    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="w-[20px] h-[20px]"></div></div>',
        { bindings: { child: binding } }
      )
    ).toThrow(/must use zero translation in Auto Layout/)
    expect(() => parse(child('rotate-[20deg]'), { bindings: { child: binding } })).toThrow(
      /cannot be combined with a rotation class/
    )
    expect(() =>
      parse(child('absolute left-[0px] top-[0px]'), { bindings: { child: binding } })
    ).toThrow(/cannot be combined with position classes/)
  })

  it('preserves typed linear Auto Layout, layout grids, and guides', () => {
    const figma: CanvasFigmaProperties = {
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
          variables: { gutterSize: { id: 'variable:gutter' } }
        },
        { pattern: 'GRID', sectionSize: 8 }
      ],
      guides: [
        { axis: 'X', offset: 24 },
        { axis: 'Y', offset: 40 }
      ]
    }
    const result = parse(
      '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px]"></div>',
      { bindings: { root: { figma } } }
    )

    expect(result.root.figma).toEqual(figma)
    expect(result.root.layout).toMatchObject({
      mode: 'HORIZONTAL',
      gap: 0,
      counterGap: 0,
      wrap: 'WRAP'
    })
  })

  it.each([
    [
      'Auto Layout state on a plain frame',
      '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      { autoLayout: { itemSpacing: -8 } },
      {},
      /require a flex frame/
    ],
    [
      'Auto Layout state on a grid frame',
      '<div data-key="root" class="grid grid-cols-2 grid-rows-2 w-[320px] h-[200px]"></div>',
      { autoLayout: { itemSpacing: -8 } },
      {},
      /require a flex frame/
    ],
    [
      'counter spacing without wrapping',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"></div>',
      { autoLayout: { counterAxisSpacing: 8 } },
      {},
      /requires flex-wrap/
    ],
    [
      'main gap from classes and Figma state',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-x-[8px]"></div>',
      { autoLayout: { itemSpacing: -8 } },
      {},
      /Main-axis spacing/
    ],
    [
      'counter gap from classes and Figma state',
      '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px] gap-y-[8px]"></div>',
      { autoLayout: { counterAxisSpacing: 12 } },
      {},
      /Counter-axis spacing/
    ],
    [
      'synchronized and variable counter spacing',
      '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px]"></div>',
      { autoLayout: { counterAxisSpacing: null } },
      { variables: { counterAxisSpacing: { id: 'variable:gap' } } },
      /cannot be combined/
    ],
    [
      'direct layout grids and grid style',
      '<div data-key="root" class="w-[320px] h-[200px]"></div>',
      { layoutGrids: [] },
      { styles: { grid: { id: 'style:grid' } } },
      /Direct layout grids/
    ],
    [
      'guides on text',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="target" class="w-fit h-fit">Text</span></div>',
      { guides: [{ axis: 'X', offset: 0 }] },
      {},
      /not supported on TEXT/
    ]
  ] as Array<[string, string, CanvasFigmaProperties, Omit<CanvasBinding, 'figma'>, RegExp]>)(
    'rejects ambiguous or inapplicable native layout state: %s',
    (_, markup, figma, extra, error) => {
      const key = markup.includes('data-key="target"') ? 'target' : 'root'
      expect(() =>
        parse(markup, {
          bindings: {
            [key]: { ...extra, figma }
          }
        })
      ).toThrow(error)
    }
  )

  it('normalizes manual grid tracks, placement, spans, and child alignment', () => {
    const result = parse(`
      <div
        data-key="grid"
        class="grid grid-cols-[1fr_240px_fit-content(100%)] grid-rows-[80px_1fr] w-[720px] h-[400px] gap-x-[24px] gap-y-[16px] p-[20px]"
      >
        <div data-key="nav" class="w-full h-full col-start-1 row-start-1 row-span-2"></div>
        <span
          data-key="title"
          class="w-full h-fit col-start-2 row-start-1 col-span-2 justify-self-center self-start"
        >Overview</span>
        <div data-key="content" class="w-full h-full"></div>
      </div>
    `)

    expect(result.root.layout).toEqual({
      autoRows: false,
      mode: 'GRID',
      columns: [{ type: 'FLEX', value: 1 }, { type: 'FIXED', value: 240 }, { type: 'HUG' }],
      rows: [
        { type: 'FIXED', value: 80 },
        { type: 'FLEX', value: 1 }
      ],
      rowGap: 16,
      columnGap: 24,
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      itemsPositioning: 'MANUAL',
      strokesIncluded: true
    })
    expect(result.root.children?.map((child) => child.gridChild)).toEqual([
      {
        row: 0,
        column: 0,
        rowSpan: 2,
        columnSpan: 1,
        horizontalAlign: 'AUTO',
        verticalAlign: 'AUTO'
      },
      {
        row: 0,
        column: 1,
        rowSpan: 1,
        columnSpan: 2,
        horizontalAlign: 'CENTER',
        verticalAlign: 'MIN'
      },
      {
        row: 1,
        column: 1,
        rowSpan: 1,
        columnSpan: 1,
        horizontalAlign: 'AUTO',
        verticalAlign: 'AUTO'
      }
    ])
  })

  it('normalizes row auto-flow grids with automatic rows', () => {
    const result = parse(`
      <div data-key="grid" class="grid grid-flow-row grid-cols-2 w-[480px] h-[320px] gap-[12px]">
        <div data-key="one" class="w-full h-full col-span-2"></div>
        <div data-key="two" class="w-full h-full"></div>
      </div>
    `)

    expect(result.root.layout).toMatchObject({
      mode: 'GRID',
      columns: [
        { type: 'FLEX', value: 1 },
        { type: 'FLEX', value: 1 }
      ],
      rowGap: 12,
      columnGap: 12,
      itemsPositioning: 'ROW_AUTO_FLOW'
    })
    expect(result.root.layout).not.toHaveProperty('rows')
    expect(result.root.children?.[0]?.gridChild).toEqual({
      rowSpan: 1,
      columnSpan: 2,
      horizontalAlign: 'AUTO',
      verticalAlign: 'AUTO'
    })
  })

  it('normalizes manually positioned grids with automatic rows', () => {
    const result = parse(`
      <div data-key="grid" class="grid grid-cols-2 w-[480px] h-[320px]">
        <div data-key="tall" class="w-full h-full col-start-2 row-start-1 row-span-2"></div>
        <div data-key="one" class="w-full h-full"></div>
        <div data-key="two" class="w-full h-full"></div>
      </div>
    `)

    expect(result.root.layout).toMatchObject({
      mode: 'GRID',
      itemsPositioning: 'MANUAL'
    })
    expect(result.root.layout).not.toHaveProperty('rows')
    expect(result.root.children?.map((child) => child.gridChild)).toEqual([
      {
        row: 0,
        column: 1,
        rowSpan: 2,
        columnSpan: 1,
        horizontalAlign: 'AUTO',
        verticalAlign: 'AUTO'
      },
      {
        row: 0,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
        horizontalAlign: 'AUTO',
        verticalAlign: 'AUTO'
      },
      {
        row: 1,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
        horizontalAlign: 'AUTO',
        verticalAlign: 'AUTO'
      }
    ])
  })

  it('normalizes shared layer state and typed Figma-only properties', () => {
    const result = parse(
      '<div data-key="root" class="w-[320px] h-[200px] hidden mix-blend-multiply rotate-[450deg]"></div>',
      {
        bindings: {
          root: {
            figma: {
              locked: true,
              aspectRatioLocked: true
            }
          }
        }
      }
    )

    expect(result.root).toMatchObject({
      visible: false,
      blendMode: 'MULTIPLY',
      rotation: -450,
      figma: {
        locked: true,
        aspectRatioLocked: true
      }
    })
  })

  it('normalizes all native basic shapes and their exact geometry', () => {
    const shapes = {
      rectangle: { type: 'RECTANGLE' as const },
      line: { type: 'LINE' as const },
      ellipse: {
        type: 'ELLIPSE' as const,
        arc: { startAngle: -45, endAngle: 270, innerRadius: 0.5 }
      },
      polygon: { type: 'POLYGON' as const, pointCount: 6 },
      star: { type: 'STAR' as const, pointCount: 7, innerRadius: 0.6 }
    }
    const result = parse(
      `
        <div data-key="root" class="flex flex-col w-[400px] h-[400px]">
          <div data-key="rectangle" class="w-[80px] h-[40px] bg-[#FF0000] border-[2px] border-[#000000] rounded-[8px]"></div>
          <div data-key="line" class="w-[120px] h-[0px] border-[3px] border-[#00FF00]"></div>
          <div data-key="ellipse" class="w-[80px] h-[80px]"></div>
          <div data-key="polygon" class="w-[80px] h-[80px]"></div>
          <div data-key="star" class="w-[80px] h-[80px]"></div>
        </div>
      `,
      {
        bindings: Object.fromEntries(
          Object.entries(shapes).map(([key, shape]) => [key, { figma: { shape } }])
        )
      }
    )

    expect(result.root.children?.map((child) => child.type)).toEqual([
      'RECTANGLE',
      'LINE',
      'ELLIPSE',
      'POLYGON',
      'STAR'
    ])
    expect(result.root.children?.map((child) => child.figma?.shape)).toEqual(Object.values(shapes))
    expect(result.root.children?.[0]).toMatchObject({
      appearance: {
        fill: '#FF0000',
        stroke: '#000000',
        strokeWeight: 2,
        cornerRadius: 8
      }
    })
    expect(result.root.children?.[1]).toMatchObject({
      size: { width: 120, height: 0, horizontal: 'FIXED', vertical: 'FIXED' },
      appearance: { stroke: '#00FF00', strokeWeight: 3 }
    })
  })

  it('normalizes individual border and corner classes independently of class order', () => {
    const result = parse(
      `
        <div
          data-key="root"
          class="w-[320px] h-[200px] border-t-[1px] border-[#112233] rounded-br-[16px] border-[2px] rounded-[8px] border-l-[4px]"
        ></div>
      `,
      {
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
    )

    expect(result.root.appearance).toMatchObject({
      stroke: '#112233',
      strokeTopWeight: 1,
      strokeRightWeight: 2,
      strokeBottomWeight: 2,
      strokeLeftWeight: 4,
      topLeftRadius: 8,
      topRightRadius: 8,
      bottomRightRadius: 16,
      bottomLeftRadius: 8
    })
    expect(result.root.figma).toMatchObject({
      stroke: {
        align: 'OUTSIDE',
        cap: 'ARROW_LINES',
        join: 'BEVEL',
        miterLimit: 6,
        dashPattern: [8, 4]
      },
      corners: { smoothing: 0.75 }
    })
  })

  it('preserves ordered native effects in the typed Figma extension', () => {
    const effects = [
      {
        type: 'DROP_SHADOW' as const,
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 4 },
        radius: 8
      },
      {
        type: 'LAYER_BLUR' as const,
        blurType: 'NORMAL' as const,
        radius: 12
      }
    ]
    const result = parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
      bindings: { root: { figma: { effects } } }
    })

    expect(result.root.figma?.effects).toEqual(effects)
  })

  it('explains how to separate a label background from its text fill', () => {
    expect(() =>
      parse(
        '<span data-key="label" class="w-[96px] h-[32px] bg-[#E4D5B8] text-[#7B4A23]">Label</span>'
      )
    ).toThrow(/parent div and a child span/)
  })

  it('compiles exact box and inset shadow utilities to native effects', () => {
    const result = parse(
      '<div data-key="root" class="w-[320px] h-[200px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] inset-shadow-[0_1px_1px_rgba(0,0,0,0.05)]"></div>'
    )

    expect(result.root.figma?.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 4 },
        radius: 6,
        spread: -1
      },
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 2 },
        radius: 4,
        spread: -2
      },
      {
        type: 'INNER_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.05 },
        offset: { x: 0, y: 1 },
        radius: 1
      }
    ])
  })

  it('compiles arbitrary text shadows and clears them with text-shadow-none', () => {
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit text-shadow-[0_2px_4px_rgba(17,34,51,0.25)]">Copy</span></div>'
    )

    expect(result.root.children?.[0]?.figma?.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        color: { r: 17 / 255, g: 34 / 255, b: 51 / 255, a: 0.25 },
        offset: { x: 0, y: 2 },
        radius: 4
      }
    ])

    const cleared = parse(
      '<span data-key="copy" class="w-[120px] h-[24px] text-shadow-none">Copy</span>',
      { mode: 'update', targetNodeId: '1:2' }
    )
    expect(cleared.root.figma?.effects).toEqual([])
  })

  it('rejects shadow classes on the wrong node kind or alongside another effect source', () => {
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit shadow-[0_1px_2px_#000000]">Copy</span></div>'
      )
    ).toThrow(/Box shadow classes are not supported on TEXT/)
    expect(() =>
      parse(
        '<div data-key="root" class="w-[320px] h-[200px] text-shadow-[0_1px_2px_#000000]"></div>'
      )
    ).toThrow(/Text shadow classes are not supported on FRAME/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px] shadow-[0_1px_2px_#000000]"></div>', {
        bindings: { root: { styles: { effect: { id: 'style:effect' } } } }
      })
    ).toThrow(/Shadow classes and an effect style cannot be combined/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px] shadow-[0_2px_-4px_#000000]"></div>')
    ).toThrow(/requires a color and two to four px lengths/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px] shadow-[,]"></div>')
    ).toThrow(/Invalid shadow class/)
  })

  it.each(['shadow-md', 'inset-shadow-sm', 'text-shadow-lg'])(
    'rejects unresolved theme shadow class %s',
    (className) => {
      expect(() =>
        parse(`<div data-key="root" class="w-[320px] h-[200px] ${className}"></div>`)
      ).toThrow(/needs an exact bracketed value or "none"/)
    }
  )

  it('preserves direct paint stacks without compiling fallback paints', () => {
    const fills: NonNullable<CanvasFigmaProperties['fills']> = [
      {
        type: 'SOLID',
        color: { r: 1, g: 0, b: 0 },
        variables: { color: { id: 'VariableID:fill' } }
      }
    ]
    const strokes: NonNullable<CanvasFigmaProperties['strokes']> = [
      {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0]
        ],
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
        ]
      }
    ]
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px] border-[2px]"><span data-key="text" class="w-full h-fit">Text</span></div>',
      {
        bindings: {
          root: { figma: { fills, strokes } },
          text: { figma: { fills } }
        }
      }
    )

    expect(result.root.figma).toMatchObject({ fills, strokes })
    expect(result.root.appearance).not.toHaveProperty('fill')
    expect(result.root.appearance).not.toHaveProperty('stroke')
    expect(result.root.children?.[0]?.appearance).not.toHaveProperty('fill')
  })

  it('rejects direct paint stacks combined with another source for that paint', () => {
    const fills: NonNullable<CanvasFigmaProperties['fills']> = [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }
    ]
    const markup = '<div data-key="root" class="w-[320px] h-[200px]"></div>'

    expect(() =>
      parse(markup, {
        bindings: {
          root: {
            styles: { fill: { id: 'style:fill' } },
            figma: { fills }
          }
        }
      })
    ).toThrow(/Direct fill paints and a fill style/)
    expect(() =>
      parse(markup, {
        bindings: {
          root: {
            variables: { fill: { id: 'variable:fill' } },
            figma: { fills }
          }
        }
      })
    ).toThrow(/Direct fill paints and a fill variable/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px] bg-[#FFFFFF]"></div>', {
        bindings: { root: { figma: { fills } } }
      })
    ).toThrow(/Direct fill paints and a literal fill/)
    expect(() =>
      parse(
        '<div data-key="root" class="w-[320px] h-[200px] border-[2px] border-[#000000]"></div>',
        { bindings: { root: { figma: { strokes: fills } } } }
      )
    ).toThrow(/Direct stroke paints and a literal stroke/)
  })

  it('rejects effect-style conflicts and statically invalid shadow spread', () => {
    const shadow = {
      type: 'DROP_SHADOW' as const,
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 2
    }
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            styles: { effect: { id: 'style:effect' } },
            figma: { effects: [shadow] }
          }
        }
      })
    ).toThrow(/Direct effects and an effect style/)

    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="text" class="w-full h-fit">Text</span></div>',
        { bindings: { text: { figma: { effects: [shadow] } } } }
      )
    ).toThrow(/Shadow spread is not supported on TEXT/)
  })

  it('uses typed geometry and variable-bound sides as complete literal fallbacks', () => {
    const result = parse(
      `
        <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
          <div data-key="shape" class="w-[80px] h-[48px] border-[#112233]"></div>
          <div data-key="variable" class="w-[80px] h-[48px] border-[2px] border-[#445566] rounded-[8px]"></div>
          <div data-key="component" class="w-fit h-fit"></div>
        </div>
      `,
      {
        bindings: {
          shape: {
            figma: {
              shape: { type: 'RECTANGLE' },
              stroke: { weights: { top: 1, right: 2, bottom: 3, left: 4 } },
              corners: {
                radii: { topLeft: 5, topRight: 6, bottomRight: 7, bottomLeft: 8 }
              }
            }
          },
          variable: {
            variables: {
              strokeRightWeight: { id: 'VariableID:stroke' },
              topLeftRadius: { id: 'VariableID:radius' }
            }
          },
          component: {
            component: { id: 'ComponentID:button' },
            figma: {
              stroke: { weights: { top: 1, right: 2, bottom: 3, left: 4 } },
              corners: {
                radii: { topLeft: 5, topRight: 6, bottomRight: 7, bottomLeft: 8 }
              }
            }
          }
        }
      }
    )

    expect(result.root.children?.[0]?.appearance).toMatchObject({
      strokeTopWeight: 1,
      strokeRightWeight: 2,
      strokeBottomWeight: 3,
      strokeLeftWeight: 4,
      topLeftRadius: 5,
      topRightRadius: 6,
      bottomRightRadius: 7,
      bottomLeftRadius: 8
    })
    expect(result.root.children?.[1]?.appearance).toMatchObject({
      strokeTopWeight: 2,
      strokeRightWeight: 2,
      strokeBottomWeight: 2,
      strokeLeftWeight: 2,
      topLeftRadius: 8,
      topRightRadius: 8,
      bottomRightRadius: 8,
      bottomLeftRadius: 8
    })
    expect(result.root.children?.[2]).toMatchObject({
      type: 'INSTANCE',
      appearance: {
        strokeTopWeight: 1,
        strokeRightWeight: 2,
        strokeBottomWeight: 3,
        strokeLeftWeight: 4,
        topLeftRadius: 5,
        topRightRadius: 6,
        bottomRightRadius: 7,
        bottomLeftRadius: 8
      }
    })
  })

  it.each([
    [
      'individual stroke class on ellipse',
      'border-t-[1px] border-[#000000]',
      { shape: { type: 'ELLIPSE' } },
      /Individual stroke weights/
    ],
    [
      'individual typed stroke on star',
      'border-[#000000]',
      {
        shape: { type: 'STAR' },
        stroke: { weights: { top: 1, right: 1, bottom: 1, left: 1 } }
      },
      /Individual stroke weights/
    ],
    [
      'individual corner class on polygon',
      'rounded-tl-[4px]',
      { shape: { type: 'POLYGON' } },
      /Individual corner classes/
    ],
    [
      'individual typed corners on ellipse',
      '',
      {
        shape: { type: 'ELLIPSE' },
        corners: { radii: { topLeft: 1, topRight: 1, bottomRight: 1, bottomLeft: 1 } }
      },
      /Individual corner radii/
    ],
    [
      'corner smoothing on line',
      '',
      { shape: { type: 'LINE' }, corners: { smoothing: 0.5 } },
      /Figma corner properties/
    ],
    [
      'class and typed stroke weight',
      'border-[1px] border-[#000000]',
      { stroke: { weight: 2 } },
      /both classes and Figma properties/
    ],
    [
      'class and typed corner radius',
      'rounded-[4px]',
      { corners: { radius: 8 } },
      /both classes and Figma properties/
    ]
  ])('rejects unsupported or ambiguous stroke/corner state: %s', (_name, classes, figma, error) => {
    const lineHeight = 'shape' in figma && figma.shape?.type === 'LINE' ? 0 : 40
    expect(() =>
      parse(
        `<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="target" class="w-[40px] h-[${lineHeight}px] ${classes}"></div></div>`,
        {
          bindings: {
            target: { figma: figma as CanvasFigmaProperties }
          }
        }
      )
    ).toThrow(error)
  })

  it.each([
    [
      'shape on a span',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="shape" class="w-[40px] h-[40px]">x</span></div>',
      { shape: { type: 'ELLIPSE' } },
      /requires a childless div/
    ],
    [
      'shape children',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="flex flex-col w-[40px] h-[40px]"><span data-key="copy" class="w-fit h-fit">x</span></div></div>',
      { shape: { type: 'RECTANGLE' } },
      /must be childless/
    ],
    [
      'shape layout',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="p-[4px] w-[40px] h-[40px]"></div></div>',
      { shape: { type: 'RECTANGLE' } },
      /Layout class/
    ],
    [
      'shape clipping',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="overflow-hidden w-[40px] h-[40px]"></div></div>',
      { shape: { type: 'RECTANGLE' } },
      /Overflow classes/
    ],
    [
      'shape hug sizing',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-fit h-[40px]"></div></div>',
      { shape: { type: 'RECTANGLE' } },
      /cannot use hug sizing/
    ],
    [
      'nonzero line height',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[1px]"></div></div>',
      { shape: { type: 'LINE' } },
      /requires h-\[0px\]/
    ],
    [
      'zero line width',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[0px] h-[0px]"></div></div>',
      { shape: { type: 'LINE' } },
      /width of at least 0.01px/
    ],
    [
      'line corner radius',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[0px] rounded-[2px]"></div></div>',
      { shape: { type: 'LINE' } },
      /does not support corner radius/
    ],
    [
      'line aspect ratio',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[0px]"></div></div>',
      { shape: { type: 'LINE' }, aspectRatioLocked: true },
      /does not support aspect-ratio locking/
    ],
    [
      'line growing on its zero-height axis',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="grow w-[40px] h-[0px]"></div></div>',
      { shape: { type: 'LINE' } },
      /cannot grow on a vertical axis/
    ],
    [
      'zero rectangle width',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[0px] h-[40px]"></div></div>',
      { shape: { type: 'RECTANGLE' } },
      /must be at least 0.01px/
    ],
    [
      'shape grid style',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[40px]"></div></div>',
      { shape: { type: 'ELLIPSE' } },
      /Style field "grid"/,
      { styles: { grid: { id: 'style:grid' } } }
    ],
    [
      'shape layout variable',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[40px]"></div></div>',
      { shape: { type: 'ELLIPSE' } },
      /Variable field "gap"/,
      { variables: { gap: { id: 'variable:gap' } } }
    ]
  ] as Array<[string, string, CanvasFigmaProperties, RegExp, Partial<CanvasBinding>?]>)(
    'rejects %s',
    (_, markup, figma, message, extra) => {
      expect(() =>
        parse(markup, {
          bindings: {
            shape: { ...extra, figma }
          }
        })
      ).toThrow(message)
    }
  )

  it('requires shape paint bindings and stroke styles to have literal fallbacks', () => {
    const markup =
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[40px]"></div></div>'
    expect(() =>
      parse(markup, {
        bindings: {
          shape: {
            variables: { fill: { id: 'variable:fill' } },
            figma: { shape: { type: 'RECTANGLE' } }
          }
        }
      })
    ).toThrow(/requires a solid bg/)
    expect(() =>
      parse(markup, {
        bindings: {
          shape: {
            styles: { stroke: { id: 'style:stroke' } },
            figma: { shape: { type: 'RECTANGLE' } }
          }
        }
      })
    ).toThrow(/requires border/)
    expect(() =>
      parse(markup, {
        bindings: {
          shape: {
            styles: { stroke: { id: 'style:stroke' } },
            figma: { shape: { type: 'RECTANGLE' }, stroke: { weight: 2 } }
          }
        }
      })
    ).not.toThrow()
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[40px] border-[#000000]"></div></div>',
        {
          bindings: {
            shape: {
              variables: {
                stroke: { id: 'variable:stroke' },
                strokeWeight: { id: 'variable:weight' }
              },
              figma: { shape: { type: 'RECTANGLE' } }
            }
          }
        }
      )
    ).not.toThrow()
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[0px]"></div></div>',
        {
          bindings: {
            shape: {
              variables: { height: { id: 'variable:height' } },
              figma: { shape: { type: 'LINE' } }
            }
          }
        }
      )
    ).toThrow(/cannot bind or constrain its zero height/)
  })

  it('normalizes whole-node text layout and truncation without flattening units', () => {
    const result = parse(`
      <div data-key="root" class="flex flex-col w-[320px] h-[200px]">
        <span
          data-key="copy"
          class="w-[240px] h-[80px] leading-normal tracking-[2%] text-justify uppercase underline line-clamp-2"
        >Two lines of copy</span>
      </div>
    `)

    expect(result.root.children?.[0]?.text).toMatchObject({
      lineHeight: { unit: 'PERCENT', value: 150 },
      letterSpacing: { unit: 'PERCENT', value: 2 },
      alignHorizontal: 'JUSTIFIED',
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
      textTruncation: 'ENDING',
      maxLines: 2
    })
  })

  it.each([
    ['lowercase', { textCase: 'LOWER' }],
    ['capitalize', { textCase: 'TITLE' }],
    ['no-underline', { textDecoration: 'NONE' }],
    ['truncate', { textTruncation: 'ENDING', maxLines: 1 }]
  ])('maps the %s text class', (className, expected) => {
    const result = parse(
      `<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit ${className}">Copy</span></div>`
    )

    expect(result.root.children?.[0]?.text).toMatchObject(expected)
  })

  it('keeps Figma-only whole-node text properties and text variables typed', () => {
    const text = {
      fontName: { family: 'IBM Plex Sans', style: 'Medium' },
      verticalAlign: 'BOTTOM' as const,
      case: 'SMALL_CAPS_FORCED' as const,
      paragraphIndent: 12,
      paragraphSpacing: 16,
      listSpacing: 8,
      hangingPunctuation: true,
      hangingList: true,
      leadingTrim: 'CAP_HEIGHT' as const,
      hyperlink: { type: 'URL' as const, value: 'https://example.com' }
    }
    const variables = {
      characters: { id: 'VariableID:content' },
      visible: { id: 'VariableID:visible' },
      fontWeight: { id: 'VariableID:weight' },
      paragraphIndent: { id: 'VariableID:indent' },
      paragraphSpacing: { id: 'VariableID:spacing' }
    }
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
      {
        bindings: {
          copy: {
            variables,
            figma: { text }
          }
        }
      }
    )

    expect(result.root.children?.[0]).toMatchObject({
      variables,
      figma: { text },
      text: {
        fontFamily: 'IBM Plex Sans',
        fontStyle: 'Medium'
      }
    })
  })

  it.each([
    {
      className: 'font-sans',
      binding: {}
    },
    {
      className: '',
      binding: { variables: { fontFamily: { id: 'VariableID:family' } } }
    },
    {
      className: '',
      binding: { styles: { text: { id: 'StyleID:text' } } }
    }
  ])('rejects ambiguous exact whole-node font sources %#', ({ className, binding }) => {
    expect(() =>
      parse(`<span data-key="copy" class="w-fit h-fit ${className}">Copy</span>`, {
        bindings: {
          copy: {
            ...binding,
            figma: {
              text: { fontName: { family: 'IBM Plex Sans', style: 'Medium' } }
            }
          }
        }
      })
    ).toThrow('cannot use both')
  })

  it('preserves exact text and typed rich-text ranges', () => {
    const ranges = [
      {
        start: 0,
        end: 6,
        fontName: { family: 'Inter', style: 'Bold' },
        fills: [
          {
            type: 'SOLID' as const,
            color: { r: 1, g: 0, b: 0 },
            variables: { color: { id: 'variable:text-color' } }
          }
        ],
        hyperlink: { type: 'URL' as const, value: 'https://example.com' }
      },
      {
        start: 6,
        end: 14,
        listOptions: { type: 'UNORDERED' as const },
        indentation: 1,
        variables: { fontSize: { id: 'variable:text-size' } }
      }
    ]
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit whitespace-pre-wrap">Line 1\n  Line 2</span></div>',
      {
        bindings: {
          copy: {
            figma: {
              text: { ranges }
            }
          }
        }
      }
    )

    expect(result.root.children?.[0]?.text?.characters).toBe('Line 1\n  Line 2')
    expect(result.root.children?.[0]?.figma?.text?.ranges).toEqual(ranges)
  })

  it.each(['<br>', '<br/>', '<BR >'])('normalizes %s inside span text', (lineBreak) => {
    const result = parse(
      `<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit"> Line 1 ${lineBreak} Line 2 </span></div>`
    )

    expect(result.root.children?.[0]?.text?.characters).toBe('Line 1\nLine 2')
  })

  it('rejects a line break outside span text', () => {
    expect(() =>
      parse('<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><br></div>')
    ).toThrow('Canvas HTML supports <br> only inside span text.')
  })

  it('preserves decoded non-breaking spaces under normal HTML whitespace', () => {
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">A&nbsp;&nbsp;B</span></div>'
    )

    expect(result.root.children?.[0]?.text?.characters).toBe('A\u00a0\u00a0B')
  })

  it('uses UTF-16 text-range offsets and rejects out-of-bounds ranges', () => {
    const markup =
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">👍</span></div>'
    expect(
      parse(markup, {
        bindings: {
          copy: {
            figma: {
              text: {
                ranges: [{ start: 0, end: 2, fontSize: 18 }]
              }
            }
          }
        }
      }).root.children?.[0]?.figma?.text?.ranges
    ).toHaveLength(1)

    expect(() =>
      parse(markup, {
        bindings: {
          copy: {
            figma: {
              text: {
                ranges: [{ start: 0, end: 3, fontSize: 18 }]
              }
            }
          }
        }
      })
    ).toThrow(/beyond its 2 UTF-16 code units/)
  })

  it.each(BLEND_MODE_CLASSES)('maps %s to Figma %s', (className, blendMode) => {
    expect(
      parse(`<div data-key="root" class="w-[320px] h-[200px] ${className}"></div>`).root.blendMode
    ).toBe(blendMode)
  })

  it('accepts grid gap variables only on grid containers', () => {
    const result = parse(
      '<div data-key="grid" class="grid grid-cols-2 grid-rows-1 w-[480px] h-[320px]"></div>',
      {
        bindings: {
          grid: {
            variables: {
              gridRowGap: { id: 'VariableID:row-gap' },
              gridColumnGap: { id: 'VariableID:column-gap' }
            }
          }
        }
      }
    )

    expect(result.root.variables).toEqual({
      gridRowGap: { id: 'VariableID:row-gap' },
      gridColumnGap: { id: 'VariableID:column-gap' }
    })
    expect(() =>
      parse('<div data-key="root" class="flex flex-row w-[480px] h-[320px]"></div>', {
        bindings: {
          root: {
            variables: { gridRowGap: { id: 'VariableID:row-gap' } }
          }
        }
      })
    ).toThrow(/requires grid layout/)
  })

  it.each([
    ['unknown element', '<section data-key="root" class="w-[1px] h-[1px]"></section>'],
    ['unknown attribute', '<div data-key="root" style="color:red" class="w-[1px] h-[1px]"></div>'],
    ['unknown class', '<div data-key="root" class="filter w-[1px] h-[1px]"></div>'],
    ['conflicting classes', '<div data-key="root" class="w-[1px] w-[2px] h-[1px]"></div>'],
    ['multiple roots', '<div data-key="a" class="w-[1px] h-[1px]"></div><div></div>'],
    ['direct div text', '<div data-key="root" class="w-[1px] h-[1px]">not allowed</div>'],
    [
      'nested span element',
      '<div data-key="root" class="flex flex-col w-[10px] h-[10px]"><span data-key="copy" class="w-fit h-fit"><span data-key="nested" class="w-fit h-fit">x</span></span></div>'
    ],
    [
      'unknown blend mode',
      '<div data-key="root" class="w-[10px] h-[10px] mix-blend-plus-unknown"></div>'
    ],
    [
      'conflicting visibility',
      '<div data-key="root" class="w-[10px] h-[10px] visible hidden"></div>'
    ],
    [
      'invalid line clamp',
      '<div data-key="root" class="flex flex-col w-[10px] h-[10px]"><span data-key="copy" class="w-full h-fit line-clamp-0">Copy</span></div>'
    ]
  ])('rejects %s', (_, markup) => {
    expect(() => parse(markup)).toThrow()
  })

  it.each([
    [
      'non-fixed root',
      '<div data-key="root" class="flex flex-col w-[320px] h-fit"></div>',
      /root requires fixed/
    ],
    [
      'unpositioned freeform child',
      '<div data-key="root" class="w-[320px] h-[200px]"><span data-key="copy" class="w-fit h-fit">Copy</span></div>',
      /freeform container requires/
    ],
    [
      'full-width freeform child',
      '<div data-key="root" class="w-[320px] h-[200px]"><div data-key="fill" class="w-full h-[2px]"></div></div>',
      /w-full.*freeform parent.*add flex-col or grid/
    ],
    [
      'full-height freeform child',
      '<div data-key="root" class="w-[320px] h-[200px]"><div data-key="fill" class="w-[2px] h-full"></div></div>',
      /h-full.*freeform parent.*add flex-row or grid/
    ],
    [
      'direction without flex',
      '<div data-key="root" class="flex-row w-[320px] h-[200px]"></div>',
      /requires flex/
    ],
    [
      'main-axis full size',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
      /use grow/
    ],
    [
      'incomplete border',
      '<div data-key="root" class="w-[320px] h-[200px] border"></div>',
      /both stroke weight and paint/
    ],
    [
      'invalid text auto sizing',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-fit h-[20px]">Copy</span></div>',
      /w-fit only together/
    ],
    [
      'font size below the Figma minimum',
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit text-[0.5px]">Copy</span></div>',
      /at least 1px/
    ],
    [
      'cross-axis gap without wrap',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px] gap-y-[8px]"></div>',
      /requires flex-wrap/
    ],
    [
      'content distribution without wrap',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px] content-between"></div>',
      /requires flex-wrap/
    ],
    [
      'absolute child without both offsets',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="absolute left-[8px] w-[20px] h-[20px]"></div></div>',
      /requires left.*top/
    ],
    [
      'offset without absolute positioning',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="left-[8px] top-[8px] w-[20px] h-[20px]"></div></div>',
      /require absolute/
    ],
    [
      'fill sizing on absolute child',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="absolute left-[8px] top-[8px] w-full h-[20px]"></div></div>',
      /cannot use grow/
    ],
    [
      'inverted size bounds',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px] min-w-[400px] max-w-[300px]"></div>',
      /cannot exceed/
    ],
    [
      'new Auto Layout narrower than its padding',
      '<div data-key="root" class="flex flex-row w-[50px] h-[40px] px-[30px]"></div>',
      /must be at least 60px/
    ],
    [
      'grid without columns',
      '<div data-key="root" class="grid grid-rows-2 w-[320px] h-[200px]"></div>',
      /requires grid-cols/
    ],
    [
      'mixed flex and grid',
      '<div data-key="root" class="flex flex-row grid grid-cols-2 grid-rows-1 w-[320px] h-[200px]"></div>',
      /cannot combine/
    ],
    [
      'partial grid position',
      '<div data-key="root" class="grid grid-cols-2 grid-rows-2 w-[320px] h-[200px]"><div data-key="child" class="w-full h-full col-start-1"></div></div>',
      /both row-start and col-start/
    ],
    [
      'overlapping grid children',
      '<div data-key="root" class="grid grid-cols-2 grid-rows-2 w-[320px] h-[200px]"><div data-key="one" class="w-full h-full col-start-1 row-start-1"></div><div data-key="two" class="w-full h-full col-start-1 row-start-1"></div></div>',
      /unoccupied grid area/
    ],
    [
      'explicit auto-flow position',
      '<div data-key="root" class="grid grid-flow-row grid-cols-2 w-[320px] h-[200px]"><div data-key="child" class="w-full h-full col-start-1 row-start-1"></div></div>',
      /cannot use explicit placement/
    ],
    [
      'grid child class outside grid',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="w-[40px] h-[40px] col-span-2"></div></div>',
      /requires an in-flow grid child/
    ],
    [
      'flex track on hug grid axis',
      '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="grid grid-cols-2 grid-rows-[40px] w-fit h-[40px]"></div></div>',
      /cannot contain flexible column/
    ],
    [
      'grow in grid',
      '<div data-key="root" class="grid grid-cols-2 grid-rows-1 w-[320px] h-[200px]"><div data-key="child" class="grow w-[40px] h-[40px]"></div></div>',
      /not supported in grid/
    ],
    [
      'fixed auto-flow grid overflow',
      '<div data-key="root" class="grid grid-flow-row grid-cols-2 grid-rows-1 w-[320px] h-[200px]"><div data-key="one" class="w-full h-full"></div><div data-key="two" class="w-full h-full"></div><div data-key="three" class="w-full h-full"></div></div>',
      /does not fit/
    ],
    [
      'unsupported grid track',
      '<div data-key="root" class="grid grid-cols-[1fr_auto] grid-rows-1 w-[320px] h-[200px]"></div>',
      /Invalid grid track/
    ],
    [
      'automatic row limit overflow',
      '<div data-key="root" class="grid grid-flow-row grid-cols-1 w-[320px] h-[200px]"><div data-key="child" class="w-full h-full row-span-101"></div></div>',
      /does not fit/
    ]
  ])('rejects %s', (_, markup, message) => {
    expect(() => parse(markup)).toThrow(message)
  })

  it('uses the CSS horizontal default for flex without an explicit direction', () => {
    const result = parse('<div data-key="root" class="flex w-[320px] h-[200px]"></div>')

    expect(result.root.layout).toMatchObject({ mode: 'HORIZONTAL' })
  })

  it('includes explicit inside strokes in the new Auto Layout minimum', () => {
    const markup =
      '<div data-key="root" class="flex flex-row w-[60px] h-[40px] px-[30px] border-[2px] border-[#000000]"></div>'
    const bindings = {
      root: { figma: { stroke: { align: 'INSIDE' as const } } }
    }

    expect(() => parse(markup, { bindings })).toThrow(/must be at least 64px/)
    expect(() =>
      parse(markup.replace('border-[#000000]', 'border-[#000000] box-content'), { bindings })
    ).not.toThrow()
  })

  it('preserves an omitted stroke-layout setting during update', () => {
    const result = parse('<div data-key="root" class="flex flex-row w-[320px] h-[200px]"></div>', {
      mode: 'update',
      targetNodeId: '1:2'
    })

    expect(result.root.layout).not.toHaveProperty('strokesIncluded')
  })

  it('allows one side of an existing border to change during update', () => {
    const markup = '<div data-key="root" class="w-[320px] h-[200px] border-[3px]"></div>'

    expect(() => parse(markup)).toThrow(/requires both stroke weight and paint sources/)
    expect(() =>
      parse(markup, {
        mode: 'update',
        targetNodeId: '1:2'
      })
    ).not.toThrow()
  })

  it('allows flexible aspect-ratio locking except on auto-resizing text', () => {
    const result = parse(
      '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="media" class="w-full h-[100px]"></div><div data-key="badge" class="flex flex-row w-fit h-fit"></div><span data-key="label" class="grow w-full h-[40px]">Label</span><span data-key="copy" class="w-full h-fit">Copy</span></div>',
      {
        bindings: {
          media: {
            figma: { aspectRatioLocked: true }
          },
          badge: {
            figma: { aspectRatioLocked: true }
          },
          label: {
            figma: { aspectRatioLocked: true }
          },
          copy: {
            figma: { aspectRatioLocked: false }
          }
        }
      }
    )
    expect(result.root.children?.[0]).toMatchObject({
      size: { horizontal: 'FILL', vertical: 'FIXED' },
      figma: { aspectRatioLocked: true }
    })
    expect(result.root.children?.[1]).toMatchObject({
      size: { horizontal: 'HUG', vertical: 'HUG' },
      figma: { aspectRatioLocked: true }
    })
    expect(result.root.children?.[2]).toMatchObject({
      size: { horizontal: 'FILL', vertical: 'FILL' },
      text: { autoResize: 'NONE' },
      figma: { aspectRatioLocked: true }
    })
    expect(result.root.children?.[3]).toMatchObject({
      size: { horizontal: 'FILL', vertical: 'HUG' },
      figma: { aspectRatioLocked: false }
    })

    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        {
          bindings: {
            copy: {
              figma: { aspectRatioLocked: true }
            }
          }
        }
      )
    ).toThrow(/auto-resizing text/)
  })

  it('requires typed Figma text state on spans and rejects duplicate case sources', () => {
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            figma: { text: { verticalAlign: 'CENTER' } }
          }
        }
      })
    ).toThrow(/require a span/)
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit uppercase">Copy</span></div>',
        {
          bindings: {
            copy: {
              figma: { text: { case: 'SMALL_CAPS' } }
            }
          }
        }
      )
    ).toThrow(/cannot use both/)
  })

  it('rejects ambiguous identities and bindings before reconciliation', () => {
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="root" class="w-full h-fit">Copy</span></div>'
      )
    ).toThrow(/Duplicate data-key/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          missing: {
            variables: { fill: { key: 'color-key' } }
          }
        }
      })
    ).toThrow(/no matching data-key/)
    expect(() =>
      parse('<div data-key="root" data-node-id="1:9" class="w-[320px] h-[200px]"></div>', {
        mode: 'update',
        targetNodeId: '1:2'
      })
    ).toThrow(/must match targetNodeId/)
    expect(() =>
      parse('<div data-key="root" data-node-id="1:2" class="w-[320px] h-[200px]"></div>')
    ).toThrow(/Create mode cannot/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        mode: 'update',
        targetNodeId: '1:2',
        removeKeys: ['root']
      })
    ).toThrow(/cannot be both present and removed/)
    expect(
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        mode: 'update',
        targetNodeId: '1:2',
        removeKeys: ['old/child']
      }).removeKeys
    ).toEqual(['old/child'])
  })

  it('preserves variable clears and mode overrides without requiring obsolete layout state', () => {
    const result = parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
      bindings: {
        root: {
          variables: {
            fill: null,
            gap: null,
            minWidth: null
          },
          variableModes: {
            'collection:theme': 'mode:dark',
            'collection:density': null
          }
        }
      }
    })

    expect(result.root.variables).toEqual({
      fill: null,
      gap: null,
      minWidth: null
    })
    expect(result.root.variableModes).toEqual({
      'collection:theme': 'mode:dark',
      'collection:density': null
    })
  })

  it('rejects incompatible component and variable bindings', () => {
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="button" class="flex flex-row w-full h-fit"></div></div>',
        {
          bindings: {
            button: { component: { key: 'button-key' } }
          }
        }
      )
    ).toThrow(/not supported on component/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            variables: { fill: { key: 'color-key' } }
          }
        }
      })
    ).toThrow(/solid .* fallback/)
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        {
          bindings: {
            copy: {
              variables: { gap: { key: 'spacing-key' } }
            }
          }
        }
      )
    ).toThrow(/not supported on TEXT/)
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        {
          bindings: {
            copy: {
              variables: { gap: null }
            }
          }
        }
      )
    ).toThrow(/not supported on TEXT/)
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><span data-key="copy" class="w-full h-fit">Copy</span></div>',
        {
          bindings: {
            copy: {
              variables: { strokeWeight: { key: 'weight-key' } }
            }
          }
        }
      )
    ).not.toThrow()
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="shape" class="w-[40px] h-[40px] border-[#000000]"></div></div>',
        {
          bindings: {
            shape: {
              variables: { strokeTopWeight: { key: 'weight-key' } },
              figma: { shape: { type: 'ELLIPSE' } }
            }
          }
        }
      )
    ).toThrow(/not supported on ELLIPSE/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            variables: { minWidth: { key: 'spacing-key' } }
          }
        }
      })
    ).toThrow(/requires text or auto layout/)
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><div data-key="child" class="w-full h-[40px]"></div></div>',
        {
          bindings: {
            child: {
              variables: { width: { key: 'width-key' } }
            }
          }
        }
      )
    ).toThrow(/Width variable .* fixed width fallback/)
    expect(() =>
      parse(
        '<div data-key="root" class="flex flex-row w-[320px] h-[200px]"><div data-key="child" class="w-[40px] h-full"></div></div>',
        {
          bindings: {
            child: {
              variables: { height: { key: 'height-key' } }
            }
          }
        }
      )
    ).toThrow(/Height variable .* fixed height fallback/)
  })

  it('rejects incompatible style bindings', () => {
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            styles: { text: { key: 'heading-style' } }
          }
        }
      })
    ).toThrow(/not supported on FRAME/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            styles: { stroke: { key: 'border-style' } }
          }
        }
      })
    ).toThrow(/requires border/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px] bg-[#FFFFFF]"></div>', {
        bindings: {
          root: {
            variables: { fill: { key: 'surface-variable' } },
            styles: { fill: { key: 'surface-style' } }
          }
        }
      })
    ).toThrow(/cannot be combined/)
    expect(() =>
      parse('<div data-key="root" class="w-[320px] h-[200px]"></div>', {
        bindings: {
          root: {
            variables: { fill: null },
            styles: { fill: { key: 'surface-style' } }
          }
        }
      })
    ).toThrow(/cannot be combined/)
  })

  it('enforces the shared node and depth limits', () => {
    const children = Array.from(
      { length: 99 },
      (_, index) => `<span data-key="item-${index}" class="w-full h-fit">${index}</span>`
    ).join('')
    expect(() =>
      parse(`<div data-key="root" class="flex flex-col w-[320px] h-[200px]">${children}</div>`)
    ).not.toThrow()
    expect(() =>
      parse(
        `<div data-key="root" class="flex flex-col w-[320px] h-[200px]">${children}<span data-key="overflow" class="w-full h-fit">overflow</span></div>`
      )
    ).toThrow(/more than 100.*Keep one root.*omitted siblings are preserved/)

    expect(() =>
      parse(
        '<div data-key="one" class="w-[10px] h-[10px]"></div><div data-key="two" class="w-[10px] h-[10px]"></div>'
      )
    ).toThrow(/exactly one root.*partial update.*omitted siblings are preserved/)

    let nested = '<span data-key="depth-12" class="w-full h-fit">End</span>'
    for (let depth = 11; depth >= 2; depth -= 1) {
      nested = `<div data-key="depth-${depth}" class="flex flex-col w-full h-[10px]">${nested}</div>`
    }
    expect(() =>
      parse(`<div data-key="depth-1" class="flex flex-col w-[320px] h-[200px]">${nested}</div>`)
    ).not.toThrow()
    expect(() =>
      parse(
        `<div data-key="depth-1" class="flex flex-col w-[320px] h-[200px]"><div data-key="extra" class="flex flex-col w-full h-[10px]">${nested}</div></div>`
      )
    ).toThrow(/at most 12 levels/)

    const excessiveMarkup = `${'<div>'.repeat(5_000)}${'</div>'.repeat(5_000)}`
    expect(() => parse(excessiveMarkup)).toThrow(/at most 12 levels/)
  })
})
