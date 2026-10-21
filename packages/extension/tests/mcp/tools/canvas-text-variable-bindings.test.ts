import type {
  CanvasFigmaTextRange,
  CanvasResolvedApplyParameters,
  CanvasVariableBindings
} from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

type MetricField = 'fontSize' | 'lineHeight' | 'letterSpacing'

async function createBindingProbe(field: MetricField, characters = 'ABCDEF') {
  const fixture = createFixture()
  const input: CanvasResolvedApplyParameters = {
    mode: 'create',
    markup: `<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 whitespace-pre-wrap">${characters}</span></div>`
  }
  const created = await applyCanvas(input)
  const node = fixture.getNode(created.nodeIdsByKey.label!) as unknown as TextNode
  const aliases: Array<VariableAlias | null> = Array(node.characters.length).fill(null)
  const values: number[] = Array(node.characters.length).fill(12)
  const wrap = (value: number) =>
    field === 'fontSize' ? value : { unit: 'PIXELS' as const, value }
  const readValue = (start: number, end: number) =>
    values.slice(start, end).every((value) => value === values[start])
      ? wrap(values[start]!)
      : figma.mixed
  const writeValue = (start: number, end: number, value: number | { value: number }) => {
    // Native metric setters also update an immediately following paragraph break.
    if (node.characters[end] === '\n') end++
    values.fill(Math.fround(typeof value === 'number' ? value : value.value), start, end)
    aliases.fill(null, start, end)
  }
  Object.defineProperty(node, field, {
    configurable: true,
    get: () => readValue(0, node.characters.length),
    set: (value: number | { value: number }) => writeValue(0, node.characters.length, value)
  })
  const suffix = field[0]!.toUpperCase() + field.slice(1)
  Object.defineProperty(node, `getRange${suffix}`, { value: readValue })
  Object.defineProperty(node, `setRange${suffix}`, { value: writeValue })
  const originalBindings = node.boundVariables
  Object.defineProperty(node, 'boundVariables', {
    configurable: true,
    get: () => ({ ...originalBindings, [field]: aliases.filter(Boolean) })
  })
  const read = vi.mocked(node.getRangeBoundVariable).getMockImplementation()!
  vi.spyOn(node, 'getRangeBoundVariable').mockImplementation((start, end, property) => {
    if (property !== field) return read(start, end, property)
    const first = aliases[start] ?? null
    return aliases.slice(start, end).every((alias) => alias?.id === first?.id) ? first : figma.mixed
  })
  const bind = vi.mocked(node.setRangeBoundVariable).getMockImplementation()!
  vi.spyOn(node, 'setRangeBoundVariable').mockImplementation((start, end, property, variable) => {
    bind(start, end, property, variable)
    if (property === field) {
      if (node.characters[end] === '\n') end++
      aliases.fill(variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : null, start, end)
      if (variable)
        values.fill(Math.fround(variable.resolveForConsumer(node).value as number), start, end)
    }
  })
  const bindNode = vi.mocked(node.setBoundVariable).getMockImplementation()!
  const write = vi.spyOn(node, 'setBoundVariable').mockImplementation((property, variable) => {
    if (typeof variable === 'string') throw new Error('Deprecated variable IDs are unsupported')
    bindNode(property, variable)
    if (property === field) {
      aliases.fill(variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : null)
      if (variable) values.fill(Math.fround(variable.resolveForConsumer(node).value as number))
    }
  })
  return {
    node,
    aliases,
    values,
    write,
    update: (variables: CanvasVariableBindings, ranges?: CanvasFigmaTextRange[]) =>
      applyCanvas({
        ...input,
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        bindings: { label: { variables, figma: { text: { ranges } } } }
      })
  }
}

