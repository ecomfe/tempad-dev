import { describe, expect, it } from 'vitest'

import { buildGetDesignSystemToolResult } from '../../src/mcp/responses'
import {
  ApplyCanvasParametersSchema,
  GetDesignSystemParametersSchema,
  GetDesignSystemResultSchema
} from '../../src/mcp/tools'

describe('design-resource and environment-font contracts', () => {
  it.each([
    { scope: 'fonts' },
    { scope: 'fonts', query: 'Noto', cursor: 32 },
    { scope: 'fonts', families: ['Noto Sans SC', 'Inter'] },
    { scope: 'resources' },
    { catalogId: 'ds_1', cursor: 0 }
  ])('accepts scoped resource/font requests: %j', (input) => {
    expect(GetDesignSystemParametersSchema.safeParse(input).success).toBe(true)
  })

  it.each([
    { scope: 'fonts', catalogId: 'ds_1' },
    { scope: 'fonts', ref: 'v1' },
    { scope: 'fonts', query: 'Noto', families: ['Inter'] },
    { query: 'Noto' },
    { families: ['Inter'] },
    { scope: 'fonts', families: [] },
    { scope: 'fonts', families: Array.from({ length: 9 }, () => 'Inter') }
  ])('rejects mixed query domains: %j', (input) => {
    expect(GetDesignSystemParametersSchema.safeParse(input).success).toBe(false)
  })

  it('accepts call-scoped aliases for catalog and local resources', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="root" class="w-[100px] h-[100px]"/>',
      theme: {
        variables: { '--surface': { ref: 'v1' }, '--spacing': { variableKey: 'system/spacing' } },
        textStyles: { 'type-body': { ref: 's1' }, 'type-title': { styleKey: 'system/title' } }
      }
    }
    expect(ApplyCanvasParametersSchema.safeParse(input).success).toBe(true)
    expect(
      ApplyCanvasParametersSchema.safeParse({
        ...input,
        markup: undefined,
        page: { name: 'Test', pageKey: 'test' }
      }).success
    ).toBe(false)
    expect(
      ApplyCanvasParametersSchema.safeParse({
        ...input,
        theme: { textStyles: { 'font-bold': { ref: 's1' } } }
      }).success
    ).toBe(false)
    expect(
      ApplyCanvasParametersSchema.safeParse({
        ...input,
        theme: { variables: { '--surface': { id: 'guessed-id' } } }
      }).success
    ).toBe(false)
  })

  it('keeps the font result distinct and formats bounded discovery and exact-face responses', () => {
    expect(GetDesignSystemResultSchema.safeParse({ scope: 'fonts', families: [] }).success).toBe(
      true
    )
    expect(
      GetDesignSystemResultSchema.safeParse({
        scope: 'fonts',
        fonts: [],
        missingFamilies: ['Missing']
      }).success
    ).toBe(true)
    expect(GetDesignSystemResultSchema.safeParse({ scope: 'fonts' }).success).toBe(false)
    expect(
      GetDesignSystemResultSchema.safeParse({ scope: 'fonts', families: [], fonts: [] }).success
    ).toBe(false)
    expect(
      buildGetDesignSystemToolResult({
        scope: 'fonts',
        fonts: [{ family: 'Inter', style: 'Regular' }]
      }).content?.[0]?.text
    ).toContain('1 available font faces')
  })
})
