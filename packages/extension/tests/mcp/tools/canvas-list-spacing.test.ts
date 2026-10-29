import type { CanvasFigmaTextRange, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

async function createListProbe(initialValues = [8, 12], characters = 'First\nSecond') {
  const fixture = createFixture()
  const markup = `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 whitespace-pre-wrap">${characters || 'Empty'}</span></div>`
  const created = await applyCanvas({ mode: 'create', markup })
  const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
  if (!characters) node.characters = ''
  expect(node.characters).toBe(characters)

  // Observed in native Figma: list spacing applies to touched paragraphs.
  // Whole-node writes leave existing range values; range writes replace them.
  let offset = 0
  let base = 4
  const paragraphs = characters
    ? characters.split('\n').map((text, index, all) => {
        const start = offset
        offset += text.length + (index < all.length - 1 ? 1 : 0)
        return { start, end: offset, value: Math.fround(initialValues[index]!) }
      })
    : []
  const affected = (start: number, end: number) => {
    if (start >= end || end > characters.length) throw new Error('Invalid native text range')
    return paragraphs.filter((paragraph) => paragraph.start < end && paragraph.end > start)
  }
  const read = (start: number, end: number) => {
    const values = affected(start, end).map((paragraph) => paragraph.value)
    return values.every((value) => value === values[0]) ? values[0]! : figma.mixed
  }
  let applyingStyle = false
  const write = vi.fn((start: number, end: number, value: number) => {
    if (!applyingStyle && characters[end - 1] === '\n' && end < characters.length) end++
    for (const paragraph of affected(start, end)) paragraph.value = Math.fround(value)
  })
  const writeBase = vi.fn((value: number) => {
    base = Math.fround(value)
  })
  Object.defineProperty(node, 'listSpacing', {
    configurable: true,
    get: () => (characters ? read(0, characters.length) : base),
    set: writeBase
  })
  node.getRangeListSpacing = read
  node.setRangeListSpacing = write
  const applyStyle = node.setRangeTextStyleIdAsync.bind(node)
  node.setRangeTextStyleIdAsync = vi.fn(async (start, end, id) => {
    applyingStyle = true
    try {
      await applyStyle(start, end, id)
      if (id) write(start, end, (fixture.styles.get(id) as TextStyle).listSpacing)
    } finally {
      applyingStyle = false
    }
  })

  return {
    node,
    values: () => paragraphs.map(({ value }) => value),
    write,
    writeBase,
    update: (listSpacing?: number, ranges?: CanvasFigmaTextRange[]) => {
      const request: CanvasResolvedApplyParameters = {
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        ...(characters ? { markup } : {}),
        bindings: { label: { figma: { text: { listSpacing, ranges } } } }
      }
      return applyCanvas(request)
    }
  }
}

describe('native list spacing reconciliation', () => {
  it('replaces existing range values when only base spacing is authored', async () => {
    const probe = await createListProbe()
    expect((await probe.update(4)).mutationCount).toBe(2)
    expect(probe.values()).toEqual([4, 4])
    expect(probe.writeBase).not.toHaveBeenCalled()
    await expect(probe.update(4)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each([5, 6])('preserves a first-paragraph override ending at %i', async (end) => {
    const probe = await createListProbe()
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end, listOptions: { type: 'UNORDERED' }, listSpacing: 8 },
      { start: 6, end: 12, listOptions: { type: 'UNORDERED' } }
    ]
    await probe.update(4, ranges)
    expect(probe.values()).toEqual([8, 4])
    await expect(probe.update(4, ranges)).resolves.toMatchObject({ mutationCount: 0 })

    expect((await probe.update(12, ranges)).mutationCount).toBe(1)
    expect(probe.values()).toEqual([8, 12])
    await expect(probe.update(12, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.writeBase).not.toHaveBeenCalled()
  })

  it.each([
    { start: 5, end: 6, values: [8, 4] },
    { start: 6, end: 7, values: [4, 8] },
    { start: 5, end: 7, values: [8, 8] }
  ])('respects newline coverage at $start:$end', async ({ start, end, values }) => {
    const probe = await createListProbe(values)
    await expect(probe.update(4, [{ start, end, listSpacing: 8 }])).resolves.toMatchObject({
      mutationCount: 0
    })
    expect(probe.values()).toEqual(values)
    expect(probe.write).not.toHaveBeenCalled()
  })

  it('preserves the later spacing without skipping other fields of the earlier range', async () => {
    const probe = await createListProbe([30, 4])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 1, listSpacing: 20, fontSize: 28 },
      { start: 2, end: 3, listSpacing: 30 }
    ]
    expect((await probe.update(4, ranges)).mutationCount).toBe(1)
    expect(probe.node.getRangeFontSize(0, 1)).toBe(28)
    expect(probe.values()).toEqual([30, 4])
    expect(probe.write).not.toHaveBeenCalled()
    await expect(probe.update(4, ranges)).resolves.toMatchObject({ mutationCount: 0 })

    const zero = [ranges[0]!, { start: 2, end: 3, listSpacing: 0 }]
    expect((await probe.update(4, zero)).mutationCount).toBe(1)
    expect(probe.values()).toEqual([0, 4])
    await expect(probe.update(4, zero)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('retains the first paragraph of a cross-paragraph range and applies later changes', async () => {
    const probe = await createListProbe([20, 30])
    const ranges = [
      { start: 0, end: 7, listSpacing: 20 },
      { start: 8, end: 9, listSpacing: 30 }
    ]
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    const changed = [ranges[0]!, { start: 8, end: 9, listSpacing: 40 }]
    expect((await probe.update(undefined, changed)).mutationCount).toBe(1)
    expect(probe.values()).toEqual([20, 40])
    await expect(probe.update(undefined, changed)).resolves.toMatchObject({ mutationCount: 0 })

    const changedFirst = [{ start: 0, end: 7, listSpacing: 25 }, changed[1]!]
    await probe.update(undefined, changedFirst)
    expect(probe.values()).toEqual([25, 40])
    await expect(probe.update(undefined, changedFirst)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it('restores base spacing after removing an override and preserves omitted spacing', async () => {
    const probe = await createListProbe([8, 4])
    await expect(probe.update()).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.values()).toEqual([8, 4])

    expect((await probe.update(4)).mutationCount).toBe(2)
    expect(probe.values()).toEqual([4, 4])
    await expect(probe.update(4)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('keeps style-owned paragraphs outside the base write, including an empty first paragraph', async () => {
    const probe = await createListProbe([6, 12], '\nSecond')
    const ranges: CanvasFigmaTextRange[] = [{ start: 0, end: 1, textStyle: { id: 'style:text' } }]
    await probe.update(4, ranges)
    expect(probe.values()).toEqual([6, 4])
    probe.write.mockClear()
    await expect(probe.update(4, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.write).not.toHaveBeenCalled()

    await expect(probe.update(4, [{ start: 0, end: 1, textStyle: null }])).rejects.toThrow(
      'empty paragraph 0:1'
    )
    expect(probe.values()).toEqual([6, 4])
  })

  it('converges a composed style whose final paragraph has a later spacing override', async () => {
    const probe = await createListProbe([4, 4])
    const ranges: CanvasFigmaTextRange[] = [
      { start: 0, end: 7, textStyle: { id: 'style:text' }, fontSize: 28 },
      { start: 8, end: 9, listSpacing: 30 }
    ]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([6, 30])
    probe.write.mockClear()
    vi.mocked(probe.node.setRangeTextStyleIdAsync).mockClear()
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.write).not.toHaveBeenCalled()
    expect(probe.node.setRangeTextStyleIdAsync).not.toHaveBeenCalled()
  })

  it('converges float32 spacing while preserving the next representable value', async () => {
    const probe = await createListProbe([8, 4.1])
    const ranges = [{ start: 0, end: 5, listSpacing: 8 }]
    await expect(probe.update(4.1, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    const next = 4.100000381469727
    expect((await probe.update(next, ranges)).mutationCount).toBe(1)
    expect(probe.values()).toEqual([8, next])
    await expect(probe.update(next, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('uses the whole-node setter for empty text without reading an empty range', async () => {
    const probe = await createListProbe([], '')
    expect((await probe.update(8)).mutationCount).toBe(1)
    expect(probe.node.listSpacing).toBe(8)
    expect(probe.writeBase).toHaveBeenCalledExactlyOnceWith(8)
    expect(probe.write).not.toHaveBeenCalled()
    await expect(probe.update(8)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('does not extend an authored paragraph literal past its terminating newline', async () => {
    const probe = await createListProbe([8, 18, 28], 'A\nB\nC')
    const ranges = [{ start: 2, end: 4, listSpacing: 12 }]
    await probe.update(undefined, ranges)
    expect(probe.values()).toEqual([8, 12, 28])
    expect(probe.write).toHaveBeenCalledExactlyOnceWith(2, 3, 12)
    await expect(probe.update(undefined, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })
})
