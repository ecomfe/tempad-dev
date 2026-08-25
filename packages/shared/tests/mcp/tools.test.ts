import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ApplyCanvasParametersSchema as ApplyCanvasPublicParametersSchema,
  ApplyCanvasResultSchema,
  CanvasResolvedApplyParametersSchema as ApplyCanvasParametersSchema,
  AssetDescriptorSchema,
  GetAssetsParametersSchema,
  GetAssetsResultSchema,
  GetCodeParametersSchema,
  GetDesignSystemParametersSchema,
  GetDesignSystemResultSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  GetTokenDefsParametersSchema,
  MAX_CANVAS_NODES,
  UploadAssetParametersSchema,
  UploadAssetResultSchema
} from '../../src/mcp/tools'

const ASSET_HASH = 'a'.repeat(64)
const OTHER_ASSET_HASH = 'b'.repeat(64)

function acceptsCanvas(value: unknown): boolean {
  return ApplyCanvasParametersSchema.safeParse(value).success
}

describe('mcp/tools AssetDescriptorSchema', () => {
  it('accepts a valid asset descriptor', () => {
    const parsed = AssetDescriptorSchema.safeParse({
      hash: ASSET_HASH,
      url: 'https://example.com/a.png',
      localPath: '/tmp/tempad-dev/assets/a.png',
      mimeType: 'image/png',
      size: 1024,
      width: 300,
      height: 200,
      themeable: true,
      figmaImageHash: 'native-image-hash',
      figmaImageHashes: ['native-preview-image-hash'],
      figmaVideoHashes: ['native-video-hash']
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects invalid descriptor fields', () => {
    const invalidSize = AssetDescriptorSchema.safeParse({
      hash: ASSET_HASH,
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      size: -1
    })
    expect(invalidSize.success).toBe(false)
    expect(
      AssetDescriptorSchema.safeParse({
        hash: 'not-a-hash',
        url: 'https://example.com/a.png',
        mimeType: 'image/png',
        size: 1
      }).success
    ).toBe(false)
    expect(
      AssetDescriptorSchema.safeParse({
        hash: 'deadbeef',
        url: 'https://example.com/a.png',
        mimeType: 'image/png',
        size: 1,
        figmaImageHashes: []
      }).success
    ).toBe(false)
  })
})

describe('mcp/tools upload_asset schemas', () => {
  it('accepts a generated image data URL and bounded result', () => {
    expect(
      UploadAssetParametersSchema.parse({ dataUrl: 'data:image/png;base64,aGVsbG8=' })
    ).toEqual({ dataUrl: 'data:image/png;base64,aGVsbG8=' })
    expect(
      UploadAssetResultSchema.parse({
        assetHash: ASSET_HASH,
        mimeType: 'image/png',
        size: 5
      })
    ).toEqual({ assetHash: ASSET_HASH, mimeType: 'image/png', size: 5 })
  })

  it('rejects unsupported or malformed generated image inputs', () => {
    expect(
      UploadAssetParametersSchema.safeParse({ dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })
        .success
    ).toBe(false)
    expect(
      UploadAssetParametersSchema.safeParse({ dataUrl: 'data:image/png;base64,not base64' }).success
    ).toBe(false)
    expect(
      UploadAssetParametersSchema.safeParse({
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        extra: true
      }).success
    ).toBe(false)
  })
})

describe('mcp/tools canvas authoring schemas', () => {
  it('keeps the model-facing apply schema compact', () => {
    const schema = z.toJSONSchema(ApplyCanvasPublicParametersSchema)
    expect(Buffer.byteLength(JSON.stringify(schema))).toBeLessThan(8 * 1024)
  })

  it.each(['variableCollections', 'styles', 'assets', 'page'])(
    'exposes %s as an object at the public boundary',
    (field) => {
      expect(
        ApplyCanvasPublicParametersSchema.safeParse({
          mode: 'create',
          markup: '<div data-key="root" class="w-[1px] h-[1px]"></div>',
          [field]: 'opaque'
        }).success
      ).toBe(false)
    }
  )

  it('accepts compact SVG and content-addressed image declarations', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="w-[320px] h-[200px]"><div data-key="icon" class="absolute left-[0px] top-[0px] w-[24px] h-[24px]"></div></div>',
        assets: {
          icon: {
            type: 'SVG',
            svg: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>'
          },
          hero: { type: 'IMAGE', assetHash: ASSET_HASH }
        },
        bindings: {
          root: {
            figma: {
              fills: [{ type: 'IMAGE', assetKey: 'hero', scaleMode: 'FILL' }]
            }
          },
          icon: {
            figma: { svg: { assetKey: 'icon', color: '#336699' } }
          }
        }
      })
    ).toBe(true)
    expect(
      ApplyCanvasPublicParametersSchema.safeParse({
        mode: 'create',
        markup: '<div data-key="root" class="w-[24px] h-[24px]"></div>',
        assets: { icon: { type: 'SVG', svg: '<svg />' } },
        native: { root: { figma: { svg: { assetKey: 'icon' } } } }
      }).success
    ).toBe(true)
  })

  it.each([
    {
      assets: { hero: { type: 'IMAGE', assetHash: 'short' } },
      bindings: {
        root: { figma: { fills: [{ type: 'IMAGE', assetKey: 'hero', scaleMode: 'FILL' }] } }
      }
    },
    {
      assets: { icon: { type: 'SVG', svg: '<svg />', extra: true } },
      bindings: { root: { figma: { svg: { assetKey: 'icon' } } } }
    },
    {
      assets: { hero: { type: 'IMAGE', assetHash: ASSET_HASH } },
      bindings: {
        root: {
          figma: {
            fills: [
              {
                type: 'IMAGE',
                assetKey: 'hero',
                imageUrl: 'https://example.com/a.png',
                scaleMode: 'FILL'
              }
            ]
          }
        }
      }
    },
    {
      assets: { icon: { type: 'SVG', svg: '<svg />' } },
      bindings: {
        root: {
          figma: {
            shape: { type: 'RECTANGLE' },
            svg: { assetKey: 'icon' }
          }
        }
      }
    }
  ])('rejects invalid asset desired state %#', ({ assets, bindings }) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[24px] h-[24px]"></div>',
        assets,
        bindings
      })
    ).toBe(false)
  })

  it('accepts inline catalog refs and exact live component ids', () => {
    const result = ApplyCanvasPublicParametersSchema.safeParse({
      mode: 'create',
      catalogId: 'ds_1',
      markup:
        '<Button data-key="save" data-ref="c1" data-var-opacity="v1" data-style-effect="s1" label="Save" />',
      native: {
        save: {
          variables: { width: { variableKey: 'button/width' } },
          variableModes: { k1: 'm1_1' },
          styles: { grid: { styleKey: 'button/grid' } },
          figma: { locked: true }
        }
      }
    })
    expect(result.success).toBe(true)
    expect(
      ApplyCanvasPublicParametersSchema.safeParse({
        mode: 'create',
        markup: '<div data-key="save" class="w-[120px] h-[40px]"></div>',
        native: {
          save: {
            component: { id: '1:2' },
            componentProperties: { label: 'Save', disabled: false }
          }
        }
      }).success
    ).toBe(true)
    expect(
      ApplyCanvasPublicParametersSchema.safeParse({
        mode: 'create',
        markup: '<div data-key="save" class="w-[120px] h-[40px]"></div>',
        native: {
          save: {
            component: { key: 'button-key' }
          }
        }
      }).success
    ).toBe(false)
  })

  it('accepts restricted markup with component, variable, style, and Figma bindings', () => {
    expect(GetDesignSystemParametersSchema.safeParse({}).success).toBe(true)
    expect(GetDesignSystemParametersSchema.safeParse({ targetNodeId: '1:2' }).success).toBe(false)
    expect(
      GetDesignSystemParametersSchema.safeParse({
        catalogId: 'ds_1',
        ref: 'c1'
      }).success
    ).toBe(true)
    expect(
      GetDesignSystemParametersSchema.safeParse({
        catalogId: 'ds_1',
        cursor: 12
      }).success
    ).toBe(true)
    expect(GetDesignSystemParametersSchema.safeParse({ ref: 'c1' }).success).toBe(false)
    expect(GetDesignSystemParametersSchema.safeParse({ catalogId: 'ds_1' }).success).toBe(false)
    expect(
      GetDesignSystemParametersSchema.safeParse({
        catalogId: 'ds_1',
        cursor: 1,
        ref: 'c1'
      }).success
    ).toBe(false)
    expect(
      GetDesignSystemParametersSchema.safeParse({
        catalogId: 'ds_1',
        ref: 'c1',
        targetNodeId: '1:2'
      }).success
    ).toBe(false)
    expect(GetDesignSystemParametersSchema.safeParse({ extra: true }).success).toBe(false)

    expect(
      acceptsCanvas({
        mode: 'create',
        markup:
          '<div data-key="settings/card" class="flex flex-col w-[320px] h-[200px]"><span data-key="settings/card/title" class="w-full h-fit">Settings</span><div data-key="settings/card/action" class="w-full h-fit"></div></div>',
        bindings: {
          'settings/card': {
            variables: {
              fill: { key: 'color-key' },
              visible: { id: 'VariableID:visible' },
              gap: { id: 'VariableID:1' },
              counterAxisSpacing: { id: 'VariableID:2' },
              gridRowGap: { id: 'VariableID:5' },
              gridColumnGap: { id: 'VariableID:6' },
              minWidth: { id: 'VariableID:3' },
              maxHeight: { id: 'VariableID:4' },
              topLeftRadius: { id: 'VariableID:7' },
              strokeRightWeight: { id: 'VariableID:8' }
            },
            styles: {
              fill: null,
              effect: { id: 'StyleID:1' },
              grid: { key: 'grid-style-key' }
            },
            figma: {
              name: 'Settings card',
              locked: true,
              aspectRatioLocked: true
            }
          },
          'settings/card/title': {
            variables: {
              characters: { id: 'VariableID:characters' },
              fontWeight: { id: 'VariableID:weight' },
              paragraphIndent: { id: 'VariableID:indent' },
              paragraphSpacing: { id: 'VariableID:paragraph-spacing' }
            },
            figma: {
              text: {
                autoRename: false,
                verticalAlign: 'CENTER',
                case: 'SMALL_CAPS',
                paragraphIndent: 12,
                paragraphSpacing: 16,
                listSpacing: 8,
                hangingPunctuation: true,
                hangingList: false,
                leadingTrim: 'CAP_HEIGHT',
                hyperlink: { type: 'URL', value: 'https://example.com' }
              }
            }
          },
          'settings/card/action': {
            component: { id: 'ComponentID:1' },
            componentProperties: {
              Label: { variable: { id: 'VariableID:label' } },
              Disabled: false
            },
            figma: {
              instance: {
                scaleFactor: 1.25,
                exposed: false,
                preserveOverrides: false
              }
            }
          }
        }
      })
    ).toBe(true)
  })

  it('accepts a binding containing only typed Figma properties', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: { locked: false }
          }
        }
      })
    ).toBe(true)
  })

  it('accepts native section state and rejects conflicting node kinds', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="review" class="w-[1200px] h-[900px]"></div>',
      bindings: {
        review: {
          figma: {
            name: 'Review',
            section: { contentsHidden: false }
          }
        }
      }
    }

    expect(acceptsCanvas(input)).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          review: {
            figma: {
              section: {},
              shape: { type: 'RECTANGLE' }
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          review: {
            component: { id: 'ComponentID:1' },
            figma: { section: {} }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts native groups and boolean operations as exclusive node kinds', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="composite" class="w-fit h-fit"></div>',
      bindings: {
        composite: {
          figma: { booleanOperation: 'SUBTRACT' }
        }
      }
    }

    expect(acceptsCanvas(input)).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          composite: {
            figma: { group: true }
          }
        }
      })
    ).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          composite: {
            figma: {
              booleanOperation: 'UNION',
              group: true
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          composite: {
            component: { id: 'ComponentID:1' },
            figma: { group: true }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts authored components with publishable metadata as an exclusive node kind', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="button" class="w-[160px] h-[40px]"></div>',
      bindings: {
        button: {
          figma: {
            component: {
              type: 'COMPONENT',
              descriptionMarkdown: '**Reusable** button',
              documentationLink: 'https://example.com/button'
            }
          }
        }
      }
    }

    expect(acceptsCanvas(input)).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          button: {
            figma: {
              component: {
                type: 'COMPONENT_SET',
                documentationLink: null
              }
            }
          }
        }
      })
    ).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          button: {
            component: { id: 'ComponentID:1' },
            figma: { component: { type: 'COMPONENT' } }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          button: {
            figma: {
              component: {
                type: 'COMPONENT',
                documentationLink: 'not a URL'
              }
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          button: {
            figma: {
              component: { type: 'COMPONENT' },
              descriptionMarkdown: '**Misnested** metadata'
            }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts declarative component definitions, sublayer references, and native slots', () => {
    const input = {
      mode: 'create',
      markup:
        '<div data-key="card" class="w-[320px] h-[200px]"><span data-key="title" class="w-fit h-fit">Card</span><div data-key="content" class="w-[280px] h-[120px]"></div></div>',
      bindings: {
        card: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: {
                title: {
                  type: 'TEXT',
                  name: 'Title',
                  defaultValue: { variable: { id: 'VariableID:title' } }
                },
                visible: {
                  type: 'BOOLEAN',
                  name: 'Show title',
                  defaultValue: true
                },
                icon: {
                  type: 'INSTANCE_SWAP',
                  name: 'Icon',
                  defaultValue: { id: 'ComponentID:icon' },
                  preferredValues: [
                    { type: 'COMPONENT', key: 'icon-key' },
                    { type: 'COMPONENT_SET', key: 'icon-set-key' }
                  ]
                },
                removed: null
              }
            }
          }
        },
        title: {
          figma: {
            componentPropertyReferences: {
              characters: 'title',
              visible: 'visible'
            }
          }
        },
        content: {
          figma: {
            slot: {
              property: {
                name: 'Content',
                description: 'Place card content here.',
                preferredValues: [{ type: 'COMPONENT', key: 'content-key' }],
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

    expect(acceptsCanvas(input)).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          ...input.bindings,
          card: {
            figma: {
              component: {
                type: 'COMPONENT',
                properties: {}
              }
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          ...input.bindings,
          content: {
            figma: {
              slot: {
                property: {
                  name: 'Content',
                  settings: { minChildren: 2, maxChildren: 1 }
                }
              }
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          ...input.bindings,
          title: {
            figma: {
              componentPropertyReferences: {}
            }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts an empty layer name and rejects a fixed name with text auto-rename', () => {
    const input = {
      mode: 'create',
      markup: '<span data-key="label">Label</span>',
      bindings: {
        label: {
          figma: { name: '' }
        }
      }
    }

    expect(acceptsCanvas(input)).toBe(true)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          label: {
            figma: {
              name: 'Fixed label',
              text: { autoRename: true }
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            component: { id: 'ComponentID:1' },
            figma: { instance: {} }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            component: { id: 'ComponentID:1' },
            figma: { instance: { scaleFactor: 0 } }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            component: { id: 'ComponentID:1' },
            figma: { instance: { preserveOverrides: 'no' } }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts every native mask state and rejects unknown mask types', () => {
    const input = (mask: unknown) => ({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-row w-[200px] h-[200px]"><div data-key="mask" class="w-[100px] h-[100px]"></div><div data-key="content" class="w-[100px] h-[100px]"></div></div>',
      bindings: {
        mask: {
          figma: { mask }
        }
      }
    })

    for (const mask of ['ALPHA', 'VECTOR', 'LUMINANCE', null]) {
      expect(acceptsCanvas(input(mask))).toBe(true)
    }
    expect(acceptsCanvas(input('CLIP'))).toBe(false)
  })

  it('accepts path and complete network representations for native vectors', () => {
    const input = (shape: unknown) => ({
      mode: 'create',
      markup: '<div data-key="vector" class="w-[100px] h-[100px]"></div>',
      bindings: { vector: { figma: { shape } } }
    })

    expect(
      acceptsCanvas(
        input({
          type: 'VECTOR',
          paths: [{ windingRule: 'EVENODD', data: 'M 0 100 L 100 100 L 50 0 Z' }],
          handleMirroring: 'ANGLE'
        })
      )
    ).toBe(true)
    expect(
      acceptsCanvas(
        input({
          type: 'VECTOR',
          network: {
            vertices: [
              {
                x: 0,
                y: 100,
                strokeCap: 'ROUND',
                strokeJoin: 'BEVEL',
                cornerRadius: 4,
                handleMirroring: 'ANGLE_AND_LENGTH'
              },
              { x: 100, y: 100 },
              { x: 50, y: 0 }
            ],
            segments: [
              { start: 0, end: 1, tangentStart: { x: 0, y: 0 } },
              { start: 1, end: 2, tangentEnd: { x: 0, y: 0 } },
              { start: 2, end: 0 }
            ],
            regions: [
              {
                windingRule: 'NONZERO',
                loops: [[0, 1, 2]],
                fillStyle: { key: 'brand-fill-style' }
              }
            ]
          },
          handleMirroring: 'NONE'
        })
      )
    ).toBe(true)
  })

  it.each([
    {
      type: 'VECTOR',
      paths: [],
      network: { vertices: [], segments: [] }
    },
    {
      type: 'VECTOR',
      network: { vertices: [{ x: 0, y: 0 }], segments: [{ start: 0, end: 1 }] }
    },
    {
      type: 'VECTOR',
      network: {
        vertices: [{ x: 0, y: 0 }],
        segments: [{ start: 0, end: 0 }],
        regions: [{ windingRule: 'NONZERO', loops: [[1]] }]
      }
    },
    {
      type: 'VECTOR',
      network: {
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 }
        ],
        segments: [
          { start: 0, end: 1 },
          { start: 2, end: 3 }
        ],
        regions: [{ windingRule: 'EVENODD', loops: [[0, 1]] }]
      }
    },
    {
      type: 'VECTOR',
      network: {
        vertices: [{ x: 0, y: 0 }],
        segments: [{ start: 0, end: 0 }],
        regions: [
          {
            windingRule: 'NONZERO',
            loops: [[0]],
            fills: [],
            fillStyle: { id: 'style:fill' }
          }
        ]
      }
    }
  ])('rejects invalid vector geometry %#', (shape) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="vector" class="w-[100px] h-[100px]"></div>',
        bindings: { vector: { figma: { shape } } }
      })
    ).toBe(false)
  })

  it('accepts explicit variable unbinding and node mode overrides', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            variables: {
              fill: null,
              width: null,
              cornerRadius: null
            },
            variableModes: {
              'VariableCollectionId:theme': 'mode:dark',
              'VariableCollectionId:density': null
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([{}, { 'collection:theme': '' }])(
    'rejects invalid variable mode overrides %#',
    (variableModes) => {
      expect(
        acceptsCanvas({
          mode: 'create',
          markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
          bindings: { root: { variableModes } }
        })
      ).toBe(false)
    }
  )

  it('accepts explicit state for the page containing the result', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        page: {
          id: '0:2',
          pageKey: 'flows/checkout',
          name: 'Checkout',
          index: 0,
          background: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 },
          guides: [
            { axis: 'X', offset: 24 },
            { axis: 'Y', offset: -8 }
          ],
          variableModes: {
            'VariableCollectionId:theme': 'mode:dark',
            'VariableCollectionId:density': null
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    {},
    { pageKey: 'invalid page key' },
    { index: -1 },
    { index: 0.5 },
    { background: { r: 0, g: 0, b: 0, a: 1.1 } },
    { guides: [{ axis: 'Z', offset: 0 }] },
    { variableModes: {} }
  ])('rejects invalid page state %#', (page) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        page
      })
    ).toBe(false)
  })

  it.each([
    { type: 'RECTANGLE' },
    { type: 'LINE' },
    {
      type: 'ELLIPSE',
      arc: { startAngle: 0, endAngle: 270, innerRadius: 0 }
    },
    { type: 'POLYGON', pointCount: 6 },
    { type: 'STAR', pointCount: 7, innerRadius: 1 }
  ])('accepts native shape state %#', (shape) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma: { shape } } }
      })
    ).toBe(true)
  })

  it.each([
    { type: 'TRIANGLE' },
    { type: 'ELLIPSE', arc: { startAngle: 0, endAngle: 180, innerRadius: -0.1 } },
    { type: 'ELLIPSE', arc: { startAngle: 0, endAngle: 180 } },
    {
      type: 'ELLIPSE',
      arc: { startAngle: Number.POSITIVE_INFINITY, endAngle: 180, innerRadius: 0 }
    },
    { type: 'POLYGON', pointCount: 2 },
    { type: 'POLYGON', pointCount: 3.5 },
    { type: 'POLYGON', pointCount: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'STAR', pointCount: 2 },
    { type: 'STAR', innerRadius: 1.1 }
  ])('rejects invalid native shape state %#', (shape) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma: { shape } } }
      })
    ).toBe(false)
  })

  it('accepts local variable resources and stable references in one desired result', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px] bg-white"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            hiddenFromPublishing: false,
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
                codeSyntax: {
                  WEB: '--color-surface',
                  ANDROID: null
                },
                values: {
                  light: { r: 1, g: 1, b: 1 },
                  dark: { variable: { variableKey: 'tokens' } }
                }
              },
              tokens: {
                name: 'Color/Surface Dark',
                type: 'COLOR',
                values: {
                  light: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
                  dark: { r: 0, g: 0, b: 0 }
                }
              }
            }
          },
          brand: {
            name: 'Brand',
            extends: { collectionKey: 'tokens' },
            overrides: [
              {
                variable: { variableKey: 'surface' },
                values: {
                  light: { r: 0.8, g: 0.2, b: 0.1 },
                  dark: null
                }
              }
            ]
          }
        },
        page: {
          variableModes: { tokens: 'dark' }
        },
        bindings: {
          root: {
            variables: {
              fill: { variableKey: 'surface' }
            }
          }
        }
      })
    ).toBe(true)
  })

  it('accepts explicit managed variable resource removal', () => {
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: 'node:root',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        variableCollections: {
          obsolete: null,
          tokens: {
            modes: { contrast: null },
            variables: { legacy: null }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    ['all scopes plus a specific scope', ['ALL_SCOPES', 'GAP']],
    ['all fills plus a specific fill scope', ['ALL_FILLS', 'TEXT_FILL']]
  ])('rejects invalid variable scope combinations: %s', (_name, scopes) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { light: { name: 'Light' } },
            variables: {
              color: {
                name: 'Color',
                type: 'COLOR',
                scopes,
                values: { light: { r: 1, g: 1, b: 1 } }
              }
            }
          }
        }
      })
    ).toBe(false)
  })

  it('allows ALL_FILLS with non-fill color scopes', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        variableCollections: {
          tokens: {
            name: 'Tokens',
            modes: { light: { name: 'Light' } },
            variables: {
              color: {
                name: 'Color',
                type: 'COLOR',
                scopes: ['ALL_FILLS', 'STROKE_COLOR'],
                values: { light: { r: 1, g: 1, b: 1 } }
              }
            }
          }
        }
      })
    ).toBe(true)
  })

  it('rejects malformed or ambiguous local variable resources', () => {
    const base = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    }
    for (const variableCollections of [
      {},
      { tokens: {} },
      { tokens: { name: 'Tokens', modes: { light: {} } } },
      {
        first: {
          name: 'First',
          variables: {
            duplicate: { name: 'Duplicate', type: 'FLOAT' }
          }
        },
        second: {
          name: 'Second',
          variables: {
            duplicate: { name: 'Duplicate again', type: 'FLOAT' }
          }
        }
      },
      {
        tokens: {
          name: 'Tokens',
          variables: {
            spacing: {
              name: 'Spacing',
              type: 'FLOAT',
              scopes: ['NOT_A_SCOPE']
            }
          }
        }
      },
      { brand: { name: 'Brand', extends: {} } },
      {
        brand: {
          name: 'Brand',
          extends: { collectionKey: 'tokens' },
          overrides: []
        }
      },
      {
        brand: {
          name: 'Brand',
          extends: { collectionKey: 'tokens' },
          overrides: [{ variable: { variableKey: 'surface' }, values: {} }]
        }
      }
    ]) {
      expect(acceptsCanvas({ ...base, variableCollections })).toBe(false)
    }
    expect(
      acceptsCanvas({
        ...base,
        bindings: {
          root: {
            variables: {
              fill: { id: 'variable:1', variableKey: 'surface' }
            }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts local style resources and stable references in one desired result', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex flex-col w-[320px] h-[200px] border-[1px]"><span data-key="title" class="w-fit h-fit">Title</span></div>',
        styles: {
          surface: {
            type: 'PAINT',
            name: 'Surface',
            descriptionMarkdown: 'Default **surface**',
            documentationLink: 'https://example.com/styles/surface',
            paints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
          },
          body: {
            type: 'TEXT',
            name: 'Typography/Body',
            fontName: { family: 'Inter', style: 'Regular' },
            fontSize: 16,
            lineHeight: { unit: 'PIXELS', value: 24 },
            letterSpacing: { unit: 'PERCENT', value: 0 },
            variables: { fontSize: { variableKey: 'font-size-body' } }
          },
          raised: {
            type: 'EFFECT',
            name: 'Elevation/Raised',
            effects: []
          },
          columns: {
            type: 'GRID',
            name: 'Grid/Columns',
            layoutGrids: []
          },
          obsolete: null
        },
        bindings: {
          root: {
            styles: {
              fill: { styleKey: 'surface' },
              effect: { styleKey: 'raised' },
              grid: { styleKey: 'columns' }
            }
          },
          title: {
            styles: { text: { styleKey: 'body' } }
          }
        }
      })
    ).toBe(true)
  })

  it('rejects malformed style resources and ambiguous style references', () => {
    const base = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    }
    for (const styles of [
      {},
      { surface: { name: 'Surface' } },
      { body: { type: 'TEXT', name: 'Body', fontName: { family: '', style: 'Regular' } } },
      {
        surface: {
          type: 'PAINT',
          name: 'Surface',
          documentationLink: 'not-a-url'
        }
      }
    ]) {
      expect(acceptsCanvas({ ...base, styles })).toBe(false)
    }
    expect(
      acceptsCanvas({
        ...base,
        bindings: {
          root: {
            styles: {
              fill: { id: 'style:1', styleKey: 'surface' }
            }
          }
        }
      })
    ).toBe(false)
  })

  it('rejects native shapes combined with text or component bindings', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
    }
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          root: {
            figma: {
              shape: { type: 'RECTANGLE' },
              text: { verticalAlign: 'CENTER' }
            }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        ...input,
        bindings: {
          root: {
            component: { id: 'ComponentID:1' },
            figma: { shape: { type: 'RECTANGLE' } }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts complete native stroke and corner geometry', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              stroke: {
                weights: { top: 1, right: 2, bottom: 3, left: 4 },
                align: 'INSIDE',
                cap: 'ARROW_EQUILATERAL',
                join: 'BEVEL',
                miterLimit: 4,
                dashPattern: [8, 4, 2]
              },
              corners: {
                radii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
                smoothing: 0.6
              }
            }
          }
        }
      })
    ).toBe(true)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              stroke: { weight: 0, dashPattern: [] },
              corners: { radius: 0, smoothing: 1 }
            }
          }
        }
      })
    ).toBe(true)
  })

  it('accepts native linear Auto Layout, layout grids, variables, and frame guides', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="flex flex-row flex-wrap w-[320px] h-[200px]"></div>',
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
                    count: { id: 'VariableID:count' },
                    gutterSize: { id: 'VariableID:gutter' },
                    offset: { id: 'VariableID:offset' },
                    sectionSize: { id: 'VariableID:section' }
                  }
                },
                {
                  pattern: 'ROWS',
                  alignment: 'CENTER',
                  gutterSize: 8,
                  count: 'AUTO',
                  sectionSize: 40
                },
                {
                  pattern: 'GRID',
                  sectionSize: 8,
                  variables: {
                    sectionSize: { key: 'grid-size-key' }
                  }
                }
              ],
              guides: [
                { axis: 'X', offset: 24 },
                { axis: 'Y', offset: -8 }
              ]
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    { autoLayout: {} },
    { autoLayout: { itemSpacing: Number.POSITIVE_INFINITY } },
    { autoLayout: { counterAxisSpacing: 0 } },
    { layoutGrids: [{ pattern: 'GRID', sectionSize: 8, variables: {} }] },
    {
      layoutGrids: [
        {
          pattern: 'GRID',
          sectionSize: 8,
          variables: { count: { id: 'VariableID:count' } }
        }
      ]
    },
    {
      layoutGrids: [
        {
          pattern: 'COLUMNS',
          alignment: 'STRETCH',
          gutterSize: 16,
          count: 12,
          sectionSize: 80
        }
      ]
    },
    {
      layoutGrids: [
        {
          pattern: 'ROWS',
          alignment: 'CENTER',
          gutterSize: 8,
          count: 4,
          variables: { offset: { id: 'VariableID:offset' } }
        }
      ]
    },
    {
      layoutGrids: [
        {
          pattern: 'COLUMNS',
          alignment: 'MIN',
          gutterSize: 0,
          count: 0
        }
      ]
    },
    { guides: [{ axis: 'Z', offset: 0 }] },
    { guides: [{ axis: 'X', offset: Number.NaN }] }
  ])('rejects invalid native layout state %#', (figma) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma } }
      })
    ).toBe(false)
  })

  it('accepts native translation, rotation, and skew with unit transform axes', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              relativeTransform: [
                [1, 0.6, 24],
                [0, 0.8, -12]
              ]
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    {
      relativeTransform: [
        [2, 0, 0],
        [0, 1, 0]
      ]
    },
    {
      relativeTransform: [
        [1, 0, Number.NaN],
        [0, 1, 0]
      ]
    }
  ])('rejects invalid native relative transform %#', ({ relativeTransform }) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma: { relativeTransform } } }
      })
    ).toBe(false)
  })

  it('accepts every native Figma paint type and its mode-specific fields', () => {
    const gradient = (type: string) => ({
      type,
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      gradientStops: [
        {
          position: 0,
          color: { r: 1, g: 0, b: 0, a: 1 },
          variables: { color: { key: 'gradient-color' } }
        },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } }
      ]
    })
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              fills: [
                {
                  type: 'SOLID',
                  color: { r: 1, g: 0, b: 0 },
                  visible: false,
                  opacity: 0.5,
                  blendMode: 'MULTIPLY',
                  variables: { color: { id: 'VariableID:solid' } }
                },
                gradient('GRADIENT_LINEAR'),
                gradient('GRADIENT_RADIAL'),
                gradient('GRADIENT_ANGULAR'),
                gradient('GRADIENT_DIAMOND'),
                {
                  type: 'IMAGE',
                  imageHash: 'image-fill',
                  scaleMode: 'FILL',
                  rotation: 90,
                  filters: { exposure: -1, shadows: 1 }
                },
                {
                  type: 'IMAGE',
                  imageUrl: 'https://images.example.com/cover.png',
                  scaleMode: 'FIT'
                },
                {
                  type: 'IMAGE',
                  imageHash: null,
                  scaleMode: 'CROP',
                  imageTransform: [
                    [1, 0, 0.25],
                    [0, 1, 0.5]
                  ]
                },
                {
                  type: 'IMAGE',
                  imageHash: 'image-tile',
                  scaleMode: 'TILE',
                  scalingFactor: 0.5,
                  rotation: -90
                },
                {
                  type: 'VIDEO',
                  videoHash: 'video-fit',
                  scaleMode: 'FIT',
                  filters: { contrast: 0.25 }
                },
                {
                  type: 'VIDEO',
                  videoUrl: 'https://media.example.com/demo.webm',
                  scaleMode: 'FIT'
                },
                {
                  type: 'VIDEO',
                  videoHash: null,
                  scaleMode: 'CROP',
                  videoTransform: [
                    [1, 0, 0],
                    [0, 1, 0]
                  ]
                },
                {
                  type: 'VIDEO',
                  videoHash: 'video-tile',
                  scaleMode: 'TILE',
                  scalingFactor: 2,
                  rotation: 180
                },
                {
                  type: 'PATTERN',
                  sourceNodeId: '1:2',
                  tileType: 'HORIZONTAL_HEXAGONAL',
                  scalingFactor: 0.75,
                  spacing: { x: 8, y: 12 },
                  horizontalAlignment: 'CENTER'
                },
                {
                  type: 'PATTERN',
                  sourceCanvasKey: 'pattern/source',
                  tileType: 'RECTANGULAR',
                  scalingFactor: 1,
                  spacing: { x: 0, y: 0 },
                  horizontalAlignment: 'START'
                },
                {
                  type: 'SHADER',
                  id: 'shader:fill',
                  properties: {
                    strength: 0.5,
                    tint: { variable: { key: 'shader-color' } }
                  }
                }
              ],
              strokes: []
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1.1 },
    {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      gradientStops: [{ position: -0.1, color: { r: 0, g: 0, b: 0, a: 1 } }]
    },
    { type: 'IMAGE', imageHash: 'image', scaleMode: 'CROP', rotation: 90 },
    {
      type: 'IMAGE',
      imageHash: 'image',
      scaleMode: 'TILE',
      imageTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ]
    },
    { type: 'IMAGE', imageHash: 'image', scaleMode: 'FIT', scalingFactor: 1 },
    { type: 'IMAGE', scaleMode: 'FILL' },
    {
      type: 'IMAGE',
      imageHash: 'image',
      imageUrl: 'https://images.example.com/image.png',
      scaleMode: 'FILL'
    },
    { type: 'IMAGE', imageUrl: 'file:///tmp/image.png', scaleMode: 'FILL' },
    { type: 'IMAGE', imageUrl: 'not a URL', scaleMode: 'FILL' },
    { type: 'VIDEO', videoHash: 'video', scaleMode: 'FILL', rotation: 45 },
    { type: 'VIDEO', videoHash: '', scaleMode: 'FIT' },
    { type: 'VIDEO', scaleMode: 'FIT' },
    {
      type: 'VIDEO',
      videoHash: 'video',
      videoUrl: 'https://media.example.com/demo.mp4',
      scaleMode: 'FIT'
    },
    { type: 'VIDEO', videoUrl: 'file:///tmp/demo.mp4', scaleMode: 'FIT' },
    { type: 'IMAGE', imageHash: null, scaleMode: 'FILL', filters: {} },
    {
      type: 'PATTERN',
      sourceNodeId: '',
      tileType: 'RECTANGULAR',
      scalingFactor: 1,
      spacing: { x: 0, y: 0 },
      horizontalAlignment: 'START'
    },
    {
      type: 'PATTERN',
      sourceNodeId: '1:2',
      sourceCanvasKey: 'source',
      tileType: 'RECTANGULAR',
      scalingFactor: 1,
      spacing: { x: 0, y: 0 },
      horizontalAlignment: 'START'
    },
    {
      type: 'PATTERN',
      tileType: 'RECTANGULAR',
      scalingFactor: 1,
      spacing: { x: 0, y: 0 },
      horizontalAlignment: 'START'
    },
    { type: 'SHADER', id: '' }
  ])('rejects invalid native paint state %#', (paint) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma: { fills: [paint] } } }
      })
    ).toBe(false)
  })

  it('accepts the complete native Figma effect union and effect variables', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              effects: [
                {
                  type: 'DROP_SHADOW',
                  color: { r: 0, g: 0, b: 0, a: 0.25 },
                  offset: { x: 0, y: 4 },
                  radius: 8,
                  spread: -2,
                  visible: true,
                  blendMode: 'MULTIPLY',
                  showShadowBehindNode: true,
                  variables: {
                    color: { key: 'shadow-color' },
                    radius: { id: 'VariableID:radius' },
                    spread: { id: 'VariableID:spread' },
                    offsetX: { id: 'VariableID:x' },
                    offsetY: { id: 'VariableID:y' }
                  }
                },
                {
                  type: 'INNER_SHADOW',
                  color: { r: 1, g: 1, b: 1, a: 0.4 },
                  offset: { x: 0, y: 1 },
                  radius: 2
                },
                {
                  type: 'LAYER_BLUR',
                  blurType: 'NORMAL',
                  radius: 12,
                  variables: { radius: { id: 'VariableID:blur' } }
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
                  noiseSizeVector: { x: 2, y: 2 },
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
                  noiseSizeVector: { x: 1, y: 1 },
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
                    boolean: true,
                    text: 'value',
                    number: 1,
                    rgb: { r: 1, g: 0, b: 0 },
                    rgba: { r: 1, g: 0, b: 0, a: 0.5 },
                    point: { x: 0.5, y: 0.5 },
                    line: { x: 0, y: 0, x2: 1, y2: 1 },
                    circle: { x: 0.5, y: 0.5, radius: 0.25 },
                    circlePoint: { x: 0.5, y: 0.5, radius: 0.25, angle: 90 },
                    colorPoint: {
                      x: 0.5,
                      y: 0.5,
                      color: { variable: { key: 'shader-color' } }
                    },
                    gradient: {
                      stops: [
                        { position: 0, color: { r: 0, g: 0, b: 0 } },
                        {
                          position: 1,
                          color: { variable: { id: 'VariableID:shader-color' } }
                        }
                      ]
                    },
                    variable: { variable: { id: 'VariableID:value' } }
                  }
                }
              ]
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    [
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: -1 }
    ],
    [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: -1 }],
    [
      {
        type: 'BACKGROUND_BLUR',
        blurType: 'PROGRESSIVE',
        radius: 1,
        startRadius: 0,
        startOffset: { x: 0, y: 0 }
      }
    ],
    [
      {
        type: 'NOISE',
        noiseType: 'DUOTONE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        secondaryColor: { r: 1, g: 1, b: 1, a: 1 },
        noiseSize: 2,
        noiseSizeVector: { x: 3, y: 2 },
        density: 1
      }
    ],
    [
      {
        type: 'NOISE',
        noiseType: 'DUOTONE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        secondaryColor: { r: 1, g: 1, b: 1, a: 1 },
        noiseSize: 2,
        noiseSizeVector: { x: 2, y: 3 },
        density: 1
      }
    ],
    [
      {
        type: 'TEXTURE',
        noiseSize: 2,
        noiseSizeVector: { x: 3, y: 2 },
        radius: 1,
        clipToShape: false
      }
    ],
    [
      {
        type: 'GLASS',
        lightIntensity: 1.1,
        lightAngle: 0,
        refraction: 0,
        depth: 1,
        dispersion: 0,
        radius: 0
      }
    ],
    [{ type: 'SHADER', id: '', properties: {} }],
    [{ type: 'SHADER', id: 'shader', properties: { color: { r: 2, g: 0, b: 0 } } }],
    [{ type: 'NOISE', noiseType: 'MONOTONE', variables: { radius: { id: 'v' } } }]
  ])('rejects invalid native effect state %#', (effects) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma: { effects } } }
      })
    ).toBe(false)
  })

  it.each([
    { stroke: {} },
    { stroke: { weight: -1 } },
    { stroke: { weight: 1, weights: { top: 1, right: 1, bottom: 1, left: 1 } } },
    { stroke: { align: 'INNER' } },
    { stroke: { cap: 'ARROW' } },
    { stroke: { join: 'CURVE' } },
    { stroke: { miterLimit: 0.5 } },
    { stroke: { dashPattern: [4, -1] } },
    { corners: {} },
    { corners: { radius: -1 } },
    {
      corners: {
        radius: 1,
        radii: { topLeft: 1, topRight: 1, bottomRight: 1, bottomLeft: 1 }
      }
    },
    { corners: { smoothing: 1.1 } }
  ])('rejects invalid native stroke or corner state %#', (figma) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { root: { figma } }
      })
    ).toBe(false)
  })

  it('accepts complete ordered rich-text range state', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              text: {
                fontName: { family: 'IBM Plex Sans', style: 'Medium' },
                ranges: [
                  {
                    start: 0,
                    end: 5,
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
                        color: { r: 1, g: 0, b: 0 },
                        variables: { color: { key: 'decoration-color' } }
                      }
                    },
                    textDecorationSkipInk: true,
                    fills: [
                      {
                        type: 'SOLID',
                        color: { r: 0, g: 0, b: 0 },
                        variables: { color: { key: 'text-color' } }
                      }
                    ],
                    textStyle: { id: 'StyleID:text' },
                    listOptions: { type: 'UNORDERED' },
                    listSpacing: 8,
                    indentation: 2,
                    paragraphIndent: 12,
                    paragraphSpacing: 16,
                    hyperlink: {
                      type: 'NODE',
                      value: { canvasKey: 'link/target' }
                    },
                    variables: {
                      fontFamily: null,
                      fontSize: { id: 'VariableID:size' },
                      paragraphSpacing: { id: 'VariableID:paragraph-spacing' }
                    }
                  },
                  {
                    start: 5,
                    end: 10,
                    fillStyle: { key: 'fill-style-key' },
                    lineHeight: { unit: 'AUTO' },
                    hyperlink: null
                  }
                ]
              }
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    [[]],
    [[{ start: 0, end: 0, fontSize: 16 }]],
    [[{ start: 0, end: 1 }]],
    [
      [
        { start: 0, end: 2, fontSize: 16 },
        { start: 1, end: 3, fontSize: 18 }
      ]
    ],
    [
      [
        {
          start: 0,
          end: 1,
          fills: [],
          fillStyle: { id: 'StyleID:fill' }
        }
      ]
    ],
    [[{ start: 0, end: 1, fontSize: 0 }]],
    [[{ start: 0, end: 1, lineHeight: { unit: 'PIXELS', value: Number.NaN } }]],
    [[{ start: 0, end: 1, variables: {} }]]
  ])('rejects invalid rich-text ranges %#', (ranges) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {
              text: { ranges }
            }
          }
        }
      })
    ).toBe(false)
  })

  it.each([
    { fontName: { family: '', style: 'Regular' } },
    { verticalAlign: 'MIDDLE' },
    { case: 'CAPITALS' },
    { paragraphIndent: Number.POSITIVE_INFINITY },
    { hyperlink: { type: 'URL', value: '' } },
    { hyperlink: { type: 'NODE', value: { canvasKey: '' } } },
    { hyperlink: { type: 'EMAIL', value: 'design@example.com' } }
  ])('rejects invalid typed Figma text state %#', (text) => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: { text }
          }
        }
      })
    ).toBe(false)
  })

  it('accepts a scoped update and rejects invalid create/update scopes', () => {
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        markup: '<div data-key="root" data-node-id="1:2" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['old/child']
      })
    ).toBe(true)

    const invalidCreates = [
      {
        mode: 'create',
        targetNodeId: '1:2',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
      },
      {
        mode: 'update',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>'
      },
      {
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['old/child']
      },
      {
        mode: 'update',
        targetNodeId: '1:2',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: ['old/child', 'old/child']
      }
    ]
    for (const input of invalidCreates) {
      expect(acceptsCanvas(input)).toBe(false)
    }
  })

  it('accepts isolated update-root removal and rejects ambiguous combinations', () => {
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        markup: null
      })
    ).toBe(true)

    for (const input of [
      { mode: 'create', markup: null },
      { mode: 'update', markup: null },
      {
        mode: 'update',
        targetNodeId: '1:2',
        markup: null,
        bindings: {}
      },
      {
        mode: 'update',
        targetNodeId: '1:2',
        markup: null,
        removeKeys: []
      },
      {
        mode: 'update',
        targetNodeId: '1:2',
        markup: null,
        page: { name: 'Archive' }
      },
      {
        mode: 'update',
        targetNodeId: '1:2',
        markup: null,
        variableCollections: { tokens: null }
      },
      {
        mode: 'update',
        targetNodeId: '1:2',
        markup: null,
        styles: { legacy: null }
      }
    ]) {
      expect(acceptsCanvas(input)).toBe(false)
    }
  })

  it('rejects empty and malformed bindings', () => {
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: ' ',
        bindings: {}
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {}
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          'invalid key': {
            variables: { fill: { key: 'color-key' } }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            variables: { fill: {} }
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            styles: {}
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: {}
          }
        }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: {
          root: {
            figma: { text: {} }
          }
        }
      })
    ).toBe(false)
  })

  it('bounds canvas bindings and removals at the shared node limit', () => {
    const bindings = Object.fromEntries(
      Array.from({ length: MAX_CANVAS_NODES }, (_, index) => [
        `node-${index}`,
        { variables: { fill: null } }
      ])
    )
    const removeKeys = Array.from({ length: MAX_CANVAS_NODES }, (_, index) => `old-${index}`)

    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings,
        removeKeys
      })
    ).toBe(true)
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        bindings: { ...bindings, overflow: { variables: { fill: null } } }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        markup: '<div data-key="root" class="w-[320px] h-[200px]"></div>',
        removeKeys: [...removeKeys, 'overflow']
      })
    ).toBe(false)
  })

  it('defers component-create validation until markup and catalog resolution', () => {
    const publicUpdate = {
      mode: 'update' as const,
      targetNodeId: '1:2',
      markup: '<div data-key="action" class="w-[120px] h-[40px]"></div>',
      native: {
        action: {
          componentProperties: { Label: 'Save' },
          figma: { instance: { scaleFactor: 1.25 } }
        }
      }
    }
    const resolvedUpdate = {
      mode: 'update' as const,
      targetNodeId: '1:2',
      markup: '<div data-key="action" class="w-[120px] h-[40px]"></div>',
      bindings: {
        action: {
          componentProperties: { Label: 'Save' },
          figma: { instance: { scaleFactor: 1.25 } }
        }
      }
    }

    expect(ApplyCanvasPublicParametersSchema.safeParse(publicUpdate).success).toBe(true)
    expect(acceptsCanvas(resolvedUpdate)).toBe(true)
    const { targetNodeId: _resolvedTarget, ...resolvedCreate } = resolvedUpdate
    expect(
      ApplyCanvasPublicParametersSchema.safeParse({
        mode: 'create',
        catalogId: 'ds_1',
        markup: '<ActionButton data-key="action" class="w-[120px] h-[40px]"></ActionButton>',
        native: publicUpdate.native
      }).success
    ).toBe(true)
    expect(acceptsCanvas({ ...resolvedCreate, mode: 'create' })).toBe(true)
  })
})

