import type { CanvasFigmaTextRange, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'
import { textParagraphs } from '@/mcp/tools/canvas/reconcile/text-paragraphs'

import { createFixture } from '../../fakes/figma'

type ParagraphField = 'paragraphIndent' | 'paragraphSpacing'
type ParagraphRange = { start: number; end: number; value: number }

async function createParagraphProbe(
  field: ParagraphField,
  initialValues = [20, 10, 10],
  characters = 'Hello\nworld\nagain'
) {
  const fixture = createFixture()
  const request = (
    base: number | undefined,
    ranges?: Array<ParagraphRange | CanvasFigmaTextRange>
  ): CanvasResolvedApplyParameters => ({
    mode: 'create',
    markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 whitespace-pre-wrap">${characters || 'Empty'}</span></div>`,
    bindings: {
      label: {
        figma: {
          text: {
            hangingPunctuation: false,
            ...(base === undefined ? {} : { [field]: base }),
            ...(ranges
              ? {
                  ranges: ranges.map((range) =>
                    'value' in range
                      ? { start: range.start, end: range.end, [field]: range.value }
                      : range
                  )
                }
              : {})
          }
        }
      }
    }
  })
  const created = await applyCanvas(request(undefined))
  const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
  if (!characters) label.characters = ''
  expect(label.characters).toBe(characters)

  // Installed @figma/plugin-typings documents setRangeParagraphSpacing(0, 1, 20)
  // changing the entire first paragraph, including its newline. ParagraphIndent
  // likewise targets paragraphs containing the supplied characters. Model those
  // semantics rather than the shared fake's independent start:end range records.
  // TextStyle aliases also use this paragraph model as a deterministic stress
  // case. Native partial TextStyle alias propagation remains unconfirmed; these
  // assertions do not establish its equivalence to direct variable binding.
  let base = 0
  let offset = 0
  const paragraphs = characters.split('\n').map((text, index, all) => {
    const start = offset
    offset += text.length + (index < all.length - 1 ? 1 : 0)
    return {
      start,
      end: offset,
      value: initialValues[index]!,
      alias: undefined as VariableAlias | undefined
    }
  })
  const affected = (start: number, end: number) =>
    paragraphs.filter((paragraph) => paragraph.start < end && paragraph.end > start)
  const read = (start: number, end: number): number | typeof figma.mixed => {
    const selected = affected(start, end)
    return selected.every((paragraph) => paragraph.value === selected[0]!.value)
      ? selected[0]!.value
      : figma.mixed
  }
  const write = vi.fn((start: number, end: number, value: number) => {
    for (const paragraph of affected(start, end)) {
      paragraph.value = value
      paragraph.alias = undefined
    }
  })
  // Native whole-node writes retain existing explicit paragraph values.
  const writeBase = vi.fn((value: number) => {
    base = value
  })
  Object.defineProperty(label, field, {
    configurable: true,
    get: () => (characters ? read(0, label.characters.length) : base),
    set: writeBase
  })
  const suffix = field === 'paragraphIndent' ? 'ParagraphIndent' : 'ParagraphSpacing'
  Object.defineProperty(label, `getRange${suffix}`, { value: read })
  Object.defineProperty(label, `setRange${suffix}`, { value: write })
  const readBinding = label.getRangeBoundVariable.bind(label)
  const writeBinding = label.setRangeBoundVariable.bind(label)
  Object.defineProperty(label, 'getRangeBoundVariable', {
    value: (start: number, end: number, property: VariableBindableTextField) => {
      if (property !== field) return readBinding(start, end, property)
      const selected = affected(start, end)
      return selected.every((paragraph) => paragraph.alias?.id === selected[0]!.alias?.id)
        ? selected[0]!.alias
        : figma.mixed
    }
  })
  const bind = vi.fn(
    (
      start: number,
      end: number,
      property: VariableBindableTextField,
      variable: Variable | null
    ) => {
      if (property !== field) return writeBinding(start, end, property, variable)
      for (const paragraph of affected(start, end)) {
        // Native paragraphSpacing null calls on 0:1 retained its alias, while
        // clearing the complete paragraph stopped subsequent variable updates.
        if (!variable && (start > paragraph.start || end < paragraph.end)) continue
        paragraph.alias = variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : undefined
        if (variable) paragraph.value = variable.resolveForConsumer(label).value as number
      }
    }
  )
  Object.defineProperty(label, 'setRangeBoundVariable', { value: bind })

  return {
    fixture,
    label,
    values: () => paragraphs.map(({ value }) => value),
    aliases: () => paragraphs.map(({ alias }) => alias?.id),
    write,
    writeBase,
    bind,
    update: (base: number | undefined, ranges?: Array<ParagraphRange | CanvasFigmaTextRange>) =>
      applyCanvas({
        ...request(base, ranges),
        ...(!characters ? { markup: undefined } : {}),
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
  }
}

describe.each(['paragraphIndent', 'paragraphSpacing'] as const)('%s layering', (field) => {
  it('replaces prior paragraph values when only the base field is authored', async () => {
    const probe = await createParagraphProbe(field, [20, 30], 'Hello\nworld')
    expect((await probe.update(12)).mutationCount).toBe(1)
    expect(probe.values()).toEqual([12, 12])
    expect(probe.writeBase).not.toHaveBeenCalled()
    await expect(probe.update(12)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(
      probe.update(undefined, [
        { start: 0, end: 1, value: 12 },
        { start: 6, end: 7, value: 12 }
      ])
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('uses the whole-node setter for empty text without reading an empty range', async () => {
    const probe = await createParagraphProbe(field, [], '')
    expect((await probe.update(12)).mutationCount).toBe(1)
    expect(probe.label[field]).toBe(12)
    expect(probe.writeBase).toHaveBeenCalledExactlyOnceWith(12)
    expect(probe.write).not.toHaveBeenCalled()
    await expect(probe.update(12)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preserves a partial-paragraph override without rewriting it on every apply', async () => {
    const probe = await createParagraphProbe(field)
    const updated = await probe.update(10, [{ start: 1, end: 2, value: 20 }])

    expect(probe.values()).toEqual([20, 10, 10])
    expect(updated).toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('preserves overrides when the base changes and converges', async () => {
    const probe = await createParagraphProbe(field)
    const ranges = [{ start: 1, end: 2, value: 20 }]
    const updated = await probe.update(12, ranges)

    expect(probe.values()).toEqual([20, 12, 12])
    expect(updated.mutationCount).toBeGreaterThan(0)

    probe.write.mockClear()
    await expect(probe.update(12, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('preserves an override on an empty first paragraph', async () => {
    const probe = await createParagraphProbe(field, [20, 10, 10], '\nworld\nagain')
    await expect(probe.update(10, [{ start: 0, end: 1, value: 20 }])).resolves.toMatchObject({
      mutationCount: 0,
      updatedNodeIds: []
    })
    expect(probe.values()).toEqual([20, 10, 10])
    expect(probe.write).not.toHaveBeenCalled()
  })

  it.each([
    { start: 1, end: 5, values: [20, 10, 10], boundary: 'before the newline' },
    { start: 1, end: 6, values: [20, 10, 10], boundary: 'after the newline' },
    { start: 5, end: 6, values: [20, 10, 10], boundary: 'only the newline' },
    { start: 6, end: 7, values: [10, 20, 10], boundary: 'the next paragraph start' },
    { start: 5, end: 7, values: [20, 20, 10], boundary: 'across the newline' }
  ])('respects $boundary coverage', async ({ start, end, values }) => {
    const probe = await createParagraphProbe(field, values)
    const updated = await probe.update(10, [{ start, end, value: 20 }])

    expect(probe.values()).toEqual(values)
    expect(updated).toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('coalesces adjacent equal overrides within the same paragraph', async () => {
    const probe = await createParagraphProbe(field)
    const updated = await probe.update(10, [
      { start: 0, end: 1, value: 20 },
      { start: 1, end: 2, value: 20 }
    ])

    expect(probe.values()).toEqual([20, 10, 10])
    expect(updated).toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('preserves the later override when adjacent character ranges touch the same paragraph', async () => {
    const probe = await createParagraphProbe(field, [30, 10, 10])
    const updated = await probe.update(10, [
      { start: 0, end: 1, value: 20 },
      { start: 1, end: 2, value: 30 }
    ])

    expect(probe.values()).toEqual([30, 10, 10])
    expect(updated).toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('restores the authored base when its range override is removed', async () => {
    const probe = await createParagraphProbe(field)
    expect((await probe.update(10)).mutationCount).toBe(1)
    expect(probe.values()).toEqual([10, 10, 10])

    probe.write.mockClear()
    await expect(probe.update(10)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('preserves existing paragraph values when the field is omitted', async () => {
    const probe = await createParagraphProbe(field)
    await expect(probe.update(undefined)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.values()).toEqual([20, 10, 10])
    expect(probe.write).not.toHaveBeenCalled()

    expect((await probe.update(undefined, [{ start: 1, end: 2, value: 25 }])).mutationCount).toBe(1)
    expect(probe.values()).toEqual([25, 10, 10])
    probe.write.mockClear()
    await expect(probe.update(undefined)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.values()).toEqual([25, 10, 10])
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('converges a variable overridden by a later literal in the same paragraph', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 7, variables: { [field]: { id: 'variable:spacing' } } },
      { start: 8, end: 9, [field]: 30 }
    ]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([8, 30, 0])
    expect(probe.aliases()).toEqual(['variable:spacing', undefined, undefined])

    probe.write.mockClear()
    probe.bind.mockClear()
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.write).not.toHaveBeenCalled()
    expect(probe.bind).not.toHaveBeenCalled()

    // Removing the later literal restores the earlier variable on that paragraph.
    await probe.update(undefined, [ranges[0]!])
    expect(probe.values()).toEqual([8, 8, 0])
    expect(probe.aliases()).toEqual(['variable:spacing', 'variable:spacing', undefined])
    await expect(probe.update(undefined, [ranges[0]!])).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it('does not treat a later null binding as ownership of the paragraph value', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    await probe.update(undefined, [
      { start: 0, end: 1, variables: { [field]: { id: 'variable:spacing' } } },
      { start: 2, end: 3, variables: { [field]: null } }
    ])
    expect(probe.values()).toEqual([8, 0, 0])
    expect(probe.aliases()).toEqual([undefined, undefined, undefined])
  })

  it('clears an explicit null binding before an equal later paragraph literal', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    await probe.update(undefined, [
      { start: 0, end: 1, variables: { [field]: { id: 'variable:spacing' } } }
    ])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, variables: { [field]: null } },
      { start: 2, end: 3, [field]: 8 }
    ]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([8, 0, 0])
    expect(probe.aliases()).toEqual([undefined, undefined, undefined])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each([
    { start: 0, end: 1, laterStart: 2, laterEnd: 3 },
    { start: 0, end: 7, laterStart: 8, laterEnd: 9 }
  ])(
    'preserves a later paragraph binding after null at $start:$end',
    async ({ start, end, laterStart, laterEnd }) => {
      const probe = await createParagraphProbe(field, [0, 0, 0])
      await probe.update(undefined, [
        { start: 0, end: 17, variables: { [field]: { id: 'variable:spacing' } } }
      ])
      const ranges: CanvasFigmaTextRange[] = [
        { start, end, variables: { [field]: null } },
        {
          start: laterStart,
          end: laterEnd,
          variables: { [field]: { id: 'variable:spacing' } }
        }
      ]
      const aliases =
        laterStart === 2
          ? ['variable:spacing', 'variable:spacing', 'variable:spacing']
          : [undefined, 'variable:spacing', 'variable:spacing']
      await probe.update(undefined, ranges)
      expect(probe.aliases()).toEqual(aliases)
      expect(probe.values()).toEqual([8, 8, 8])
      probe.bind.mockClear()
      await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
      expect(probe.bind).not.toHaveBeenCalled()

      // Removing the later owner allows the null declaration to clear its paragraph.
      await probe.update(undefined, [ranges[0]!])
      expect(probe.aliases()).toEqual(
        laterStart === 2
          ? [undefined, 'variable:spacing', 'variable:spacing']
          : [undefined, undefined, 'variable:spacing']
      )
    }
  )

  it.each([false, true])(
    'preserves a later TextStyle paragraph binding after null: cross-paragraph=%s',
    async (crossParagraph) => {
      const probe = await createParagraphProbe(field, [0, 0, 0])
      const style = probe.fixture.styles.get('style:text') as TextStyle
      Object.assign(style, {
        hangingPunctuation: false,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: 'variable:spacing' } }
      })
      const ranges: CanvasFigmaTextRange[] = [
        { start: 0, end: crossParagraph ? 7 : 1, variables: { [field]: null } },
        {
          start: crossParagraph ? 8 : 2,
          end: crossParagraph ? 9 : 3,
          textStyle: { id: style.id }
        }
      ]
      await probe.update(undefined, ranges)
      const aliases = crossParagraph
        ? [undefined, 'variable:spacing', undefined]
        : ['variable:spacing', undefined, undefined]
      expect(probe.aliases()).toEqual(aliases)
      for (let repeat = 0; repeat < 2; repeat++) {
        await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
        expect(probe.aliases()).toEqual(aliases)
      }
    }
  )

  it('clears null before a later unchanged TextStyle without a paragraph binding', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    const styled: CanvasFigmaTextRange = {
      start: 2,
      end: 3,
      textStyle: { id: 'style:text' }
    }
    await probe.update(undefined, [styled])
    await probe.update(undefined, [
      { start: 0, end: 1, variables: { [field]: { id: 'variable:spacing' } } }
    ])
    expect(probe.aliases()).toEqual(['variable:spacing', undefined, undefined])

    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, variables: { [field]: null } },
      styled
    ]
    await probe.update(undefined, ranges)
    expect(probe.aliases()).toEqual([undefined, undefined, undefined])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each(['equal literal', 'different literal', 'local null', 'later null'] as const)(
    'preserves the final paragraph binding when the later style has a %s',
    async (override) => {
      const probe = await createParagraphProbe(field, [0, 0, 0])
      const style = probe.fixture.styles.get('style:text') as TextStyle
      Object.assign(style, {
        hangingPunctuation: false,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: 'variable:spacing' } }
      })
      const styled: CanvasFigmaTextRange = {
        start: 2,
        end: 3,
        textStyle: { id: style.id }
      }
      if (override === 'local null') styled.variables = { [field]: null }
      else if (override !== 'later null') styled[field] = override === 'equal literal' ? 8 : 12
      const ranges: CanvasFigmaTextRange[] = [
        { start: 0, end: 1, variables: { [field]: null } },
        styled,
        ...(override === 'later null' ? [{ start: 4, end: 5, variables: { [field]: null } }] : [])
      ]
      await probe.update(undefined, ranges)
      const aliases = [
        override === 'equal literal' ? 'variable:spacing' : undefined,
        undefined,
        undefined
      ]
      const values = [override === 'different literal' ? 12 : 8, 0, 0]
      expect(probe.aliases()).toEqual(aliases)
      expect(probe.values()).toEqual(values)
      for (let repeat = 0; repeat < 2; repeat++) {
        await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
        expect(probe.aliases()).toEqual(aliases)
        expect(probe.values()).toEqual(values)
      }
    }
  )

  it('does not preserve a different alias when a later style retains semantic overrides', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    const style = probe.fixture.styles.get('style:text') as TextStyle
    Object.assign(style, {
      hangingPunctuation: false,
      boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: 'variable:spacing' } }
    })
    const styled: CanvasFigmaTextRange = {
      start: 2,
      end: 3,
      textStyle: { id: style.id },
      [field]: 12
    }
    await probe.update(undefined, [styled])
    const collection = figma.variables.createVariableCollection('Other metric')
    const other = figma.variables.createVariable('Other metric', collection, 'FLOAT')
    other.setValueForMode(collection.defaultModeId, 12)
    await probe.update(undefined, [{ start: 2, end: 3, variables: { [field]: { id: other.id } } }])
    const segments = vi.mocked(probe.label.getStyledTextSegments).getMockImplementation()!
    vi.spyOn(probe.label, 'getStyledTextSegments').mockImplementation((...args) =>
      segments(...args).map((segment) => ({
        ...segment,
        textStyleOverrides: [{ type: 'SEMANTIC_ITALIC' as const }]
      }))
    )
    expect(probe.aliases()).toEqual([other.id, undefined, undefined])

    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, variables: { [field]: null } },
      styled
    ]
    await probe.update(undefined, ranges)
    expect(probe.aliases()).toEqual([undefined, undefined, undefined])
    expect(probe.values()).toEqual([12, 0, 0])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each([
    { start: 1, end: 2, aliases: [undefined, 'variable:spacing', 'variable:spacing'] },
    { start: 5, end: 6, aliases: [undefined, 'variable:spacing', 'variable:spacing'] },
    { start: 5, end: 7, aliases: [undefined, undefined, 'variable:spacing'] },
    { start: 0, end: 17, aliases: [undefined, undefined, undefined] }
  ])('clears touched paragraphs only for $start:$end', async ({ start, end, aliases }) => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    await probe.update(undefined, [
      { start: 0, end: 17, variables: { [field]: { id: 'variable:spacing' } } }
    ])
    const ranges: CanvasFigmaTextRange[] = [{ start, end, variables: { [field]: null } }]
    await probe.update(undefined, ranges)
    expect(probe.aliases()).toEqual(aliases)
    expect(probe.values()).toEqual([8, 8, 8])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preserves a later independent paragraph binding after clearing the first paragraph', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    const collection = figma.variables.createVariableCollection('Later metric')
    const later = figma.variables.createVariable('Later metric', collection, 'FLOAT')
    later.setValueForMode(collection.defaultModeId, 12)
    await probe.update(undefined, [
      { start: 0, end: 17, variables: { [field]: { id: 'variable:spacing' } } }
    ])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 1, end: 2, variables: { [field]: null } },
      { start: 6, end: 7, variables: { [field]: { id: later.id } } }
    ]
    await probe.update(undefined, ranges)
    expect(probe.aliases()).toEqual([undefined, later.id, 'variable:spacing'])
    expect(probe.values()).toEqual([8, 12, 8])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('retains the requested alias when an equal later literal would not overwrite it', async () => {
    const probe = await createParagraphProbe(field, [8, 0, 0])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, variables: { [field]: { id: 'variable:spacing' } } },
      { start: 2, end: 3, [field]: 8 }
    ]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([8, 0, 0])
    expect(probe.aliases()).toEqual(['variable:spacing', undefined, undefined])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('does not preserve a different alias just because its value equals a later literal', async () => {
    const probe = await createParagraphProbe(field, [0, 0, 0])
    const collection = figma.variables.createVariableCollection('Other metric')
    const other = figma.variables.createVariable('Other metric', collection, 'FLOAT')
    other.setValueForMode(collection.defaultModeId, 30)
    await probe.update(undefined, [{ start: 0, end: 1, variables: { [field]: { id: other.id } } }])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, variables: { [field]: { id: 'variable:spacing' } } },
      { start: 2, end: 3, [field]: 30 }
    ]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([30, 0, 0])
    expect(probe.aliases()).toEqual([undefined, undefined, undefined])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preserves a later literal setter clearing aliases beyond the earlier variable range', async () => {
    const probe = await createParagraphProbe(field, [30, 0, 0])
    const collection = figma.variables.createVariableCollection('Other metric')
    const other = figma.variables.createVariable('Other metric', collection, 'FLOAT')
    other.setValueForMode(collection.defaultModeId, 30)
    await probe.update(undefined, [{ start: 6, end: 7, variables: { [field]: { id: other.id } } }])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, variables: { [field]: { id: 'variable:spacing' } } },
      { start: 2, end: 7, [field]: 30 }
    ]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([30, 30, 0])
    expect(probe.aliases()).toEqual([undefined, undefined, undefined])
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })
})

describe('paragraph comparison scopes', () => {
  it('preserves newline, empty-paragraph, and cross-paragraph boundaries for each field', () => {
    const paragraphs = textParagraphs('\nHi\nnext\nend', [
      { start: 0, end: 1, paragraphIndent: 1 },
      { start: 1, end: 2, paragraphIndent: 2 },
      { start: 2, end: 5, paragraphSpacing: 3 },
      { start: 5, end: 6, textStyle: null, variables: { paragraphIndent: null } },
      { start: 6, end: 7, textStyle: { id: 'style:type' } },
      { start: 9, end: 10, paragraphIndent: 4 }
    ])
    expect(paragraphs.map(({ span }) => span)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 4 },
      { start: 1, end: 9 },
      { start: 4, end: 9 },
      { start: 4, end: 9 },
      { start: 9, end: 12 }
    ])
    expect(paragraphs[1]!.effective).toEqual({
      paragraphIndent: { start: 1, end: 4 },
      paragraphSpacing: { start: 1, end: 1 },
      listSpacing: { start: 1, end: 4 },
      textWrapStyle: { start: 1, end: 4 }
    })
    expect(paragraphs[2]!.effective).toEqual({
      paragraphIndent: { start: 1, end: 4 },
      paragraphSpacing: { start: 1, end: 4 },
      listSpacing: { start: 1, end: 4 },
      textWrapStyle: { start: 1, end: 4 }
    })
  })

  it.each([null, { id: 'variable:spacing' }])(
    'distinguishes a null unbinding from a paragraph variable owner: %j',
    (reference) => {
      const paragraphs = textParagraphs('Hello\nworld', [
        { start: 0, end: 1, paragraphIndent: 10 },
        { start: 2, end: 3, textStyle: null, variables: { paragraphIndent: reference } }
      ])
      expect(paragraphs[0]!.effective).toEqual({
        paragraphIndent: { start: 0, end: reference ? 0 : 6 },
        paragraphSpacing: { start: 0, end: 6 },
        listSpacing: { start: 0, end: 6 },
        textWrapStyle: { start: 0, end: 6 }
      })
    }
  )

  it('uses UTF-16 offsets when a range ends exactly after a newline', () => {
    const paragraphs = textParagraphs('😀\nline', [
      { start: 0, end: 3, paragraphIndent: 10 },
      { start: 3, end: 4, paragraphIndent: 20 }
    ])
    expect(paragraphs.map(({ span }) => span)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 7 }
    ])
    expect(paragraphs[0]!.effective.paragraphIndent).toEqual({ start: 0, end: 3 })
  })
})
