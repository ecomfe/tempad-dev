import type { CanvasFigmaTextRange, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

type TextField =
  | 'fontName'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textCase'
  | 'textDecoration'
  | 'listSpacing'
  | 'hyperlink'

// Unlike the fixture's independent range map, native whole-node getters become
// mixed and whole-node setters replace every character's value.
function nativeTextField(
  node: TextNode,
  field: TextField,
  values: unknown[]
): { read: (start?: number, end?: number) => unknown; write: ReturnType<typeof vi.fn> } {
  const read = (start = 0, end = node.characters.length) => {
    const first = values[start]
    return values
      .slice(start, end)
      .every((value) => JSON.stringify(value) === JSON.stringify(first))
      ? first
      : figma.mixed
  }
  const write = vi.fn((value: unknown) => {
    values = Array.from({ length: node.characters.length }, () => value)
  })
  const suffix = field[0]!.toUpperCase() + field.slice(1)
  Object.defineProperty(node, field, { configurable: true, get: () => read(), set: write })
  Object.defineProperty(node, `getRange${suffix}`, { configurable: true, value: read })
  Object.defineProperty(node, `setRange${suffix}`, {
    configurable: true,
    value: (start: number, end: number, value: unknown) => values.fill(value, start, end)
  })
  return { read, write }
}

const URL_BASE = { type: 'URL', value: 'https://example.com/base' } as const
const URL_CHANGED = { type: 'URL', value: 'https://example.com/changed' } as const

const cases = [
  {
    field: 'fontName',
    classes: 'font-normal',
    changedClasses: 'font-semibold',
    override: { family: 'Inter', style: 'Bold' },
    changed: { family: 'Inter', style: 'Semi Bold' }
  },
  {
    field: 'fontSize',
    classes: 'text-[16px]',
    changedClasses: 'text-[20px]',
    override: 24,
    changed: 20
  },
  {
    field: 'lineHeight',
    classes: 'text-[16px]',
    changedClasses: 'text-[16px] leading-[160%]',
    override: { unit: 'PERCENT', value: 150.1 },
    changed: { unit: 'PERCENT', value: 160 }
  },
  {
    field: 'letterSpacing',
    classes: 'tracking-[0.5px]',
    changedClasses: 'tracking-[1.5px]',
    override: { unit: 'PERCENT', value: 2.3 },
    changed: { unit: 'PIXELS', value: 1.5 }
  },
  {
    field: 'textCase',
    classes: 'normal-case',
    changedClasses: 'lowercase',
    override: 'UPPER',
    changed: 'LOWER'
  },
  {
    field: 'textDecoration',
    classes: 'no-underline',
    changedClasses: 'line-through',
    override: 'UNDERLINE',
    changed: 'STRIKETHROUGH'
  },
  {
    field: 'listSpacing',
    classes: '',
    changedClasses: '',
    override: 8,
    changed: 12
  },
  {
    field: 'hyperlink',
    classes: '',
    changedClasses: '',
    override: { type: 'URL', value: 'https://example.com/range' },
    changed: URL_CHANGED
  }
] as const

describe('whole-node text values with range overrides', () => {
  it.each(cases)(
    'converges $field overrides and still applies changes outside them',
    async (test) => {
      const fixture = createFixture()
      const request = (changed = false): CanvasResolvedApplyParameters => ({
        mode: 'create',
        markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 font-sans ${test.field === 'fontName' ? '' : 'font-normal'} ${changed ? test.changedClasses : test.classes}">Range metrics</span></div>`,
        bindings: {
          label: {
            figma: {
              text: {
                ...(test.field === 'hyperlink'
                  ? { hyperlink: changed ? URL_CHANGED : URL_BASE }
                  : {}),
                ...(test.field === 'listSpacing' ? { listSpacing: changed ? 12 : 4 } : {}),
                ranges: [{ start: 0, end: 5, [test.field]: test.override }]
              }
            }
          }
        }
      })
      const created = await applyCanvas(request())
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const base = label[test.field]
      const field = nativeTextField(
        label,
        test.field,
        Array.from({ length: label.characters.length }, (_, index) =>
          index < 5 ? test.override : base
        )
      )
      const update = (changed = false) =>
        applyCanvas({ ...request(changed), mode: 'update', targetNodeId: created.rootNodeId! })

      await expect(update()).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(field.write).not.toHaveBeenCalled()
      expect((await update(true)).mutationCount).toBeGreaterThan(0)
      expect(field.read(0, 5)).toEqual(test.override)
      expect(field.read(5)).toEqual(test.changed)
      await expect(update(true)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    }
  )

  it.each(['full coverage', 'separate ranges'] as const)(
    'preserves base line height with %s',
    async (coverage) => {
      const fixture = createFixture()
      const override = { unit: 'PERCENT', value: 150.1 } as const
      const ranges =
        coverage === 'full coverage'
          ? [{ start: 0, end: 13, lineHeight: override }]
          : [
              { start: 2, end: 4, lineHeight: override },
              { start: 6, end: 8, lineHeight: override }
            ]
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 text-[16px]">Range metrics</span></div>',
        bindings: { label: { figma: { text: { ranges } } } }
      }
      const created = await applyCanvas(input)
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const field = nativeTextField(
        label,
        'lineHeight',
        Array.from({ length: label.characters.length }, (_, index) =>
          ranges.some((range) => index >= range.start && index < range.end)
            ? override
            : { unit: 'PERCENT', value: 150 }
        )
      )
      await expect(
        applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
      ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(field.write).not.toHaveBeenCalled()
    }
  )

  it.each(['unrelated field', 'null references', 'text style', 'metric variable'] as const)(
    'identifies metric ownership for %s',
    async (ownership) => {
      const fixture = createFixture()
      const range: CanvasFigmaTextRange = { start: 0, end: 5, textCase: 'UPPER' }
      if (ownership === 'null references') {
        range.textStyle = null
        range.variables = { lineHeight: null }
      } else if (ownership === 'text style') range.textStyle = { id: 'style:text' }
      else if (ownership === 'metric variable')
        range.variables = { lineHeight: { id: 'variable:spacing' } }
      const ownsMetric = ownership === 'text style' || ownership === 'metric variable'
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10 text-[16px]">Range metrics</span></div>',
        bindings: { label: { figma: { text: { ranges: [range] } } } }
      }
      const created = await applyCanvas(input)
      const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
      const field = nativeTextField(
        label,
        'lineHeight',
        Array.from({ length: label.characters.length }, (_, index) =>
          index < 5 ? { unit: 'PIXELS', value: 32 } : { unit: 'PERCENT', value: 150 }
        )
      )
      const result = await applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
      expect(result.mutationCount).toBe(ownsMetric ? 0 : 1)
      expect(field.read(0, 5)).toEqual(
        ownsMetric ? { unit: 'PIXELS', value: 32 } : { unit: 'PERCENT', value: 150 }
      )
      expect(field.write).toHaveBeenCalledTimes(ownsMetric ? 0 : 1)
    }
  )

  it('keeps the effective range hyperlink when it covers a deferred base hyperlink completely', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">Range metrics</span><div data-key="target" class="w-10 h-10"/></div>',
      bindings: {
        label: {
          figma: {
            text: {
              hyperlink: { type: 'NODE', value: { canvasKey: 'target' } },
              ranges: [{ start: 0, end: 13, hyperlink: URL_BASE }]
            }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    expect(label.getRangeHyperlink(0, 13)).toEqual(URL_BASE)
    const field = nativeTextField(
      label,
      'hyperlink',
      Array.from({ length: 13 }, () => URL_BASE)
    )
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
    expect(field.read()).toEqual(URL_BASE)
    expect(field.write).not.toHaveBeenCalled()
  })

  it('does not treat a range TextStyle as owning its hyperlink', async () => {
    const fixture = createFixture()
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup:
        '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">Range metrics</span></div>',
      bindings: {
        label: {
          figma: {
            text: {
              hyperlink: URL_BASE,
              ranges: [{ start: 0, end: 5, textStyle: { id: 'style:text' } }]
            }
          }
        }
      }
    }
    const created = await applyCanvas(input)
    const label = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    const field = nativeTextField(
      label,
      'hyperlink',
      Array.from({ length: 13 }, (_, index) => (index < 5 ? URL_CHANGED : URL_BASE))
    )
    await expect(
      applyCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 1 })
    expect(field.read()).toEqual(URL_BASE)
  })
})