describe('mcp/tools canvas authoring result schemas', () => {
  it('validates complete design-system catalog entries', () => {
    expect(
      GetDesignSystemResultSchema.safeParse({
        catalogId: 'ds_1',
        components: [
          {
            ref: 'c1',
            tag: 'Button',
            name: 'Button',
            props: {
              label: { type: 'text', default: 'Save' }
            }
          }
        ],
        variables: [],
        collections: [],
        styles: [],
        nextCursor: 1
      }).success
    ).toBe(true)
    expect(
      GetDesignSystemResultSchema.safeParse({
        catalogId: 'ds_1',
        components: [{ ref: 'c1' }],
        variables: [],
        collections: [],
        styles: []
      }).success
    ).toBe(false)
    expect(
      GetDesignSystemResultSchema.safeParse({
        catalogId: 'ds_1',
        components: [],
        variables: [],
        collections: [],
        styles: [],
        details: { ref: 'c1', kind: 'component' }
      }).success
    ).toBe(false)
  })

  it('validates canvas result collection values and verification details', () => {
    const result = {
      rootNodeId: '1:1',
      nodeIdsByKey: { root: '1:1' },
      createdNodeIds: ['1:1'],
      updatedNodeIds: [],
      removedNodeIds: [],
      mutationCount: 1,
      verification: {
        status: 'passed',
        nodesChecked: 1,
        referencesChecked: 0,
        nativeFieldsChecked: 2,
        warnings: []
      }
    }
    expect(ApplyCanvasResultSchema.safeParse(result).success).toBe(true)
    expect(
      ApplyCanvasResultSchema.safeParse({
        ...result,
        nodeIdsByKey: { root: 1 }
      }).success
    ).toBe(false)
    expect(
      ApplyCanvasResultSchema.safeParse({
        ...result,
        verification: { ...result.verification, warnings: [{}] }
      }).success
    ).toBe(false)
    expect(
      ApplyCanvasResultSchema.safeParse({
        ...result,
        verification: { ...result.verification, nativeFieldsChecked: -1 }
      }).success
    ).toBe(false)
  })
})

