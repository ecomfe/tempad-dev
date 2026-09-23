import { describe, expect, it } from 'vitest'

import { buildGetDesignSystemToolResult } from '../../src/mcp/responses'
import {
  ApplyCanvasParametersSchema,
  GetDesignSystemParametersSchema,
  GetDesignSystemResultSchema
} from '../../src/mcp/tools'

describe('design-resource and environment-font contracts', () => {
  it.each([
    { scope: 'fonts', sessionId: 'tab-a' },
    { scope: 'fonts', query: 'Noto', cursor: 32 },
    { scope: 'fonts', families: ['Noto Sans SC', 'Inter'] },
    { scope: 'pages', cursor: 32 },
    { scope: 'resources' },
    { scope: 'resources', pageId: '4:216' },
    { catalogId: 'ds_1', cursor: 0 }
  ])('accepts scoped resource/font requests: %j', (input) => {
    expect(GetDesignSystemParametersSchema.safeParse(input).success).toBe(true)
  })

  it.each([
    { scope: 'fonts', catalogId: 'ds_1' },
    { scope: 'fonts', ref: 'v1' },
    { scope: 'fonts', query: 'Noto', families: ['Inter'] },
    { query: 'Noto' },
    { ref: 'v1' },
    { cursor: 0 },
    { families: ['Inter'] },
    { scope: 'fonts', families: [] },
    { scope: 'fonts', sessionId: '' },
    { scope: 'fonts', families: Array.from({ length: 9 }, () => 'Inter') },
    { scope: 'pages', pageId: '4:216' },
    { scope: 'pages', catalogId: 'ds_1', cursor: 0 },
    { scope: 'fonts', pageId: '4:216' },
    { catalogId: 'ds_1', cursor: 0, pageId: '4:216' }
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

  it('formats a lightweight page index without treating it as a resource catalog', () => {
    const pages = {
      scope: 'pages' as const,
      pages: [{ id: '4:216', name: 'Local components', index: 2, active: false }],
      nextCursor: 32
    }
    expect(GetDesignSystemResultSchema.safeParse(pages).success).toBe(true)
    expect(buildGetDesignSystemToolResult(pages).content?.[0]?.text).toContain(
      'Continue the page list with cursor 32'
    )
  })
})
