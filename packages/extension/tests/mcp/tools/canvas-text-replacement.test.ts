import type { CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { describe, expect, it } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

type MetricField =
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'paragraphIndent'
  | 'paragraphSpacing'
type CharacterMetric = { value: number; alias: string | undefined }

async function createReplacementProbe(field: MetricField, retainBinding = false) {
  const fixture = createFixture()
  const request = (characters: string, value?: number): CanvasResolvedApplyParameters => {
    const utilities = {
      fontSize: `text-[${value}px]`,
      lineHeight: `leading-[${value}px]`,
      letterSpacing: `tracking-[${value}px]`,
      paragraphIndent: '',
      paragraphSpacing: ''
    }
    return {
      mode: 'create',
      markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 whitespace-pre-wrap ${value === undefined ? '' : utilities[field]}">${characters}</span></div>`,
      bindings: {
        label: {
          figma: {
            text: {
              hangingPunctuation: false,
              ...(field === 'paragraphIndent' || field === 'paragraphSpacing'
                ? { [field]: value }
                : {})
            }
          }
        }
      }
    }
  }
  const created = await applyCanvas(request('Ab\nCd'))
  const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
  let characters = node.characters
  let cells: CharacterMetric[] = Array.from({ length: characters.length }, (_, index) => ({
    value: index < 3 ? 12 : 8,
    alias: index < 3 ? undefined : 'variable:spacing'
  }))
  // Native replacement can retain or discard aliases. Reconciliation and its
  // warnings must inspect the resulting ownership rather than the old ranges.
  const sync = () => {
    if (characters === node.characters) return
    characters = node.characters
    cells = Array.from({ length: characters.length }, () => ({
      value: retainBinding ? 8 : 12,
      alias: retainBinding ? 'variable:spacing' : undefined
    }))
  }
  const wrap = (value: number) =>
    field === 'lineHeight' || field === 'letterSpacing' ? { unit: 'PIXELS', value } : value
  const read = (start: number, end: number) => {
    sync()
    const values = cells.slice(start, end).map((cell) => cell.value)
    return values.every((value) => value === values[0]) ? wrap(values[0]!) : figma.mixed
  }
  const write = (start: number, end: number, value: number | { value: number }) => {
    sync()
    if (field === 'paragraphIndent' || field === 'paragraphSpacing') {
      if (characters[end - 1] === '\n' && end < characters.length) end++
      start = start === 0 ? 0 : characters.lastIndexOf('\n', start - 1) + 1
      const newline = characters.indexOf('\n', end - 1)
      end = newline === -1 ? characters.length : newline + 1
    } else if (characters[end] === '\n') {
      end++
    }
    for (const cell of cells.slice(start, end)) {
      cell.value = typeof value === 'number' ? value : value.value
      cell.alias = undefined
    }
  }
  Object.defineProperty(node, field, {
    configurable: true,
    get: () => read(0, node.characters.length),
    set: (value: number | { value: number }) => {
      // Whole-node paragraph setters retain existing paragraph overrides.
      if (field !== 'paragraphIndent' && field !== 'paragraphSpacing') {
        write(0, node.characters.length, value)
      }
    }
  })
  const suffix = field[0]!.toUpperCase() + field.slice(1)
  Object.defineProperty(node, `getRange${suffix}`, { value: read })
  Object.defineProperty(node, `setRange${suffix}`, { value: write })
  const originalBindings = node.boundVariables
  Object.defineProperty(node, 'boundVariables', {
    configurable: true,
    get: () => {
      sync()
      return {
        ...originalBindings,
        [field]: cells.flatMap(({ alias }) =>
          alias ? [{ type: 'VARIABLE_ALIAS', id: alias }] : []
        )
      }
    }
  })
  const readBinding = node.getRangeBoundVariable.bind(node)
  Object.defineProperty(node, 'getRangeBoundVariable', {
    value: (start: number, end: number, property: VariableBindableTextField) => {
      if (property !== field) return readBinding(start, end, property)
      sync()
      const aliases = cells.slice(start, end).map((cell) => cell.alias)
      if (!aliases.every((alias) => alias === aliases[0])) return figma.mixed
      return aliases[0] ? { type: 'VARIABLE_ALIAS', id: aliases[0] } : null
    }
  })
  const readSegments = node.getStyledTextSegments.bind(node)
  const bindingSegments: TextNode['getStyledTextSegments'] = ((...args) => {
    if (args[0].length !== 1 || args[0][0] !== 'boundVariables') return readSegments(...args)
    sync()
    return cells.map(({ alias }, start) => ({
      start,
      end: start + 1,
      characters: characters[start],
      boundVariables: alias ? { [field]: { type: 'VARIABLE_ALIAS', id: alias } } : {}
    }))
  }) as TextNode['getStyledTextSegments']
  Object.defineProperty(node, 'getStyledTextSegments', { value: bindingSegments })
  return {
    state: () => {
      sync()
      return cells.map((cell) => ({ ...cell }))
    },
    update: (characters: string) =>
      applyCanvas({ ...request(characters, 20), mode: 'update', targetNodeId: created.rootNodeId! })
  }
}

describe.each([
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphIndent',
  'paragraphSpacing'
] as const)('%s after text replacement', (field) => {
  it.each(['Xy\nZw\nQ', 'X'])(
    'writes newly unbound replacement %j without a stale warning and then converges',
    async (replacement) => {
      const probe = await createReplacementProbe(field)
      const result = await probe.update(replacement)
      expect(result.verification.warnings).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'literal-ignored-by-binding' })])
      )
      expect(probe.state()).toEqual(
        Array.from({ length: replacement.length }, () => ({ value: 20, alias: undefined }))
      )
      await expect(probe.update(replacement)).resolves.toMatchObject({ mutationCount: 0 })
    }
  )

  it('preserves the existing bound run when characters do not change', async () => {
    const probe = await createReplacementProbe(field)
    await probe.update('Ab\nCd')
    expect(probe.state()).toEqual([
      ...Array.from({ length: 3 }, () => ({ value: 20, alias: undefined })),
      ...Array.from({ length: 2 }, () => ({ value: 8, alias: 'variable:spacing' }))
    ])
  })
})

