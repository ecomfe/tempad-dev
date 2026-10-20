import type { CanvasFigmaTextRange } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

const FIELDS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'paragraphIndent',
  'paragraphSpacing',
  'listSpacing'
] as const
type Field = (typeof FIELDS)[number]

async function styledRangeFixture() {
  const fixture = createFixture()
  const created = await applyCanvas({
    mode: 'create',
    markup:
      '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">Range metrics</span></div>'
  })
  const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
  const style = fixture.styles.get('style:text') as TextStyle
  const values = Object.fromEntries(FIELDS.map((field) => [field, node[field]])) as Pick<
    TextStyle,
    Field
  >
  const aliases: Partial<Record<VariableBindableTextField, VariableAlias>> = {}
  let styleId = ''
  for (const field of FIELDS) {
    const suffix = field[0]!.toUpperCase() + field.slice(1)
    Object.defineProperty(node, `getRange${suffix}`, {
      configurable: true,
      value: () => values[field]
    })
    Object.defineProperty(node, `setRange${suffix}`, {
      configurable: true,
      value: (_start: number, _end: number, value: never) => {
        Object.assign(values, { [field]: field === 'fontSize' ? Math.fround(value) : value })
        if (field !== 'textDecoration') styleId = ''
        if (field === 'fontName') {
          delete aliases.fontFamily
          delete aliases.fontStyle
          delete aliases.fontWeight
        } else if (field !== 'textCase' && field !== 'textDecoration' && field !== 'listSpacing') {
          delete aliases[field]
        }
      }
    })
  }
  node.getRangeTextStyleId = () => styleId
  node.setRangeTextStyleIdAsync = vi.fn(async (_start, _end, id) => {
    styleId = id
    if (!id) return
    Object.assign(values, Object.fromEntries(FIELDS.map((field) => [field, style[field]])))
    values.fontSize = Math.fround(style.fontSize)
    node.leadingTrim = style.leadingTrim
    node.hangingPunctuation = style.hangingPunctuation
    node.hangingList = style.hangingList
    for (const field of Object.keys(aliases) as VariableBindableTextField[]) delete aliases[field]
    for (const [field, alias] of Object.entries(style.boundVariables ?? {})) {
      const variable = await figma.variables.getVariableByIdAsync(alias.id)
      node.setRangeBoundVariable(0, 5, field as VariableBindableTextField, variable)
    }
  })
  node.getRangeBoundVariable = (_start, _end, field) => aliases[field] ?? null
  node.setRangeBoundVariable = vi.fn(
    (_start: number, _end: number, field: VariableBindableTextField, variable: Variable | null) => {
      if (!variable) {
        delete aliases[field]
        return
      }
      aliases[field] = { type: 'VARIABLE_ALIAS', id: variable.id }
      const value = variable.resolveForConsumer(node).value
      if (field === 'fontSize') values.fontSize = Math.fround(value as number)
      else if (field === 'lineHeight' || field === 'letterSpacing') {
        values[field] = { unit: 'PIXELS', value: value as number }
      }
    }
  )
  const update = (override: Partial<CanvasFigmaTextRange> = {}) =>
    applyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      bindings: {
        label: {
          figma: {
            text: { ranges: [{ start: 0, end: 5, textStyle: { id: style.id }, ...override }] }
          }
        }
      }
    })
  return { node, style, values, aliases, update }
}

