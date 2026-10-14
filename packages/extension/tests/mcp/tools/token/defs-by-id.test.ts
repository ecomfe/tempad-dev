import { afterEach, describe, expect, it, vi } from 'vitest'

import { withCodeDeadline } from '@/mcp/tools/code/deadline'
import { createTokenReadContext } from '@/mcp/tools/token/context'
import { resolveTokenDefsByIds } from '@/mcp/tools/token/defs'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn(async (refs: { code: string }[]) => refs.map(({ code }) => code))
}))
vi.mock('@/ui/state', () => ({ activePlugin: { value: null } }))
vi.mock('@/mcp/tools/config', () => ({ currentCodegenConfig: vi.fn() }))

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(runTransformVariableBatch)
    .mockReset()
    .mockImplementation(async (refs) => refs.map(({ code }) => code))
})

function aliases(count: number): Variable[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        id: String(index),
        name: `token-${index}`,
        variableCollectionId: 'c',
        resolvedType: 'FLOAT',
        valuesByMode: {
          m: index === count - 1 ? 1 : { type: 'VARIABLE_ALIAS', id: String(index + 1) }
        }
      }) as unknown as Variable
  )
}

describe('used token definitions', () => {
  it('stops an alias closure before starting further native lookups after its deadline', async () => {
    const variables = aliases(100)
    let reads = 0
    vi.spyOn(performance, 'now').mockImplementation(() => reads * 10)
    vi.stubGlobal('figma', {
      variables: {
        getVariableById: (id: string) => {
          reads++
          return variables[Number(id)]
        },
        getVariableCollectionById: () => null
      }
    })
    const context = createTokenReadContext(config)
    await expect(
      withCodeDeadline(20, (_signal, checkpoint) =>
        resolveTokenDefsByIds(new Map([['--seed', '0']]), context, true, vi.fn(), checkpoint)
      )
    ).rejects.toThrow('timed out')
    expect(reads).toBe(2)
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('fences later alias plugin batches and reuses the same context with a fresh budget', async () => {
    const variables = aliases(1000)
    const context = createTokenReadContext(
      config,
      'plugin',
      new Map(variables.map((v) => [v.id, v]))
    )
    vi.spyOn(context, 'getCollection').mockReturnValue(null)
    let finish!: () => void
    vi.mocked(runTransformVariableBatch)
      .mockClear()
      .mockImplementationOnce(
        (refs) =>
          new Promise((resolve) => {
            finish = () => resolve(refs.map(({ code }) => code))
          })
      )
    let work!: Promise<unknown>
    await expect(
      withCodeDeadline(20, (_signal, checkpoint) => {
        work = resolveTokenDefsByIds(new Map([['--seed', '0']]), context, true, vi.fn(), checkpoint)
        return work
      })
    ).rejects.toThrow('timed out')
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
    finish()
    await expect(work).rejects.toThrow('timed out')
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
    const result = await withCodeDeadline(1000, (_signal, checkpoint) =>
      resolveTokenDefsByIds(new Map([['--seed', '0']]), context, true, vi.fn(), checkpoint)
    )
    expect(Object.keys(result)).toHaveLength(1000)
    expect(result['--seed']?.value).toBe('--token-1')
  })

  it.each([
    ['px', '--shared', ['ALL_SCOPES'], '0px'],
    ['rem', '--shared', ['ALL_SCOPES'], '0rem'],
    ['px', '--opacity-shared', ['ALL_SCOPES'], '0'],
    ['rem', '--plugin-alpha', ['OPACITY'], '0']
  ] as const)(
    'preserves zero definition dimensions for %s %s %s',
    async (cssUnit, name, scopes, expected) => {
      const variable = {
        id: 'v',
        name: 'shared',
        variableCollectionId: 'c',
        resolvedType: 'FLOAT',
        scopes,
        valuesByMode: { light: 50, dark: 0 }
      } as unknown as Variable
      const context = createTokenReadContext(
        { ...config, cssUnit },
        undefined,
        new Map([['v', variable]])
      )
      vi.spyOn(context, 'getCollection').mockReturnValue({
        id: 'c',
        name: 'Theme',
        defaultModeId: 'light',
        modes: [
          { modeId: 'light', name: 'Light' },
          { modeId: 'dark', name: 'Dark' }
        ]
      } as VariableCollection)
      const definitions = await resolveTokenDefsByIds(new Map([[name, 'v']]), context, true)
      expect(definitions[name]?.value).toMatchObject({ 'Theme:Dark': expected })
    }
  )

  it('uses exact transformed names and IDs without a local-variable scan', async () => {
    const variable = {
      id: 'v',
      name: 'original',
      variableCollectionId: 'c',
      resolvedType: 'FLOAT',
      valuesByMode: { m: 8 }
    } as unknown as Variable
    const context = createTokenReadContext(config, undefined, new Map([['v', variable]]))
    vi.spyOn(context, 'getCollection').mockReturnValue({
      id: 'c',
      name: 'Size',
      modes: [{ modeId: 'm', name: 'Default' }]
    } as VariableCollection)
    const index = vi.spyOn(context, 'getIndex')
    const name = vi.spyOn(context, 'getName')
    expect(await resolveTokenDefsByIds(new Map([['--transformed', 'v']]), context)).toEqual({
      '--transformed': { kind: 'number', value: '8px' }
    })
    expect(index).not.toHaveBeenCalled()
    expect(name).not.toHaveBeenCalled()
  })

  it('returns no metadata for missing variables and emits an actionable warning', async () => {
    const context = createTokenReadContext(config, undefined, new Map([['missing', null]]))
    const report = vi.fn()
    expect(
      await resolveTokenDefsByIds(new Map([['--missing', 'missing']]), context, true, report)
    ).toEqual({})
    expect(report).toHaveBeenCalledWith(expect.stringContaining('missing'))
    expect(await resolveTokenDefsByIds(new Map(), context)).toEqual({})
  })
})
