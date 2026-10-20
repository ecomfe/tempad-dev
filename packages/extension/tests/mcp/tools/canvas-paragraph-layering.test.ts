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
    markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 whitespace-pre-wrap">${characters}</span></div>`,
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
  expect(label.characters).toBe(characters)

  // Installed @figma/plugin-typings documents setRangeParagraphSpacing(0, 1, 20)
  // changing the entire first paragraph, including its newline. ParagraphIndent
  // likewise targets paragraphs containing the supplied characters. Model those
  // semantics rather than the shared fake's independent start:end range records.
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
  Object.defineProperty(label, field, {
    configurable: true,
    get: () => read(0, label.characters.length),
    set: (value: number) => write(0, label.characters.length, value)
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
        paragraph.alias = variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : undefined
        if (variable) paragraph.value = variable.resolveForConsumer(label).value as number
      }
    }
  )
  Object.defineProperty(label, 'setRangeBoundVariable', { value: bind })

  return {
    values: () => paragraphs.map(({ value }) => value),
    aliases: () => paragraphs.map(({ alias }) => alias?.id),
    write,
    bind,
    update: (base: number | undefined, ranges?: Array<ParagraphRange | CanvasFigmaTextRange>) =>
      applyCanvas({
        ...request(base, ranges),
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
  }
}

describe.each(['paragraphIndent', 'paragraphSpacing'] as const)('%s layering', (field) => {
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
      textWrapStyle: { start: 1, end: 4 }
    })
    expect(paragraphs[2]!.effective).toEqual({
      paragraphIndent: { start: 1, end: 4 },
      paragraphSpacing: { start: 1, end: 4 },
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
