import { describe, expect, it } from 'vitest'

import {
  ApplyCanvasParametersSchema,
  AssetDescriptorSchema,
  GetAssetsParametersSchema,
  GetAssetsResultSchema,
  GetCodeParametersSchema,
  GetDesignSystemParametersSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  GetTokenDefsParametersSchema
} from '../../src/mcp/tools'

function frameTree(depth: number): Record<string, unknown> {
  let root: Record<string, unknown> = {
    key: `depth-${depth}`,
    type: 'FRAME'
  }
  for (let level = depth - 1; level >= 1; level -= 1) {
    root = {
      key: `depth-${level}`,
      type: 'FRAME',
      children: [root]
    }
  }
  return root
}

function acceptsCanvas(value: unknown): boolean {
  return ApplyCanvasParametersSchema.safeParse(value).success
}

function acceptsCreate(root: Record<string, unknown>): boolean {
  return acceptsCanvas({ mode: 'create', root })
}

describe('mcp/tools AssetDescriptorSchema', () => {
  it('accepts a valid asset descriptor', () => {
    const parsed = AssetDescriptorSchema.safeParse({
      hash: 'deadbeef',
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      size: 1024,
      width: 300,
      height: 200,
      themeable: true
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects negative size and non-protocol hashes', () => {
    const invalidSize = AssetDescriptorSchema.safeParse({
      hash: 'deadbeef',
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
  })
})

describe('mcp/tools canvas authoring schemas', () => {
  it('accepts a compact design-system query and a declarative create result', () => {
    expect(GetDesignSystemParametersSchema.safeParse({}).success).toBe(true)
    expect(GetDesignSystemParametersSchema.safeParse({ query: '  primary button  ' }).success).toBe(
      true
    )
    expect(GetDesignSystemParametersSchema.safeParse({ query: ' ' }).success).toBe(false)
    expect(GetDesignSystemParametersSchema.safeParse({ extra: true }).success).toBe(false)

    expect(
      acceptsCreate({
        key: 'settings/card',
        type: 'FRAME',
        name: 'Settings card',
        position: { x: 20, y: 30 },
        size: { width: 320, height: 200, horizontal: 'FIXED', vertical: 'FIXED' },
        layout: {
          mode: 'VERTICAL',
          gap: 12,
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          primaryAlign: 'MIN',
          counterAlign: 'CENTER'
        },
        appearance: {
          fill: '#FFFFFFFF',
          stroke: '#112233',
          strokeWeight: 1,
          cornerRadius: 12,
          opacity: 0.9
        },
        variables: {
          fill: { key: 'color-key' },
          gap: { id: 'VariableID:1' }
        },
        children: [
          {
            key: 'settings/card/title',
            type: 'TEXT',
            text: {
              characters: 'Settings',
              fontFamily: 'Inter',
              fontStyle: 'Semi Bold',
              fontSize: 18,
              lineHeight: 24,
              letterSpacing: 0,
              alignHorizontal: 'LEFT',
              alignVertical: 'TOP'
            }
          },
          {
            key: 'settings/card/action',
            type: 'INSTANCE',
            component: { id: 'ComponentID:1' },
            componentProperties: {
              Label: 'Save',
              Disabled: false
            }
          }
        ]
      })
    ).toBe(true)
  })

  it('accepts a scoped update and rejects unsafe create/update identities', () => {
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        root: {
          key: 'root',
          nodeId: '1:2',
          type: 'FRAME',
          children: [{ key: 'root/title', nodeId: '1:3', type: 'TEXT' }]
        }
      })
    ).toBe(true)

    const invalidCreates = [
      {
        mode: 'create',
        targetNodeId: '1:2',
        root: { key: 'root', type: 'FRAME' }
      },
      {
        mode: 'create',
        root: { key: 'root', nodeId: '1:2', type: 'FRAME' }
      },
      {
        mode: 'create',
        root: {
          key: 'root',
          type: 'RECTANGLE'
        }
      }
    ]
    for (const input of invalidCreates) {
      expect(acceptsCanvas(input)).toBe(false)
    }
    expect(
      acceptsCanvas({
        mode: 'update',
        root: { key: 'root', type: 'FRAME' }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:2',
        root: { key: 'root', nodeId: '1:9', type: 'FRAME' }
      })
    ).toBe(false)
  })

  it('rejects ambiguous identities and properties on incompatible node types', () => {
    const parsed = ApplyCanvasParametersSchema.safeParse({
      mode: 'update',
      targetNodeId: '1:1',
      root: {
        key: 'root',
        nodeId: '1:1',
        type: 'FRAME',
        children: [
          {
            key: 'duplicate',
            nodeId: '1:2',
            type: 'INSTANCE'
          },
          {
            key: 'duplicate',
            nodeId: '1:2',
            type: 'TEXT',
            component: { key: 'component-key' },
            componentProperties: {},
            layout: { mode: 'NONE' },
            children: [{ key: 'nested', type: 'RECTANGLE' }]
          },
          {
            key: 'rectangle',
            type: 'RECTANGLE',
            text: { characters: 'Not valid' },
            component: { key: 'component-key' }
          }
        ]
      }
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message).join(' ')
      expect(messages).toContain('Duplicate canvas key')
      expect(messages).toContain('Duplicate nodeId')
      expect(messages).toContain('INSTANCE nodes require')
      expect(messages).toContain('Only INSTANCE nodes accept')
      expect(messages).toContain('Only TEXT nodes accept')
      expect(messages).toContain('Only FRAME nodes accept')
      expect(messages).toContain('Only FRAME nodes may declare children')
    }

    expect(
      acceptsCreate({
        key: 'root',
        type: 'FRAME',
        variables: { fill: {} }
      })
    ).toBe(false)
    expect(
      acceptsCanvas({
        mode: 'update',
        targetNodeId: '1:1',
        root: {
          key: 'root',
          nodeId: '1:1',
          type: 'FRAME',
          children: [{ key: 'rectangle', type: 'RECTANGLE', children: [] }]
        }
      })
    ).toBe(false)
  })

  it('enforces canvas size, depth, color, and stable-key bounds', () => {
    const children = Array.from({ length: 100 }, (_, index) => ({
      key: `root/item-${index}`,
      type: 'RECTANGLE' as const
    }))
    expect(
      acceptsCreate({
        key: 'root',
        type: 'FRAME',
        children: children.slice(0, 99)
      })
    ).toBe(true)
    expect(acceptsCreate({ key: 'root', type: 'FRAME', children })).toBe(false)

    expect(acceptsCreate(frameTree(12))).toBe(true)
    expect(acceptsCreate(frameTree(13))).toBe(false)

    expect(acceptsCreate({ key: 'invalid key', type: 'FRAME' })).toBe(false)
    expect(
      acceptsCreate({
        key: 'root',
        type: 'FRAME',
        appearance: { fill: 'red' }
      })
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
        options: { depth: 2 }
      }).success
    ).toBe(true)

    expect(
      GetStructureParametersSchema.safeParse({
        options: { depth: 0 }
      }).success
    ).toBe(false)
  })

  it('validates get_assets hash inputs and get_assets result shape', () => {
    expect(
      GetAssetsParametersSchema.safeParse({
        hashes: ['deadbeef', '0123abcd']
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
            hash: 'deadbeef',
            url: 'https://example.com/a.png',
            mimeType: 'image/png',
            size: 10
          }
        ],
        missing: ['beefcafe']
      }).success
    ).toBe(true)
    expect(GetAssetsResultSchema.safeParse({ assets: [], missing: ['not-a-hash'] }).success).toBe(
      false
    )
  })
})
