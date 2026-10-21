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

async function createReplacementProbe(field: MetricField) {
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
  // Exercise a native replacement outcome independently from how a particular
  // Figma edit propagates styles: replacement text inherits an unbound first run.
  // Reconciliation must inspect the resulting bindings before writing metrics.
  const sync = () => {
    if (characters === node.characters) return
    characters = node.characters
    cells = Array.from({ length: characters.length }, () => ({ value: 12, alias: undefined }))
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
  it('writes newly unbound text in the same request and then converges', async () => {
    const probe = await createReplacementProbe(field)
    await probe.update('Xy\nZw\nQ')
    expect(probe.state()).toEqual(
      Array.from({ length: 7 }, () => ({ value: 20, alias: undefined }))
    )
    await expect(probe.update('Xy\nZw\nQ')).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('preserves the existing bound run when characters do not change', async () => {
    const probe = await createReplacementProbe(field)
    await probe.update('Ab\nCd')
    expect(probe.state()).toEqual([
      ...Array.from({ length: 3 }, () => ({ value: 20, alias: undefined })),
      ...Array.from({ length: 2 }, () => ({ value: 8, alias: 'variable:spacing' }))
    ])
  })
})