it.each(['textStyleId', 'fillStyleId'] as const)(
  're-evaluates %s ownership after replacement discards a mixed style',
  async (field) => {
    const fixture = createFixture()
    const request = (text: string, utilities = ''): CanvasResolvedApplyParameters => ({
      mode: 'create',
      markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 ${utilities}">${text}</span></div>`
    })
    const created = await applyCanvas(request('ABCDEF'))
    const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
    Object.defineProperty(node, field, {
      configurable: true,
      get: () => (node.characters === 'ABCDEF' ? figma.mixed : ''),
      set: () => {}
    })
    const update = {
      ...request('XYZ', field === 'textStyleId' ? 'text-[20px]' : 'text-[#ff0000]'),
      mode: 'update' as const,
      targetNodeId: created.rootNodeId!
    }
    const result = await applyCanvas(update)
    expect(result.verification.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'literal-ignored-by-binding' })])
    )
    if (field === 'textStyleId') expect(node.fontSize).toBe(20)
    else expect(node.fills).toEqual([expect.objectContaining({ color: { r: 1, g: 0, b: 0 } })])
    await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  }
)

describe.each(['fontSize', 'lineHeight', 'letterSpacing'] as const)(
  '%s retained after text replacement',
  (field) => {
    it('still warns when replacement text actually retains a binding', async () => {
      const probe = await createReplacementProbe(field, true)
      const result = await probe.update('X')
      expect(probe.state()).toEqual([{ value: 8, alias: 'variable:spacing' }])
      expect(result.verification.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'literal-ignored-by-binding',
            message: expect.stringContaining(field)
          })
        ])
      )
    })
  }
)