describe('range TextStyle with detached typography overrides', () => {
  it.each([{ fontSize: 28 }, { lineHeight: { unit: 'PIXELS' as const, value: 40 } }])(
    'converges repeated overrides: %j',
    async (override) => {
      const { update, node } = await styledRangeFixture()
      expect((await update(override)).mutationCount).toBe(2)
      expect(node.getRangeTextStyleId(0, 5)).toBe('')
      await expect(update(override)).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
    }
  )

  it('applies changed overrides and current defaults, then restores the link when overrides are removed', async () => {
    const { update, node, style, values } = await styledRangeFixture()
    await update({ fontSize: 28 })
    await update({ fontSize: 30 })
    expect(values.fontSize).toBe(30)
    style.fontName = { family: 'Inter', style: 'Regular' }
    style.lineHeight = { unit: 'PIXELS', value: 42 }
    await update({ fontSize: 30 })
    expect(values.fontName).toEqual(style.fontName)
    expect(values.lineHeight).toEqual(style.lineHeight)
    await expect(update({ fontSize: 30 })).resolves.toMatchObject({ mutationCount: 0 })
    await update()
    expect(node.getRangeTextStyleId(0, 5)).toBe(style.id)
    expect(values.fontSize).toBe(style.fontSize)
    await update({ textStyle: null, fontSize: 30 })
    expect(node.getRangeTextStyleId(0, 5)).toBe('')
    expect(values.fontSize).toBe(30)
    await expect(update({ textStyle: null, fontSize: 30 })).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it.each(['style', 'override'] as const)('rejects an ignored %s setter', async (ignored) => {
    const { update, node } = await styledRangeFixture()
    if (ignored === 'style') node.setRangeTextStyleIdAsync = vi.fn(async () => {})
    else node.setRangeFontSize = vi.fn()
    await expect(update({ fontSize: 28 })).rejects.toMatchObject({
      code: 'CANVAS_APPLY_FAILED',
      message: expect.stringContaining('range 0:5')
    })
  })

  it('resolves inherited style variables in the consumer mode and preserves explicit null unbinding', async () => {
    const { update, node, style, values, aliases } = await styledRangeFixture()
    const variable = await figma.variables.getVariableByIdAsync('variable:spacing')
    variable!.resolveForConsumer = () => ({ value: 21, resolvedType: 'FLOAT' })
    style.boundVariables = { fontSize: { type: 'VARIABLE_ALIAS', id: variable!.id } }
    await update({ lineHeight: { unit: 'PIXELS', value: 40 } })
    expect(values.fontSize).toBe(21)
    expect(aliases.fontSize?.id).toBe(variable!.id)
    await expect(update({ lineHeight: { unit: 'PIXELS', value: 40 } })).resolves.toMatchObject({
      mutationCount: 0
    })
    const cleared = {
      lineHeight: { unit: 'PIXELS' as const, value: 40 },
      variables: { fontSize: null }
    }
    await update(cleared)
    expect(values.fontSize).toBe(21)
    expect(node.getRangeBoundVariable(0, 5, 'fontSize')).toBeNull()
    await expect(update(cleared)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('keeps a final variable binding authoritative over its literal fallback', async () => {
    const { update, values, aliases } = await styledRangeFixture()
    const override = { fontSize: 28, variables: { fontSize: { id: 'variable:spacing' } } }
    await update(override)
    expect(values.fontSize).toBe(8)
    expect(aliases.fontSize?.id).toBe('variable:spacing')
    await expect(update(override)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('restores the requested link for redundant literals and no-op unbindings', async () => {
    const { update, node, style } = await styledRangeFixture()
    await update()
    node.setRangeFontSize(0, 5, style.fontSize)
    expect(node.getRangeTextStyleId(0, 5)).toBe('')
    await update({ fontSize: style.fontSize })
    expect(node.getRangeTextStyleId(0, 5)).toBe(style.id)
    await expect(update({ fontSize: style.fontSize })).resolves.toMatchObject({ mutationCount: 0 })
    node.setRangeFontSize(0, 5, style.fontSize)
    await update({ variables: { fontSize: null } })
    expect(node.getRangeTextStyleId(0, 5)).toBe(style.id)
  })

  it('repairs mismatched defaults even when the native style ID is already correct', async () => {
    const { update, node, style, values } = await styledRangeFixture()
    await update()
    values.fontSize = 28
    values.lineHeight = { unit: 'PIXELS', value: 100 }
    expect(node.getRangeTextStyleId(0, 5)).toBe(style.id)
    await update({ fontSize: 28 })
    expect(values.lineHeight).toEqual(style.lineHeight)
    expect(values.fontSize).toBe(28)
    await expect(update({ fontSize: 28 })).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('does not equate a different native style link with matching typography', async () => {
    const { update, node, values } = await styledRangeFixture()
    await node.setRangeTextStyleIdAsync(0, 5, 'style:other')
    values.fontSize = 28
    expect((await update({ fontSize: 28 })).mutationCount).toBe(2)
    await expect(update({ fontSize: 28 })).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('retains an inherited alias when a fractional literal equals its native float32 value', async () => {
    const { update, style, values, aliases } = await styledRangeFixture()
    const variable = await figma.variables.getVariableByIdAsync('variable:spacing')
    variable!.resolveForConsumer = () => ({ value: 21.1, resolvedType: 'FLOAT' })
    style.boundVariables = { fontSize: { type: 'VARIABLE_ALIAS', id: variable!.id } }
    await update({ fontSize: 21.1 })
    expect(values.fontSize).toBe(21.100000381469727)
    expect(aliases.fontSize?.id).toBe(variable!.id)
    await expect(update({ fontSize: 21.1 })).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects a silently ignored final variable binding', async () => {
    const { update, node } = await styledRangeFixture()
    node.setRangeBoundVariable = vi.fn()
    await expect(
      update({ fontSize: 28, variables: { fontSize: { id: 'variable:spacing' } } })
    ).rejects.toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
  })

  it('checks native style axes while preserving the authored named-face contract', async () => {
    const { update, style, values } = await styledRangeFixture()
    style.fontName = { family: 'Inter', style: 'Bold', variationSettings: { wght: 700, slnt: 0 } }
    await update({ fontSize: 28 })
    style.fontName = { ...style.fontName, variationSettings: { wght: 720, slnt: 0 } }
    await update({ fontSize: 28 })
    expect(values.fontName.variationSettings).toEqual({ wght: 720, slnt: 0 })
    await expect(update({ fontSize: 28 })).resolves.toMatchObject({ mutationCount: 0 })
    values.fontName = { ...values.fontName, variationSettings: { wght: 740, slnt: 0 } }
    await expect(
      update({ fontSize: 28, fontName: { family: 'Inter', style: 'Bold' } })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('keeps native semantic overrides on their existing acceptance path', async () => {
    const { update, node, values } = await styledRangeFixture()
    await update()
    const originalSegments = node.getStyledTextSegments.bind(node)
    let semantic = true
    Object.defineProperty(node, 'getStyledTextSegments', {
      value: (fields: string[], start = 0, end = node.characters.length) => {
        if (!fields.includes('textStyleOverrides'))
          return originalSegments(fields as never, start, end)
        return [
          {
            start,
            end,
            characters: node.characters.slice(start, end),
            textStyleOverrides: semantic ? ['SEMANTIC_ITALIC'] : []
          }
        ]
      }
    })
    values.fontName = { family: 'Inter', style: 'Bold Italic' }
    const originalSetter = node.setRangeFontSize.bind(node)
    node.setRangeFontSize = (start, end, value) => {
      originalSetter(start, end, value)
      semantic = false
    }
    await expect(update({ fontSize: 28 })).resolves.toMatchObject({ mutationCount: 1 })
    expect(values.fontName.style).toBe('Bold Italic')
    expect(semantic).toBe(false)
  })

  it('does not infer exact variable-font identity from a numeric weight', async () => {
    const { update, style, values } = await styledRangeFixture()
    const variable = await figma.variables.getVariableByIdAsync('variable:spacing')
    variable!.resolveForConsumer = () => ({ value: 450, resolvedType: 'FLOAT' })
    style.boundVariables = { fontWeight: { type: 'VARIABLE_ALIAS', id: variable!.id } }
    await expect(update({ fontSize: 28 })).resolves.toBeDefined()
    values.fontName = {
      family: 'Inter',
      style: 'Custom',
      variationSettings: { wght: 450, slnt: -4 }
    }
    await expect(update({ fontSize: 28 })).resolves.toBeDefined()
  })

  it('respects a later override affecting the same paragraph as the style defaults', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">One paragraph</span></div>'
    })
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const request = {
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!,
      bindings: {
        label: {
          figma: {
            text: {
              ranges: [
                { start: 0, end: 1, textStyle: { id: 'style:text' }, fontSize: 28 },
                { start: 1, end: 2, paragraphSpacing: 30 }
              ]
            }
          }
        }
      }
    }
    await applyCanvas(request)
    expect(node.getRangeParagraphSpacing(0, node.characters.length)).toBe(30)
    await expect(applyCanvas(request)).resolves.toMatchObject({ mutationCount: 0 })
  })
})