describe.each(['fontSize', 'lineHeight', 'letterSpacing'] as const)('%s node bindings', (field) => {
  const literal = (value: number) =>
    field === 'fontSize' ? value : { unit: 'PIXELS' as const, value }

  it('converges a base variable with a different range literal', async () => {
    const probe = await createBindingProbe(field)
    const variable = { id: 'variable:spacing' }
    const ranges = [{ start: 2, end: 4, [field]: literal(13) }]
    await probe.update({ [field]: variable }, ranges)
    expect(probe.values).toEqual([8, 8, 13, 13, 8, 8])
    expect(probe.aliases.map((alias) => alias?.id)).toEqual([
      variable.id,
      variable.id,
      undefined,
      undefined,
      variable.id,
      variable.id
    ])
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it.each(['literal', 'variable', 'null'] as const)(
    'includes the native trailing newline in a %s override without losing the base binding',
    async (kind) => {
      const probe = await createBindingProbe(field, 'A\nB\nC')
      const variable = { id: 'variable:spacing' }
      const override = { id: 'variable:range-size' }
      const ranges = [
        {
          start: 2,
          end: 3,
          ...(kind === 'literal'
            ? { [field]: literal(13) }
            : { variables: { [field]: kind === 'null' ? null : override } })
        }
      ]
      const value = kind === 'literal' ? 13 : kind === 'null' ? 8 : 18
      await probe.update({ [field]: variable }, ranges)
      expect(probe.values).toEqual([8, 8, value, value, 8])
      expect(probe.aliases.map((alias) => alias?.id)).toEqual([
        variable.id,
        variable.id,
        kind === 'variable' ? override.id : undefined,
        kind === 'variable' ? override.id : undefined,
        variable.id
      ])
      await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
        mutationCount: 0
      })
    }
  )

  it('clears a retained newline alias without extending the setter into another newline', async () => {
    const probe = await createBindingProbe(field, 'A\nB\n\nC')
    const variable = { id: 'variable:spacing' }
    await probe.update({ [field]: variable })
    probe.aliases[2] = null
    const ranges = [{ start: 2, end: 3, variables: { [field]: null } }]
    await probe.update({ [field]: variable }, ranges)
    expect(probe.node.setRangeBoundVariable).toHaveBeenLastCalledWith(2, 3, field, null)
    expect(probe.aliases.map((alias) => alias?.id)).toEqual([
      variable.id,
      variable.id,
      undefined,
      undefined,
      variable.id,
      variable.id
    ])
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it('rejects a null setter that leaves its trailing newline bound', async () => {
    const probe = await createBindingProbe(field, 'A\nB\nC')
    const variable = { id: 'variable:spacing' }
    await probe.update({ [field]: variable })
    vi.mocked(probe.node.setRangeBoundVariable).mockImplementation((start, end) => {
      probe.aliases.fill(null, start, end)
    })
    await expect(
      probe.update({ [field]: variable }, [{ start: 2, end: 3, variables: { [field]: null } }])
    ).rejects.toThrow(`range variable link "${field}" was not cleared`)
  })

  it('repairs a foreign alias on the newline owned by a literal override', async () => {
    const probe = await createBindingProbe(field, 'A\nB\nC')
    const variable = { id: 'variable:spacing' }
    const ranges = [{ start: 2, end: 3, [field]: literal(13) }]
    await probe.update({ [field]: variable }, ranges)
    probe.aliases[3] = { type: 'VARIABLE_ALIAS', id: 'variable:range-size' }
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 2
    })
    expect(probe.aliases.slice(2, 4)).toEqual([null, null])
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it.each([null, { type: 'VARIABLE_ALIAS', id: 'variable:range-size' }] as const)(
    'still rejects an incorrect binding after the trailing newline (%s)',
    async (alias) => {
      const probe = await createBindingProbe(field, 'A\nB\nC')
      const variable = { id: 'variable:spacing' }
      const ranges = [{ start: 2, end: 3, [field]: literal(13) }]
      await probe.update({ [field]: variable }, ranges)
      probe.aliases[4] = alias
      probe.write.mockImplementation(() => {})
      await expect(probe.update({ [field]: variable }, ranges)).rejects.toThrow(
        `variable link "${field}" does not match`
      )
    }
  )

  it('retains the base alias when an equal literal skips its setter', async () => {
    const probe = await createBindingProbe(field)
    const variable = { id: 'variable:spacing' }
    const ranges = [{ start: 2, end: 4, [field]: literal(8) }]
    await probe.update({ [field]: variable }, ranges)
    expect(probe.aliases.every((alias) => alias?.id === variable.id)).toBe(true)
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it('restores the base alias when a rounded literal is equal to its native value', async () => {
    const probe = await createBindingProbe(field)
    const collection = figma.variables.createVariableCollection('Fractional metric')
    const variable = figma.variables.createVariable('Metric', collection, 'FLOAT')
    variable.setValueForMode(collection.defaultModeId, 12.3)
    const binding = { [field]: { id: variable.id } }
    await probe.update(binding, [{ start: 2, end: 4, variables: { [field]: null } }])
    expect(probe.aliases.slice(2, 4)).toEqual([null, null])
    const ranges = [{ start: 2, end: 4, [field]: literal(Math.fround(12.3)) }]
    await probe.update(binding, ranges)
    expect(probe.aliases.every((alias) => alias?.id === variable.id)).toBe(true)
    await expect(probe.update(binding, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('clears a foreign alias even when its value already equals the range literal', async () => {
    const probe = await createBindingProbe(field)
    const variable = { id: 'variable:spacing' }
    await probe.update({ [field]: variable }, [
      { start: 2, end: 4, variables: { [field]: { id: 'variable:range-size' } } }
    ])
    const ranges = [{ start: 2, end: 4, [field]: literal(18) }]
    await probe.update({ [field]: variable }, ranges)
    expect(probe.values).toEqual([8, 8, 18, 18, 8, 8])
    expect(probe.aliases.slice(2, 4)).toEqual([null, null])
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it('does not confuse one matching character run with a whole-node binding', async () => {
    const probe = await createBindingProbe(field)
    const variable = { id: 'variable:spacing' }
    await probe.update({}, [{ start: 0, end: 2, variables: { [field]: variable } }])
    expect(probe.aliases.map((alias) => alias?.id)).toEqual([
      variable.id,
      variable.id,
      undefined,
      undefined,
      undefined,
      undefined
    ])
    await probe.update({ [field]: variable })
    expect(probe.aliases.every((alias) => alias?.id === variable.id)).toBe(true)
    await expect(probe.update({ [field]: variable })).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each(['ABCDEF', 'A\nB\nC'])(
    'converges node null with a retained range alias in %j',
    async (characters) => {
      const probe = await createBindingProbe(field, characters)
      const end = characters.includes('\n') ? 3 : 4
      const ranges = [{ start: 2, end, variables: { [field]: { id: 'variable:spacing' } } }]
      await probe.update({ [field]: { id: 'variable:spacing' } })
      await probe.update({ [field]: null }, ranges)
      expect(probe.aliases.map((alias) => alias?.id)).toEqual(
        [undefined, undefined, 'variable:spacing', 'variable:spacing', undefined, undefined].slice(
          0,
          characters.length
        )
      )
      probe.write.mockClear()
      await expect(probe.update({ [field]: null }, ranges)).resolves.toMatchObject({
        mutationCount: 0
      })
      expect(probe.write).not.toHaveBeenCalled()
    }
  )

  it('rejects a native setter that binds only the first run', async () => {
    const probe = await createBindingProbe(field)
    probe.write.mockImplementation((property, variable) => {
      if (property !== field || !variable || typeof variable === 'string') return
      probe.aliases.fill({ type: 'VARIABLE_ALIAS', id: variable.id }, 0, 2)
    })
    await expect(probe.update({ [field]: { id: 'variable:spacing' } })).rejects.toThrow(
      `variable link "${field}" does not match`
    )
  })
})
