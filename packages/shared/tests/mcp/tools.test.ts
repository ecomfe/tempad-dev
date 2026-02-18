import { describe, expect, it } from 'vitest'

import {
  AssetDescriptorSchema,
  GetAssetsParametersSchema,
  GetAssetsResultSchema,
  GetCodeParametersSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  GetTokenDefsParametersSchema
} from '../../src/mcp/tools'

describe('mcp/tools AssetDescriptorSchema', () => {
  it('accepts a valid asset descriptor', () => {
    const parsed = AssetDescriptorSchema.safeParse({
      hash: 'deadbeef',
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      size: 1024,
      width: 300,
      height: 200
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects negative size', () => {
    const invalidSize = AssetDescriptorSchema.safeParse({
      hash: 'deadbeef',
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      size: -1
    })
    expect(invalidSize.success).toBe(false)
  })
})

describe('mcp/tools parameter schemas', () => {
  it('accepts optional get_code params and validates preferred language enum', () => {
    expect(GetCodeParametersSchema.safeParse({}).success).toBe(true)
    expect(
      GetCodeParametersSchema.safeParse({
        nodeId: '123:456',
        preferredLang: 'vue',
        resolveTokens: true
      }).success
    ).toBe(true)
    expect(
      GetCodeParametersSchema.safeParse({
        preferredLang: 'svelte'
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
  })
})
