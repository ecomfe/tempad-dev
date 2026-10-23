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
  let applyingStyle = false
  const applyStyle = vi.mocked(node.setRangeTextStyleIdAsync).getMockImplementation()!
  vi.mocked(node.setRangeTextStyleIdAsync).mockImplementation(async (...args) => {
    applyingStyle = true
    try {
      await applyStyle(...args)
    } finally {
      applyingStyle = false
    }
  })
  const wrap = (value: number) =>
    field === 'fontSize' ? value : { unit: 'PIXELS' as const, value }
  const readValue = (start: number, end: number) =>
    values.slice(start, end).every((value) => value === values[start])
      ? wrap(values[start]!)
      : figma.mixed
  const writeValue = (start: number, end: number, value: number | { value: number }) => {
    // Native metric setters also update an immediately following paragraph break.
    if (!applyingStyle && node.characters[end] === '\n') end++
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
      if (!applyingStyle && node.characters[end] === '\n') end++
      aliases.fill(variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : null, start, end)
      if (variable)
        values.fill(Math.fround(variable.resolveForConsumer(node).value as number), start, end)
    }
  })
  const bindNode = vi.mocked(node.setBoundVariable).getMockImplementation()!
  let baseAlias: string | undefined
  const write = vi.spyOn(node, 'setBoundVariable').mockImplementation((property, variable) => {
    if (typeof variable === 'string') throw new Error('Deprecated variable IDs are unsupported')
    bindNode(property, variable)
    if (property === field) {
      // Reapplying the native node binding preserves local range overrides.
      if (variable && baseAlias === variable.id) return
      baseAlias = variable?.id
      aliases.fill(variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : null)
      if (variable) values.fill(Math.fround(variable.resolveForConsumer(node).value as number))
    }
  })
  const segments = vi.mocked(node.getStyledTextSegments).getMockImplementation()!
  vi.spyOn(node, 'getStyledTextSegments').mockImplementation(((...args) => {
    if (args[0].length !== 1 || args[0][0] !== 'boundVariables') return segments(...args)
    return aliases.map((alias, start) => ({
      start,
      end: start + 1,
      characters: characters[start],
      boundVariables: alias ? { [field]: alias } : {}
    }))
  }) as TextNode['getStyledTextSegments'])
  return {
    node,
    aliases,
    values,
    write,
    fixture,
    update: (variables: CanvasVariableBindings, ranges?: CanvasFigmaTextRange[], base?: number) =>
      applyCanvas({
        ...input,
        markup:
          base === undefined
            ? input.markup
            : input.markup!.replace(
                'whitespace-pre-wrap',
                `whitespace-pre-wrap ${{ fontSize: 'text', lineHeight: 'leading', letterSpacing: 'tracking' }[field]}-[${base}px]`
              ),
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        bindings: { label: { variables, figma: { text: { ranges } } } }
      })
  }
}