describe('mcp/tools parameter schemas', () => {
  it('accepts optional get_code params and validates preferred language enum', () => {
    expect(GetCodeParametersSchema.safeParse({}).success).toBe(true)
    expect(
      GetCodeParametersSchema.safeParse({
        nodeId: '123:456',
        preferredLang: 'vue',
        resolveTokens: true,
        vectorMode: 'snapshot'
      }).success
    ).toBe(true)
    expect(
      GetCodeParametersSchema.safeParse({
        preferredLang: 'svelte'
      }).success
    ).toBe(false)
    expect(
      GetCodeParametersSchema.safeParse({
        vectorMode: 'fidelity'
      }).success
    ).toBe(false)
  })

  it('enforces token name canonical format and non-empty names list', () => {
    expect(
      GetTokenDefsParametersSchema.safeParse({
        names: ['--color-primary', '--spacing-2'],
        includeAllModes: false
      }).success
    ).toBe(true)

    expect(
      GetTokenDefsParametersSchema.safeParse({
        names: [],
        includeAllModes: true
      }).success
    ).toBe(false)

    expect(
      GetTokenDefsParametersSchema.safeParse({
        names: ['color-primary']
      }).success
    ).toBe(false)
  })

  it('accepts empty screenshot params and optional structure depth', () => {
    expect(GetScreenshotParametersSchema.safeParse({}).success).toBe(true)
    expect(GetScreenshotParametersSchema.safeParse({ nodeId: '9:99' }).success).toBe(true)

    expect(
      GetStructureParametersSchema.safeParse({
        nodeId: '1:2',
        options: { depth: 2, native: true }
      }).success
    ).toBe(true)

    expect(
      GetStructureParametersSchema.safeParse({
        options: { depth: 0 }
      }).success
    ).toBe(false)

    expect(z.toJSONSchema(GetStructureParametersSchema)).toMatchObject({
      properties: {
        options: {
          properties: {
            depth: {
              description:
                'Positive integer; 1 is the shallowest traversal (root plus direct children). Omit for the full tree, subject to safety caps.'
            }
          }
        }
      }
    })
  })

  it('validates get_assets hash inputs and get_assets result shape', () => {
    expect(
      GetAssetsParametersSchema.safeParse({
        hashes: [ASSET_HASH, OTHER_ASSET_HASH]
      }).success
    ).toBe(true)

    expect(
      GetAssetsParametersSchema.safeParse({
        hashes: ['bad-hash']
      }).success
    ).toBe(false)

    expect(
      GetAssetsResultSchema.safeParse({
        assets: [
          {
            hash: ASSET_HASH,
            url: 'https://example.com/a.png',
            mimeType: 'image/png',
            size: 10
          }
        ],
        missing: [OTHER_ASSET_HASH]
      }).success
    ).toBe(true)
    expect(GetAssetsResultSchema.safeParse({ assets: [], missing: ['not-a-hash'] }).success).toBe(
      false
    )
  })
})
