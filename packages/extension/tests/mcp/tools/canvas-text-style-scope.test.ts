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

  it('keeps the mixed-font requirement for both family and style', async () => {
    const fixture = createFixture()
    const created = await applyCanvas(request())
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    installStyledText(node)
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