describe.each(['fontSize', 'lineHeight', 'letterSpacing'] as const)('%s node bindings', (field) => {
  const literal = (value: number) =>
    field === 'fontSize' ? value : { unit: 'PIXELS' as const, value }

  it('keeps the later variable owner when a range starts on the preceding newline', async () => {
    const probe = await createBindingProbe(field, 'Hello\nworld')
    const ranges = [
      { start: 0, end: 5, variables: { [field]: { id: 'variable:spacing' } } },
      { start: 5, end: 11, variables: { [field]: { id: 'variable:range-size' } } }
    ]
    await probe.update({}, ranges)
    expect(probe.values).toEqual([...Array(5).fill(8), ...Array(6).fill(18)])
    await expect(probe.update({}, ranges)).resolves.toMatchObject({ mutationCount: 0 })
    ranges[0]!.variables[field] = { id: 'variable:range-size' }
    await probe.update({}, ranges)
    expect(probe.aliases.every((alias) => alias?.id === 'variable:range-size')).toBe(true)
    await expect(probe.update({}, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('repairs a later equal literal after the preceding setter crosses its newline', async () => {
    const probe = await createBindingProbe(field, 'Hello\nworld')
    const base = { id: 'variable:spacing' }
    const ranges = [
      { start: 0, end: 5, [field]: literal(20) },
      { start: 5, end: 11, [field]: literal(8) }
    ]
    await probe.update({ [field]: base }, ranges)
    expect(probe.values).toEqual([...Array(5).fill(20), ...Array(6).fill(8)])
    expect(probe.aliases.map((alias) => alias?.id)).toEqual([
      ...Array(5).fill(undefined),
      ...Array(6).fill(base.id)
    ])
    await expect(probe.update({ [field]: base }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it.each(['literal', 'variable'] as const)(
    'rejects an unretained leading-newline %s binding and preserves the supported content range',
    async (kind) => {
      const probe = await createBindingProbe(field, 'Hello\nworld')
      const base = { id: 'variable:spacing' }
      await probe.update({ [field]: base })
      const bind = vi.mocked(probe.node.setRangeBoundVariable).getMockImplementation()!
      vi.mocked(probe.node.setRangeBoundVariable).mockImplementation(
        (start, end, property, variable) => {
          // Native fontSize evidence leaves the leading LF unchanged. Exercise
          // the same defensive check for all three metrics, without claiming
          // native evidence for the other fields or other line breaks.
          if (property === field && variable && probe.node.characters[start] === '\n') start++
          bind(start, end, property, variable)
        }
      )
      const segments = vi.mocked(probe.node.getStyledTextSegments).getMockImplementation()!
      vi.mocked(probe.node.getStyledTextSegments).mockImplementation((fields) =>
        probe.aliases.map((alias, start) => ({
          ...segments(fields)[0]!,
          start,
          end: start + 1,
          characters: probe.node.characters[start]!,
          [field]: literal(probe.values[start]!),
          boundVariables: alias ? { [field]: alias } : {}
        }))
      )
      probe.fixture.triggerUndo.mockImplementationOnce(() => {
        probe.node.setRangeBoundVariable(
          0,
          probe.node.characters.length,
          field,
          probe.fixture.variables.get(base.id)!
        )
      })
      const later = kind === 'literal' ? { [field]: literal(8) } : { variables: { [field]: base } }
      const ranges = [
        { start: 0, end: 5, [field]: literal(20) },
        { start: 5, end: 11, ...later }
      ]
      await expect(probe.update({ [field]: base }, ranges)).rejects.toMatchObject({
        code: 'CANVAS_APPLY_FAILED',
        message: expect.stringContaining('The leading newline at 5:6 did not retain')
      })
      expect(probe.fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(probe.values).toEqual(Array(11).fill(8))
      expect(probe.aliases.every((alias) => alias?.id === base.id)).toBe(true)

      ranges[1]!.start = 6
      await probe.update({ [field]: base }, ranges)
      expect(probe.values).toEqual([...Array(6).fill(20), ...Array(5).fill(8)])
      expect(probe.aliases.map((alias) => alias?.id)).toEqual([
        ...Array(6).fill(undefined),
        ...Array(5).fill(base.id)
      ])
      await expect(probe.update({ [field]: base }, ranges)).resolves.toMatchObject({
        mutationCount: 0
      })

      ranges[1]!.start = 5
      await expect(probe.update({ [field]: base }, ranges)).rejects.toMatchObject({
        code: 'CANVAS_APPLY_FAILED',
        message: expect.stringContaining('Undo was skipped')
      })
      expect(probe.fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(probe.values).toEqual([...Array(6).fill(20), ...Array(5).fill(8)])
      expect(probe.aliases.map((alias) => alias?.id)).toEqual([
        ...Array(6).fill(undefined),
        ...Array(5).fill(base.id)
      ])
    }
  )

  it('rejects a newly created node whose explicit metric binding omits the leading newline', async () => {
    const fixture = createFixture()
    const createText = vi.mocked(figma.createText).getMockImplementation()!
    vi.mocked(figma.createText).mockImplementation(() => {
      const node = createText()
      const bind = vi.mocked(node.setRangeBoundVariable).getMockImplementation()!
      vi.mocked(node.setRangeBoundVariable).mockImplementation((start, end, property, variable) => {
        if (property === field && variable && node.characters[start] === '\n') start++
        bind(start, end, property, variable)
      })
      return node
    })
    const existing = new Set(figma.currentPage.children)
    fixture.triggerUndo.mockImplementationOnce(() => {
      for (const child of [...figma.currentPage.children]) {
        if (!existing.has(child)) child.remove()
      }
    })
    const error = await applyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-20 whitespace-pre-wrap">Hello\nworld</span></div>',
      bindings: {
        label: {
          variables: { [field]: { id: 'variable:spacing' } },
          figma: {
            text: {
              ranges: [
                { start: 0, end: 5, [field]: literal(20) },
                { start: 5, end: 11, variables: { [field]: { id: 'variable:spacing' } } }
              ]
            }
          }
        }
      }
    }).catch((error: unknown) => error)
    expect(error).toMatchObject({
      code: 'CANVAS_APPLY_FAILED',
      message: expect.stringContaining('The leading newline at 5:6 did not retain')
    })
    expect((error as Error).message).toContain('Verification failed for "label":')
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    expect(new Set(figma.currentPage.children)).toEqual(existing)
  })

  it('accepts an equal bound literal alongside a differing unbound literal', async () => {
    const probe = await createBindingProbe(field)
    const ranges = [
      { start: 0, end: 1, [field]: literal(8) },
      { start: 3, end: 5, [field]: literal(20) }
    ]
    const variables = { [field]: { id: 'variable:spacing' } }
    await probe.update(variables, ranges)
    await expect(probe.update(variables, ranges)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each(['literal', 'variable', 'null'] as const)(
    'preserves a later TextStyle newline on an unchanged %s replay',
    async (kind) => {
      const probe = await createBindingProbe(field, 'A\nB\nC')
      const style = probe.fixture.styles.get('style:text') as TextStyle
      Object.assign(style, {
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: 'variable:range-size' } }
      })
      const first =
        kind === 'literal'
          ? { start: 2, end: 3, [field]: literal(20) }
          : {
              start: 2,
              end: 3,
              variables: { [field]: kind === 'null' ? null : { id: 'variable:spacing' } }
            }
      const ranges = [first, { start: 3, end: 5, textStyle: { id: style.id } }]
      const variables = { [field]: { id: 'variable:spacing' } }
      await probe.update(variables, ranges)
      const aliases = probe.aliases.map((alias) => alias?.id)
      const values = [...probe.values]
      await expect(probe.update(variables, ranges)).resolves.toMatchObject({ mutationCount: 0 })
      expect(probe.aliases.map((alias) => alias?.id)).toEqual(aliases)
      expect(probe.values).toEqual(values)
    }
  )

  it('rejects a changed earlier literal before it changes the retained following style', async () => {
    const probe = await createBindingProbe(field, 'A\nB\nC')
    const style = probe.fixture.styles.get('style:text') as TextStyle
    Object.assign(style, {
      boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: 'variable:range-size' } }
    })
    const ranges = [
      { start: 2, end: 3, [field]: literal(20) },
      { start: 3, end: 5, textStyle: { id: style.id } }
    ]
    const variables = { [field]: { id: 'variable:spacing' } }
    await probe.update(variables, ranges)
    const values = [...probe.values]
    const aliases = probe.aliases.map((alias) => alias?.id)
    Object.assign(ranges[0]!, { [field]: literal(22) })
    await expect(probe.update(variables, ranges)).rejects.toThrow(
      'retained TextStyle on its following newline'
    )
    expect(probe.values).toEqual(values)
    expect(probe.aliases.map((alias) => alias?.id)).toEqual(aliases)
  })

  it('preserves an omitted alias on a newline while changing adjacent base literals', async () => {
    const probe = await createBindingProbe(field, 'A\nB\nC')
    const foreign = { id: 'variable:range-size' }
    await probe.update({}, [{ start: 1, end: 2, variables: { [field]: foreign } }])
    await probe.update({}, undefined, 20)
    expect(probe.values).toEqual([20, 18, 20, 20, 20])
    expect(probe.aliases.map((alias) => alias?.id)).toEqual([
      undefined,
      foreign.id,
      undefined,
      undefined,
      undefined
    ])
    await expect(probe.update({}, undefined, 20)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects a base write when restoring the newline alias would cross another newline', async () => {
    const probe = await createBindingProbe(field, 'A\n\nB')
    const foreign = { id: 'variable:range-size' }
    // Direct native binding covers both newlines, so use the probe's retained
    // state to represent an independently styled first newline.
    probe.aliases[1] = { type: 'VARIABLE_ALIAS', id: foreign.id }
    probe.values[1] = 18
    const values = [...probe.values]
    await expect(probe.update({}, undefined, 20)).rejects.toThrow('retained newline at 1:2')
    expect(probe.values).toEqual(values)
  })

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
    ).rejects.toThrow(`Cannot clear range 2:4 variable "${field}"`)
  })

  it('repairs a foreign alias on the newline owned by a literal override', async () => {
    const probe = await createBindingProbe(field, 'A\nB\nC')
    const variable = { id: 'variable:spacing' }
    const ranges = [{ start: 2, end: 3, [field]: literal(13) }]
    await probe.update({ [field]: variable }, ranges)
    probe.aliases[3] = { type: 'VARIABLE_ALIAS', id: 'variable:range-size' }
    await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
      mutationCount: 1
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

  it.each([undefined, null])(
    'clears an equal-valued foreign literal alias with textStyle=%s',
    async (textStyle) => {
      const probe = await createBindingProbe(field)
      const variable = { id: 'variable:spacing' }
      await probe.update({ [field]: variable }, [
        { start: 2, end: 4, variables: { [field]: { id: 'variable:range-size' } } }
      ])
      const ranges = [{ start: 2, end: 4, [field]: literal(18), textStyle }]
      await probe.update({ [field]: variable }, ranges)
      expect(probe.values).toEqual([8, 8, 18, 18, 8, 8])
      expect(probe.aliases.slice(2, 4)).toEqual([null, null])
      await expect(probe.update({ [field]: variable }, ranges)).resolves.toMatchObject({
        mutationCount: 0
      })
    }
  )

  it('retains an equal-valued foreign alias when the node binding is omitted', async () => {
    const probe = await createBindingProbe(field)
    const override = { id: 'variable:range-size' }
    await probe.update({}, [{ start: 2, end: 4, variables: { [field]: override } }])
    await expect(
      probe.update({}, [{ start: 2, end: 4, [field]: literal(18) }])
    ).resolves.toMatchObject({ mutationCount: 0 })
    expect(probe.aliases.slice(2, 4).map((alias) => alias?.id)).toEqual([override.id, override.id])
  })

  it('restores the exact base alias when a foreign alias has the same numeric value', async () => {
    const probe = await createBindingProbe(field)
    const base = { id: 'variable:spacing' }
    const foreign = probe.fixture.variables.get('variable:range-size')!
    vi.spyOn(foreign, 'resolveForConsumer').mockReturnValue({ resolvedType: 'FLOAT', value: 8 })
    await probe.update({ [field]: base }, [
      { start: 2, end: 4, variables: { [field]: { id: foreign.id } } }
    ])
    const ranges = [{ start: 2, end: 4, [field]: literal(8) }]
    await probe.update({ [field]: base }, ranges)
    expect(probe.aliases.every((alias) => alias?.id === base.id)).toBe(true)
    await expect(probe.update({ [field]: base }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it('rejects an ignored clear of an equal-valued foreign literal alias', async () => {
    const probe = await createBindingProbe(field)
    const base = { id: 'variable:spacing' }
    await probe.update({ [field]: base }, [
      { start: 2, end: 4, variables: { [field]: { id: 'variable:range-size' } } }
    ])
    vi.mocked(probe.node.setRangeBoundVariable).mockImplementation(() => {})
    await expect(
      probe.update({ [field]: base }, [{ start: 2, end: 4, [field]: literal(18) }])
    ).rejects.toThrow(`Cannot clear range 2:4 variable "${field}"`)
  })

  it('rejects an ignored exact-base repair even when the foreign value is equal', async () => {
    const probe = await createBindingProbe(field)
    const base = { id: 'variable:spacing' }
    const foreign = probe.fixture.variables.get('variable:range-size')!
    vi.spyOn(foreign, 'resolveForConsumer').mockReturnValue({ resolvedType: 'FLOAT', value: 8 })
    await probe.update({ [field]: base }, [
      { start: 2, end: 4, variables: { [field]: { id: foreign.id } } }
    ])
    vi.mocked(probe.node.setRangeBoundVariable).mockImplementation(() => {})
    await expect(
      probe.update({ [field]: base }, [{ start: 2, end: 4, [field]: literal(8) }])
    ).rejects.toThrow(`range variable link "${field}" does not match`)
  })

  it('preserves a retained TextStyle alias while repairing a separate literal override', async () => {
    const probe = await createBindingProbe(field)
    const base = { id: 'variable:spacing' }
    const foreign = { id: 'variable:range-size' }
    const style = probe.fixture.styles.get('style:text') as TextStyle
    Object.assign(style, {
      boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: foreign.id } }
    })
    const styled = { start: 4, end: 6, textStyle: { id: style.id } }
    await probe.update({ [field]: base }, [
      { start: 2, end: 4, variables: { [field]: foreign } },
      styled
    ])
    const ranges = [{ start: 2, end: 4, [field]: literal(18) }, styled]
    await probe.update({ [field]: base }, ranges)
    expect(probe.aliases.map((alias) => alias?.id)).toEqual([
      base.id,
      base.id,
      undefined,
      undefined,
      foreign.id,
      foreign.id
    ])
    await expect(probe.update({ [field]: base }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
  })

  it.each([false, true])(
    'rejects a repair before changing a retained newline style: semantic=%s',
    async (semantic) => {
      const probe = await createBindingProbe(field, 'A\nB\nC')
      const base = { id: 'variable:spacing' }
      const foreign = { id: 'variable:range-size' }
      const style = probe.fixture.styles.get('style:text') as TextStyle
      Object.assign(style, {
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: foreign.id } }
      })
      const styled: CanvasFigmaTextRange = { start: 3, end: 4, textStyle: { id: style.id } }
      await probe.update({ [field]: base }, [
        { start: 2, end: 3, variables: { [field]: foreign } },
        styled
      ])
      if (semantic) {
        styled.textCase = 'ORIGINAL'
        const segments = vi.mocked(probe.node.getStyledTextSegments).getMockImplementation()!
        vi.mocked(probe.node.getStyledTextSegments).mockImplementation((...args) =>
          segments(...args).map((segment) => ({
            ...segment,
            textStyleOverrides: [{ type: 'SEMANTIC_ITALIC' as const }]
          }))
        )
      }
      const ranges = [{ start: 2, end: 3, [field]: literal(18) }, styled]
      vi.mocked(probe.node.setRangeBoundVariable).mockClear()
      await expect(probe.update({ [field]: base }, ranges)).rejects.toThrow(
        'retained TextStyle on its following newline'
      )
      expect(probe.node.setRangeBoundVariable).not.toHaveBeenCalled()
      expect(probe.aliases.map((alias) => alias?.id)).toEqual([
        base.id,
        base.id,
        foreign.id,
        foreign.id,
        base.id
      ])
    }
  )

  it.each(['replacement', 'unbound'] as const)(
    'allows newline style %s when repair cannot damage a retained binding',
    async (kind) => {
      const probe = await createBindingProbe(field, 'A\nB\nC')
      const base = { id: 'variable:spacing' }
      const foreign = { id: 'variable:range-size' }
      const style = probe.fixture.styles.get('style:text') as TextStyle
      Object.assign(style, {
        boundVariables:
          kind === 'replacement' ? { [field]: { type: 'VARIABLE_ALIAS', id: foreign.id } } : {}
      })
      const styled = { start: 3, end: 4, textStyle: { id: style.id } }
      await probe.update({ [field]: base }, [
        { start: 2, end: 3, variables: { [field]: foreign } },
        styled
      ])
      if (kind === 'replacement') {
        const replacement = figma.createTextStyle()
        Object.assign(replacement, {
          boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: foreign.id } }
        })
        styled.textStyle = { id: replacement.id }
      }
      await probe.update({ [field]: base }, [{ start: 2, end: 3, [field]: literal(18) }, styled])
      expect(probe.aliases.map((alias) => alias?.id)).toEqual([
        base.id,
        base.id,
        undefined,
        kind === 'replacement' ? foreign.id : undefined,
        base.id
      ])
    }
  )

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

  it('recovers a retained foreign override with an explicit range binding', async () => {
    const probe = await createBindingProbe(field)
    const base = { id: 'variable:spacing' }
    await probe.update({ [field]: base }, [
      { start: 2, end: 4, variables: { [field]: { id: 'variable:range-size' } } }
    ])
    await expect(probe.update({ [field]: base })).rejects.toThrow(
      'Explicitly bind the affected text range'
    )
    const ranges = [{ start: 2, end: 4, variables: { [field]: base } }]
    await probe.update({ [field]: base }, ranges)
    expect(probe.values).toEqual(Array(6).fill(8))
    expect(probe.aliases.every((alias) => alias?.id === base.id)).toBe(true)
    await expect(probe.update({ [field]: base }, ranges)).resolves.toMatchObject({
      mutationCount: 0
    })
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
