import type { CanvasFigmaTextRange, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

const STYLE_VALUES = {
  fontName: { family: 'Inter', style: 'Bold' },
  fontSize: 24,
  lineHeight: { unit: 'PIXELS', value: 32 },
  letterSpacing: { unit: 'PIXELS', value: -0.25 },
  textCase: 'TITLE',
  textDecoration: 'UNDERLINE'
} as const

function installStyledText(node: TextNode, styledLength = 5) {
  const length = node.characters.length
  const values = Object.fromEntries(
    Object.entries(STYLE_VALUES).map(([field, value]) => [
      field,
      Array.from({ length }, (_, index) =>
        index < styledLength ? value : node[field as keyof typeof STYLE_VALUES]
      )
    ])
  ) as Record<keyof typeof STYLE_VALUES, unknown[]>
  const styles = Array.from({ length }, (_, index) => (index < styledLength ? 'style:text' : ''))
  const read = (items: unknown[], start = 0, end = length) => {
    if (end > length) throw new Error('Out-of-bounds native range')
    const first = items[start]
    return items.slice(start, end).every((value) => JSON.stringify(value) === JSON.stringify(first))
      ? first
      : figma.mixed
  }
  for (const [field, items] of Object.entries(values)) {
    const suffix = field[0]!.toUpperCase() + field.slice(1)
    Object.defineProperty(node, field, {
      configurable: true,
      get: () => read(items),
      // Literal setters retain attached style IDs; replaying an identical style
      // ID later therefore cannot repair an overwritten styled value.
      set: (value: unknown) => items.fill(value)
    })
    Object.defineProperty(node, `getRange${suffix}`, {
      configurable: true,
      value: (start: number, end: number) => read(items, start, end)
    })
    Object.defineProperty(node, `setRange${suffix}`, {
      configurable: true,
      value: (start: number, end: number, value: unknown) => items.fill(value, start, end)
    })
  }
  Object.defineProperty(node, 'textStyleId', { configurable: true, get: () => read(styles) })
  node.getRangeTextStyleId = (start, end) => read(styles, start, end) as string | typeof figma.mixed
  node.setRangeTextStyleIdAsync = vi.fn(async (start, end, id) => {
    styles.fill(id, start, end)
    if (id) {
      for (const [field, value] of Object.entries(STYLE_VALUES)) {
        values[field as keyof typeof STYLE_VALUES].fill(value, start, end)
      }
    }
  })
  node.getRangeAllFontNames = () =>
    [...new Map(values.fontName.map((font) => [JSON.stringify(font), font])).values()] as FontName[]
  const segments = vi.fn(() => {
    const result = []
    for (let start = 0; start < length;) {
      let end = start + 1
      while (end < length && styles[end] === styles[start]) end++
      result.push({
        start,
        end,
        characters: node.characters.slice(start, end),
        textStyleId: styles[start]
      })
      start = end
    }
    return result
  })
  node.getStyledTextSegments = segments as TextNode['getStyledTextSegments']
  return { values, styles, segments }
}

type MetricField = 'fontSize' | 'lineHeight' | 'letterSpacing'

function installMetricVariable(
  node: TextNode,
  native: ReturnType<typeof installStyledText>,
  field: MetricField,
  boundEnd = 5
) {
  const alias: VariableAlias = { type: 'VARIABLE_ALIAS', id: 'variable:spacing' }
  const aliases: (VariableAlias | null)[] = Array.from(
    { length: node.characters.length },
    (_, index) => (index < boundEnd ? alias : null)
  )
  const boundValue = field === 'fontSize' ? Math.fround(21.1) : { unit: 'PIXELS', value: 21.1 }
  native.values[field].fill(boundValue, 0, boundEnd)
  Object.defineProperty(node, 'boundVariables', {
    configurable: true,
    get: () => (aliases.some(Boolean) ? { [field]: [alias] } : {})
  })
  node.getRangeBoundVariable = (start, end, requested) => {
    if (requested !== field) return null
    const first = aliases[start] ?? null
    return aliases.slice(start, end).every((value) => value === first) ? first : figma.mixed
  }
  Object.defineProperty(node, field, {
    ...Object.getOwnPropertyDescriptor(node, field),
    set: (value: unknown) => {
      native.values[field].fill(value)
      aliases.fill(null)
    }
  })
  Object.defineProperty(node, `setRange${field[0]!.toUpperCase()}${field.slice(1)}`, {
    configurable: true,
    value: (start: number, end: number, value: unknown) => {
      native.values[field].fill(value, start, end)
      aliases.fill(null, start, end)
    }
  })
  node.setRangeBoundVariable = (start, end, requested, variable) => {
    if (requested !== field || variable) throw new Error('Only variable removal is expected')
    aliases.fill(null, start, end)
  }
  node.getStyledTextSegments = (() => {
    const segments = []
    for (let start = 0; start < aliases.length;) {
      let end = start + 1
      while (
        end < aliases.length &&
        aliases[end] === aliases[start] &&
        native.styles[end] === native.styles[start]
      )
        end++
      segments.push({
        start,
        end,
        characters: node.characters.slice(start, end),
        textStyleId: native.styles[start],
        boundVariables: aliases[start] ? { [field]: aliases[start] } : {}
      })
      start = end
    }
    return segments
  }) as TextNode['getStyledTextSegments']
  return { aliases, alias, boundValue }
}

const RANGE: CanvasFigmaTextRange = { start: 0, end: 5, textStyle: { id: 'style:text' } }

function request(
  ranges: CanvasFigmaTextRange[] | null = [RANGE],
  changed = false
): CanvasResolvedApplyParameters {
  return {
    mode: 'create',
    markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 font-sans ${changed ? 'font-semibold text-[20px] leading-[160%] tracking-[1px] lowercase line-through' : 'font-normal text-[16px] leading-[150%] tracking-[0px] normal-case no-underline'}">Range metrics</span></div>`,
    bindings: { label: { figma: { text: { ranges: ranges ?? undefined } } } }
  }
}

describe('base typography outside retained range TextStyles', () => {
  it('applies base font size outside a range whose font-size variable is cleared', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request(null))
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node, 0)
    const { aliases } = installMetricVariable(node, native, 'fontSize')
    const changed = request([
      { start: 0, end: 5, textStyle: null, fontSize: 16, variables: { fontSize: null } }
    ])
    changed.markup = changed.markup!.replace('text-[16px]', 'text-[20px]')
    changed.bindings!.label!.styles = { text: null }
    const update = { ...changed, mode: 'update' as const, targetNodeId: created.rootNodeId! }
    const updated = await applyCanvas(update)
    expect(node.getRangeFontSize(0, 5)).toBe(16)
    expect(node.getRangeFontSize(5, 13)).toBe(20)
    expect(aliases).toEqual(Array(13).fill(null))
    expect(updated.verification.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'literal-ignored-by-binding' })])
    )
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each(['fontSize', 'lineHeight', 'letterSpacing'] as const)(
    'updates unbound characters while retaining a range %s variable',
    async (field) => {
      const fixture = createFixture()
      const created = await applyCanvas(request(null))
      const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const native = installStyledText(node, 0)
      const { aliases, alias, boundValue } = installMetricVariable(node, native, field)
      const update = {
        ...request(null, true),
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!
      }
      const updated = await applyCanvas(update)
      expect(native.values[field].slice(0, 5)).toEqual(Array(5).fill(boundValue))
      expect(aliases.slice(0, 5)).toEqual(Array(5).fill(alias))
      const expected = {
        fontSize: 20,
        lineHeight: { unit: 'PERCENT', value: 160 },
        letterSpacing: { unit: 'PIXELS', value: 1 }
      }
      expect(native.values[field].slice(5)).toEqual(Array(8).fill(expected[field]))
      expect(updated.verification.warnings).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'literal-ignored-by-binding' })])
      )
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    }
  )

  it.each(['null binding', 'literal override'] as const)(
    'applies range font size on the same request as a %s',
    async (kind) => {
      const fixture = createFixture()
      const created = await applyCanvas(request(null))
      const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const native = installStyledText(node, 0)
      const { aliases } = installMetricVariable(node, native, 'fontSize')
      const range =
        kind === 'null binding'
          ? { start: 0, end: 5, variables: { fontSize: null } }
          : { start: 0, end: 5, fontSize: 16 }
      const update = {
        ...request([range], true),
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!
      }
      await applyCanvas(update)
      expect(node.getRangeFontSize(0, 5)).toBe(kind === 'null binding' ? 20 : 16)
      expect(node.getRangeFontSize(5, 13)).toBe(20)
      expect(aliases).toEqual(Array(13).fill(null))
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    }
  )

  it('preserves a whole-text variable and reports the ignored literal', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request(null))
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node, 0)
    const { aliases, alias, boundValue } = installMetricVariable(
      node,
      native,
      'fontSize',
      node.characters.length
    )
    const updated = await applyCanvas({
      ...request(null, true),
      mode: 'update',
      targetNodeId: created.rootNodeId!
    })
    expect(node.fontSize).toBe(boundValue)
    expect(aliases).toEqual(Array(13).fill(alias))
    expect(updated.verification.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'literal-ignored-by-binding',
          message: expect.stringContaining('fontSize')
        })
      ])
    )
  })

  it.each(['some', 'no'] as const)(
    'applies base metrics when styles and variables leave %s writable characters',
    async (writable) => {
      const fixture = createFixture()
      const created = await applyCanvas(request(null))
      const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const native = installStyledText(node, 0)
      const styleStart = writable === 'some' ? 5 : 3
      const styleEnd = writable === 'some' ? 8 : 13
      native.styles.fill('style:text', styleStart, styleEnd)
      native.values.fontSize.fill(STYLE_VALUES.fontSize, styleStart, styleEnd)
      const { aliases, alias, boundValue } = installMetricVariable(node, native, 'fontSize', 3)
      const update = {
        ...request(null, true),
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!
      }
      const updated = await applyCanvas(update)
      expect(native.values.fontSize).toEqual(
        Array.from({ length: 13 }, (_, index) =>
          index < 3
            ? boundValue
            : index >= styleStart && index < styleEnd
              ? STYLE_VALUES.fontSize
              : 20
        )
      )
      expect(aliases.slice(0, 3)).toEqual(Array(3).fill(alias))
      expect(native.styles.slice(styleStart, styleEnd)).toEqual(
        Array(styleEnd - styleStart).fill('style:text')
      )
      const ignored = updated.verification.warnings.filter(
        ({ code }) => code === 'literal-ignored-by-binding'
      )
      expect(ignored).toHaveLength(writable === 'some' ? 0 : 1)
      if (writable === 'no') expect(ignored[0]!.message).toContain('fontSize')
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    }
  )

  it('does not use old variable ranges while replacing the characters', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request(null))
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node, 0)
    installMetricVariable(node, native, 'fontSize')
    const segments = vi.spyOn(node, 'getStyledTextSegments')
    const changed = request(null, true)
    changed.markup = changed.markup!.replace('Range metrics', 'Longer replacement text')
    await applyCanvas({ ...changed, mode: 'update', targetNodeId: created.rootNodeId! })
    expect(node.characters).toBe('Longer replacement text')
    expect(native.values.fontSize.slice(5)).toEqual(Array(8).fill(16))
    expect(segments).not.toHaveBeenCalled()
  })

  it.each(['declared', 'omitted'] as const)(
    'updates unstyled characters with %s range links',
    async (rangeMode) => {
      const fixture = createFixture()
      const created = await applyCanvas(request())
      const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const native = installStyledText(node)
      const changed = {
        ...request(rangeMode === 'declared' ? [RANGE] : null, true),
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!
      }
      const updated = await applyCanvas(changed)
      expect(updated.mutationCount).toBeGreaterThan(0)
      expect(
        updated.verification.warnings.filter(({ code }) => code === 'literal-ignored-by-binding')
      ).toEqual([])
      for (const [field, value] of Object.entries(STYLE_VALUES)) {
        expect(native.values[field as keyof typeof STYLE_VALUES].slice(0, 5)).toEqual(
          Array(5).fill(value)
        )
      }
      expect(node.getRangeFontName(5, 13)).toEqual({ family: 'Inter', style: 'Semi Bold' })
      expect(node.getRangeFontSize(5, 13)).toBe(20)
      expect(node.getRangeLineHeight(5, 13)).toEqual({ unit: 'PERCENT', value: 160 })
      expect(node.getRangeLetterSpacing(5, 13)).toEqual({ unit: 'PIXELS', value: 1 })
      expect(node.getRangeTextCase(5, 13)).toBe('LOWER')
      expect(node.getRangeTextDecoration(5, 13)).toBe('STRIKETHROUGH')
      expect(native.styles.slice(0, 5)).toEqual(Array(5).fill('style:text'))
      await expect(applyCanvas(changed)).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
      expect(figma.loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Semi Bold' })
    }
  )

  it.each(['declared', 'omitted'] as const)(
    'resolves a style-only base font from writable characters with %s range links',
    async (rangeMode) => {
      const fixture = createFixture()
      const initial = request()
      initial.markup = initial.markup!.replace('font-sans ', '')
      const created = await applyCanvas(initial)
      const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const native = installStyledText(node)
      const update = {
        ...initial,
        mode: 'update' as const,
        targetNodeId: created.rootNodeId!,
        bindings: rangeMode === 'declared' ? initial.bindings : undefined
      }
      await expect(applyCanvas(update)).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
      const changed = {
        ...update,
        markup: update.markup!.replace('font-normal ', 'font-semibold ')
      }
      fixture.loadFontAsync.mockClear()
      const updated = await applyCanvas(changed)
      expect(updated.mutationCount).toBe(1)
      expect(node.getRangeFontName(0, 5)).toEqual(STYLE_VALUES.fontName)
      expect(native.styles.slice(0, 5)).toEqual(Array(5).fill('style:text'))
      expect(node.getRangeFontName(5, 13)).toEqual({ family: 'Inter', style: 'Semi Bold' })
      expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Semi Bold' })
      await expect(applyCanvas(changed)).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
    }
  )

  it('applies base typography on the same request that clears the range style', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request())
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node)
    const changed = {
      ...request([{ start: 0, end: 5, textStyle: null }], true),
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!
    }
    const updated = await applyCanvas(changed)
    expect(
      updated.verification.warnings.filter(({ code }) => code === 'literal-ignored-by-binding')
    ).toEqual([])
    expect(native.styles).toEqual(Array(13).fill(''))
    expect(node.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' })
    expect(node.fontSize).toBe(20)
    expect(node.lineHeight).toEqual({ unit: 'PERCENT', value: 160 })
    await expect(applyCanvas(changed)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each([5, 13])(
    'applies base typography in cleared 0:%i while restating the whole TextStyle',
    async (end) => {
      const fixture = createFixture()
      const created = await applyCanvas(request(null))
      const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const native = installStyledText(node, node.characters.length)
      const changed = request([{ start: 0, end, textStyle: null }], true)
      changed.bindings!.label!.styles = { text: { id: 'style:text' } }
      const update = { ...changed, mode: 'update' as const, targetNodeId: created.rootNodeId! }
      const updated = await applyCanvas(update)
      expect(node.getRangeFontName(0, end)).toEqual({ family: 'Inter', style: 'Semi Bold' })
      expect(node.getRangeFontSize(0, end)).toBe(20)
      expect(node.getRangeLineHeight(0, end)).toEqual({ unit: 'PERCENT', value: 160 })
      expect(node.getRangeLetterSpacing(0, end)).toEqual({ unit: 'PIXELS', value: 1 })
      expect(node.getRangeTextCase(0, end)).toBe('LOWER')
      expect(node.getRangeTextDecoration(0, end)).toBe('STRIKETHROUGH')
      expect(native.styles.slice(0, end)).toEqual(Array(end).fill(''))
      for (const [field, value] of Object.entries(STYLE_VALUES)) {
        expect(native.values[field as keyof typeof STYLE_VALUES].slice(end)).toEqual(
          Array(13 - end).fill(value)
        )
      }
      expect(native.styles.slice(end)).toEqual(Array(13 - end).fill('style:text'))
      expect(
        updated.verification.warnings.filter(({ code }) => code === 'literal-ignored-by-binding')
      ).toEqual([])
      await expect(applyCanvas(update)).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
    }
  )

  it('preserves a retained style that covers the whole string', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request())
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node, node.characters.length)
    const updated = await applyCanvas({
      ...request(null, true),
      mode: 'update',
      targetNodeId: created.rootNodeId!
    })
    expect(updated.mutationCount).toBe(0)
    expect(updated.verification.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'literal-ignored-by-binding',
          key: 'label',
          message: expect.stringContaining(
            'fontFamily, fontStyle, fontSize, lineHeight, letterSpacing'
          )
        })
      ])
    )
    expect(node.fontName).toEqual(STYLE_VALUES.fontName)
    expect(node.fontSize).toBe(STYLE_VALUES.fontSize)
    expect(native.segments).not.toHaveBeenCalled()
  })

  it('preserves explicit native case overrides of styled text', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request())
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    installStyledText(node)
    const changed = request(null)
    changed.markup = changed.markup!.replace('normal-case ', '')
    changed.bindings!.label!.figma!.text!.case = 'UPPER'
    const update = { ...changed, mode: 'update' as const, targetNodeId: created.rootNodeId! }
    await applyCanvas(update)
    expect(node.textCase).toBe('UPPER')
    expect(node.getRangeTextStyleId(0, 5)).toBe('style:text')
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('keeps the mixed-font requirement when writable characters themselves have mixed fonts', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request())
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node)
    native.values.fontName[9] = { family: 'Inter', style: 'Italic' }
    const changed = request(null)
    changed.markup = changed.markup!.replace('font-normal ', '')
    await expect(
      applyCanvas({ ...changed, mode: 'update', targetNodeId: created.rootNodeId! })
    ).rejects.toMatchObject({
      message: expect.stringContaining('provide both fontFamily and fontStyle')
    })
  })

  it('does not apply old styled ranges to replacement text', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request())
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const native = installStyledText(node)
    const changed = request(null, true)
    changed.markup = changed.markup!.replace('Range metrics', 'Longer replacement text')
    await applyCanvas({ ...changed, mode: 'update', targetNodeId: created.rootNodeId! })
    expect(node.characters).toBe('Longer replacement text')
    expect(native.values.fontSize.slice(5)).toEqual(Array(8).fill(16))
    expect(native.segments).not.toHaveBeenCalled()
  })
})
