import type { CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

describe('native text metric reconciliation', () => {
  it.each([
    ['fontSize', 16.1, 16.10000228881836],
    ['paragraphIndent', 1.1, 1.1000001430511475],
    ['paragraphSpacing', 3.1, 3.1000001430511475],
    ['listSpacing', 4.1, 4.100000381469727]
  ] as const)(
    'converges TextStyle %s without hiding a representable change',
    async (field, initial, next) => {
      const fixture = createFixture()
      const createTextStyle = vi.mocked(figma.createTextStyle).getMockImplementation()!
      const writes = vi.fn()
      vi.mocked(figma.createTextStyle).mockImplementation(() => {
        const style = createTextStyle()
        let stored = style[field]
        Object.defineProperty(style, field, {
          configurable: true,
          get: () => stored,
          set: (value: number) => {
            writes(value)
            stored = Math.fround(value)
          }
        })
        return style
      })
      const request = (value: number): CanvasResolvedApplyParameters => ({
        mode: 'create',
        markup: '<div data-key="root" class="w-80 h-80"></div>',
        styles: { metric: { type: 'TEXT', name: 'Metric', [field]: value } }
      })
      const created = await applyCanvas(request(initial))
      const style = [...fixture.styles.values()].find(
        (value) => value.name === 'Metric'
      )! as TextStyle
      expect(style[field]).toBe(Math.fround(initial))
      const update = (value: number) =>
        applyCanvas({ ...request(value), mode: 'update', targetNodeId: created.rootNodeId! })
      writes.mockClear()
      await expect(update(initial)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(writes).not.toHaveBeenCalled()

      // The adjacent native value must remain a real edit, not fall inside an epsilon.
      expect(next).not.toBe(style[field])
      await expect(update(next)).resolves.toMatchObject({ mutationCount: 1, updatedNodeIds: [] })
      expect(style[field]).toBe(next)
      expect(writes).toHaveBeenCalledExactlyOnceWith(next)
      await expect(update(next)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(writes).toHaveBeenCalledOnce()
      expect([...fixture.styles.values()].find((value) => value.name === 'Metric')).toBe(style)
    }
  )

  describe.each(['node', 'range', 'style'] as const)('%s metrics', (path) => {
    it.each(['lineHeight', 'letterSpacing'] as const)(
      'converges rounded %s while preserving small value and unit changes',
      async (field) => {
        const fixture = createFixture()
        const initial: LetterSpacing = {
          unit: 'PERCENT',
          value: field === 'lineHeight' ? 150.1 : 2.3
        }
        const request = (measure: LetterSpacing): CanvasResolvedApplyParameters => {
          const utility = `${field === 'lineHeight' ? 'leading' : 'tracking'}-[${measure.value}${measure.unit === 'PERCENT' ? '%' : 'px'}]`
          const input: CanvasResolvedApplyParameters = {
            mode: 'create',
            markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10${path === 'node' ? ` ${utility}` : ''}">Label</span></div>`
          }
          if (path === 'range') {
            input.bindings = {
              label: { figma: { text: { ranges: [{ start: 0, end: 5, [field]: measure }] } } }
            }
          } else if (path === 'style') {
            input.styles = { metric: { type: 'TEXT', name: 'Metric', [field]: measure } }
            input.bindings = { label: { styles: { text: { styleKey: 'metric' } } } }
          }
          return input
        }
        const created = await applyCanvas(request(initial))
        const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
        const normalize = (measure: LetterSpacing): LetterSpacing => ({
          ...measure,
          // Observed native storage: percent line height is a float32 ratio;
          // letter spacing and pixel metrics are direct float32 values.
          value:
            field === 'lineHeight' && measure.unit === 'PERCENT'
              ? Math.fround(measure.value / 100) * 100
              : Math.fround(measure.value)
        })
        // Exact native readbacks for authored 150.1% and 2.3%, respectively.
        let stored: LetterSpacing = {
          unit: 'PERCENT',
          value: field === 'lineHeight' ? 150.10000467300415 : 2.299999952316284
        }
        const write = vi.fn((measure: LetterSpacing) => {
          stored = normalize(measure)
        })
        if (path === 'range') {
          const suffix = field === 'lineHeight' ? 'LineHeight' : 'LetterSpacing'
          Object.defineProperty(label, `getRange${suffix}`, { value: () => stored })
          Object.defineProperty(label, `setRange${suffix}`, {
            value: (_start: number, _end: number, measure: LetterSpacing) => write(measure)
          })
        } else {
          const target =
            path === 'style'
              ? [...fixture.styles.values()].find((style) => style.name === 'Metric')!
              : label
          Object.defineProperty(target, field, {
            configurable: true,
            get: () => stored,
            set: write
          })
        }
        const update = (measure: LetterSpacing) =>
          applyCanvas({ ...request(measure), mode: 'update', targetNodeId: created.rootNodeId! })

        await expect(update(initial)).resolves.toMatchObject({
          mutationCount: 0,
          updatedNodeIds: []
        })
        expect(write).not.toHaveBeenCalled()

        const changed: LetterSpacing = {
          unit: 'PERCENT',
          value: field === 'lineHeight' ? 150.10002 : 2.300001
        }
        expect(normalize(changed).value).not.toBe(stored.value)
        expect((await update(changed)).mutationCount).toBe(1)
        expect(write).toHaveBeenLastCalledWith(changed)
        await expect(update(changed)).resolves.toMatchObject({
          mutationCount: 0,
          updatedNodeIds: []
        })

        const pixels: LetterSpacing = { ...changed, unit: 'PIXELS' }
        expect((await update(pixels)).mutationCount).toBe(1)
        expect(write).toHaveBeenLastCalledWith(pixels)
        await expect(update(pixels)).resolves.toMatchObject({
          mutationCount: 0,
          updatedNodeIds: []
        })
        expect(write).toHaveBeenCalledTimes(2)
      }
    )
  })

  it.each(['node', 'range', 'style'] as const)(
    'preserves %s font variation metadata when the authored family and style match',
    async (path) => {
      const fixture = createFixture()
      const request = (fontName: FontName): CanvasResolvedApplyParameters => {
        const input: CanvasResolvedApplyParameters = {
          mode: 'create',
          markup:
            '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">Label</span></div>'
        }
        if (path === 'style') {
          input.styles = { metric: { type: 'TEXT', name: 'Metric', fontName } }
          input.bindings = { label: { styles: { text: { styleKey: 'metric' } } } }
        } else {
          input.bindings = {
            label: {
              figma: {
                text: path === 'range' ? { ranges: [{ start: 0, end: 5, fontName }] } : { fontName }
              }
            }
          }
        }
        return input
      }
      const created = await applyCanvas(request({ family: 'Inter', style: 'Regular' }))
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      let stored: FontName | typeof figma.mixed = {
        family: 'Inter',
        style: 'Regular',
        variationSettings: { slnt: 0, wght: 400 }
      }
      const write = vi.fn((value: FontName) => {
        stored = { ...value, variationSettings: { slnt: 0, wght: 700 } }
      })
      if (path === 'range') {
        label.getRangeFontName = vi.fn(() => stored)
        label.setRangeFontName = vi.fn((_start, _end, value) => write(value))
      } else {
        const target =
          path === 'style'
            ? [...fixture.styles.values()].find((style) => style.name === 'Metric')!
            : label
        Object.defineProperty(target, 'fontName', {
          configurable: true,
          get: () => stored,
          set: write
        })
      }
      const update = (fontName: FontName) =>
        applyCanvas({
          ...request(fontName),
          mode: 'update',
          targetNodeId: created.rootNodeId!
        })

      await expect(update({ family: 'Inter', style: 'Regular' })).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
      expect(write).not.toHaveBeenCalled()
      expect((await update({ family: 'Inter', style: 'Bold' })).mutationCount).toBe(1)
      expect(write).toHaveBeenLastCalledWith({ family: 'Inter', style: 'Bold' })
      await expect(update({ family: 'Inter', style: 'Bold' })).resolves.toMatchObject({
        mutationCount: 0,
        updatedNodeIds: []
      })
      expect((await update({ family: 'Roboto', style: 'Bold' })).mutationCount).toBe(1)
      expect(write).toHaveBeenLastCalledWith({ family: 'Roboto', style: 'Bold' })
      expect(figma.loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'Bold' })
      expect(write).toHaveBeenCalledTimes(2)

      if (path !== 'style') {
        stored = figma.mixed
        expect((await update({ family: 'Roboto', style: 'Bold' })).mutationCount).toBe(1)
        expect(write).toHaveBeenCalledTimes(3)
      }
    }
  )
})
