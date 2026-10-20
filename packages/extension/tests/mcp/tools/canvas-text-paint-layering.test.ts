import type { CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

// Native Text getters aggregate the characters, and whole-node setters replace
// range values. The shared fixture intentionally does not model that behavior.
function characterValues<T>(values: T[]) {
  const read = (start = 0, end = values.length): T | typeof figma.mixed => {
    const first = values[start]!
    return values
      .slice(start, end)
      .every((value) => JSON.stringify(value) === JSON.stringify(first))
      ? first
      : figma.mixed
  }
  const setRange = vi.fn((start: number, end: number, value: T) => {
    values.fill(value, start, end)
  })
  const set = vi.fn((value: T) => setRange(0, values.length, value))
  return { read, set, setRange }
}

describe('text paint and style layering', () => {
  it.each(['utility', 'native paints', 'range style', 'full range', 'retained style'] as const)(
    'converges %s and applies changed base colors only when they own characters',
    async (kind) => {
      const fixture = createFixture()
      const rangeEnd = kind === 'full range' ? 13 : 5
      const rangeStyleId = kind === 'range style' ? 'style:stroke' : ''
      const request = (blue: boolean): CanvasResolvedApplyParameters => ({
        mode: 'create',
        markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10${kind === 'native paints' ? '' : ` text-[${blue ? '#0000FF' : '#000000'}]`}">Range metrics</span></div>`,
        bindings: {
          label: {
            figma: {
              ...(kind === 'native paints'
                ? { fills: [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: blue ? 1 : 0 } }] }
                : {}),
              text: {
                ranges: [
                  {
                    start: 0,
                    end: rangeEnd,
                    ...(rangeStyleId
                      ? { fillStyle: { id: rangeStyleId } }
                      : { fills: [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0 } }] })
                  }
                ]
              }
            }
          }
        }
      })
      const created = await applyCanvas(request(false))
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const base =
        kind === 'retained style'
          ? [...(fixture.styles.get('style:fill') as PaintStyle).paints]
          : (label.fills as Paint[])
      const override = label.getRangeFills(0, rangeEnd) as Paint[]
      const fills = characterValues(
        Array.from({ length: label.characters.length }, (_, index) =>
          index < rangeEnd ? override : base
        )
      )
      const styles = characterValues<string>(
        Array.from({ length: label.characters.length }, (_, index) =>
          index < rangeEnd ? rangeStyleId : kind === 'retained style' ? 'style:fill' : ''
        )
      )
      Object.defineProperty(label, 'fills', {
        configurable: true,
        get: () => fills.read(),
        set: (value: Paint[]) => {
          fills.set(value)
          styles.set('')
        }
      })
      Object.defineProperty(label, 'fillStyleId', { configurable: true, get: () => styles.read() })
      label.getRangeFills = fills.read
      label.setRangeFills = (start, end, value) => {
        fills.setRange(start, end, value)
        styles.setRange(start, end, '')
      }
      label.getRangeFillStyleId = styles.read
      label.setRangeFillStyleIdAsync = async (start, end, id) => {
        styles.setRange(start, end, id)
        if (id) fills.setRange(start, end, [...(fixture.styles.get(id) as PaintStyle).paints])
      }
      const update = (blue: boolean) =>
        applyCanvas({ ...request(blue), mode: 'update', targetNodeId: created.rootNodeId! })

      await expect(update(false)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(fills.set).not.toHaveBeenCalled()
      const updated = await update(true)
      expect(updated.mutationCount).toBe(kind === 'full range' || kind === 'retained style' ? 0 : 2)
      const ignoredWarnings = updated.verification.warnings.filter(
        ({ code }) => code === 'literal-ignored-by-binding'
      )
      expect(ignoredWarnings).toHaveLength(kind === 'retained style' ? 1 : 0)
      if (kind === 'retained style') {
        expect(ignoredWarnings[0]!.message).toContain('fill')
      }
      expect(fills.read(0, rangeEnd)).toEqual(override)
      expect(styles.read(0, rangeEnd)).toBe(rangeStyleId)
      if (rangeEnd < label.characters.length) {
        if (kind === 'retained style') {
          expect(fills.read(rangeEnd)).toEqual(base)
          expect(styles.read(rangeEnd)).toBe('style:fill')
        } else {
          expect(fills.read(rangeEnd)).toMatchObject([
            { type: 'SOLID', color: { r: 0, g: 0, b: 1 } }
          ])
        }
      }
      await expect(update(true)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    }
  )

  it.each([
    { field: 'text', unlink: false },
    { field: 'fill', unlink: false },
    { field: 'text', unlink: true },
    { field: 'fill', unlink: true }
  ] as const)(
    'converges a base $field style with a different range style (unlink=$unlink)',
    async ({ field, unlink }) => {
      const fixture = createFixture()
      const baseId = unlink ? '' : `style:${field}`
      const rangeId = 'style:range'
      const changedId = 'style:changed'
      fixture.styles.set(rangeId, { ...fixture.styles.get(`style:${field}`)!, id: rangeId })
      fixture.styles.set(changedId, { ...fixture.styles.get(`style:${field}`)!, id: changedId })
      const rangeField = field === 'text' ? 'textStyle' : 'fillStyle'
      const request = (id: string): CanvasResolvedApplyParameters => ({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">Range metrics</span></div>',
        bindings: {
          label: {
            styles: { [field]: id ? { id } : null },
            figma: { text: { ranges: [{ start: 0, end: 5, [rangeField]: { id: rangeId } }] } }
          }
        }
      })
      const created = await applyCanvas(request(baseId))
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const ids = characterValues(
        Array.from({ length: label.characters.length }, (_, index) =>
          index < 5 ? rangeId : baseId
        )
      )
      const property = field === 'text' ? 'textStyleId' : 'fillStyleId'
      Object.defineProperty(label, property, { configurable: true, get: () => ids.read() })
      const setStyle = vi.fn(async (id: string) => ids.set(id))
      const setRangeStyle = vi.fn(async (start: number, end: number, id: string) => {
        ids.setRange(start, end, id)
      })
      if (field === 'text') {
        label.setTextStyleIdAsync = setStyle
        label.getRangeTextStyleId = ids.read
        label.setRangeTextStyleIdAsync = setRangeStyle
      } else {
        label.setFillStyleIdAsync = setStyle
        label.getRangeFillStyleId = ids.read
        label.setRangeFillStyleIdAsync = setRangeStyle
      }

      const update = (id: string) =>
        applyCanvas({ ...request(id), mode: 'update', targetNodeId: created.rootNodeId! })
      await expect(update(baseId)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(setStyle).not.toHaveBeenCalled()
      expect((await update(changedId)).mutationCount).toBe(2)
      expect(ids.read(0, 5)).toBe(rangeId)
      expect(ids.read(5)).toBe(changedId)
      await expect(update(changedId)).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
    }
  )

  it.each(['fills', 'textStyle', 'fillStyle'] as const)(
    'rejects a silently ignored full-range %s write',
    async (field) => {
      const fixture = createFixture()
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 text-black">Range metrics</span></div>'
      }
      const created = await applyCanvas(input)
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      if (field === 'fills') label.setRangeFills = vi.fn()
      else if (field === 'textStyle') label.setRangeTextStyleIdAsync = vi.fn(async () => {})
      else label.setRangeFillStyleIdAsync = vi.fn(async () => {})
      const value =
        field === 'fills'
          ? [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0 } }]
          : { id: field === 'textStyle' ? 'style:text' : 'style:fill' }
      await expect(
        applyCanvas({
          ...input,
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          bindings: {
            label: { figma: { text: { ranges: [{ start: 0, end: 13, [field]: value }] } } }
          }
        })
      ).rejects.toMatchObject({
        code: 'CANVAS_APPLY_FAILED',
        message: expect.stringContaining('range 0:13')
      })
    }
  )

  it('applies the base color while explicitly clearing a range fill style', async () => {
    const fixture = createFixture()
    const markup = (color: string) =>
      `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 text-[${color}]">Range metrics</span></div>`
    const created = await applyCanvas({ mode: 'create', markup: markup('#000000') })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const red: Paint[] = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
    const black = label.fills as Paint[]
    const fills = characterValues(
      Array.from({ length: label.characters.length }, (_, index) => (index < 5 ? red : black))
    )
    const styles = characterValues<string>(
      Array.from({ length: label.characters.length }, (_, index) => (index < 5 ? 'style:fill' : ''))
    )
    Object.defineProperty(label, 'fills', {
      configurable: true,
      get: () => fills.read(),
      set: (value: Paint[]) => {
        fills.set(value)
        styles.set('')
      }
    })
    Object.defineProperty(label, 'fillStyleId', { configurable: true, get: () => styles.read() })
    label.getRangeFills = fills.read
    label.getRangeFillStyleId = styles.read
    label.setRangeFillStyleIdAsync = async (start, end, id) => styles.setRange(start, end, id)
    const update = () =>
      applyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        markup: markup('#0000FF'),
        bindings: {
          label: { figma: { text: { ranges: [{ start: 0, end: 5, fillStyle: null }] } } }
        }
      })
    const updated = await update()
    expect(
      updated.verification.warnings.filter(({ code }) => code === 'literal-ignored-by-binding')
    ).toEqual([])
    expect(fills.read()).toMatchObject([{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }])
    expect(styles.read()).toBe('')
    await expect(update()).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
  })

  it('still warns when a paint variable owns the base color outside a range style', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 text-black">Range metrics</span></div>',
      bindings: {
        label: {
          figma: { text: { ranges: [{ start: 0, end: 5, fillStyle: { id: 'style:fill' } }] } }
        }
      }
    }
    const created = await applyCanvas(input)
    const label = fixture.getNode(created.nodeIdsByKey.label!)
    Object.defineProperty(label, 'fillStyleId', { configurable: true, value: figma.mixed })
    Object.assign(label.boundVariables, {
      fills: [{ type: 'VARIABLE_ALIAS', id: 'variable:color' }]
    })
    const updated = await applyCanvas({
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      markup: input.markup!.replace('text-black', 'text-white')
    })
    expect(updated.mutationCount).toBe(0)
    expect(updated.verification.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'literal-ignored-by-binding',
          key: 'label',
          message: expect.stringContaining('fill')
        })
      ])
    )
    expect(label.boundVariables.fills).toEqual([{ type: 'VARIABLE_ALIAS', id: 'variable:color' }])
  })
})
