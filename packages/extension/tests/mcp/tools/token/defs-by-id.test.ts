import { describe, expect, it, vi } from 'vitest'

import { createTokenReadContext } from '@/mcp/tools/token/context'
import { resolveTokenDefsByIds } from '@/mcp/tools/token/defs'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn(async (refs: { code: string }[]) => refs.map(({ code }) => code))
}))
vi.mock('@/ui/state', () => ({ activePlugin: { value: null } }))
vi.mock('@/mcp/tools/config', () => ({ currentCodegenConfig: vi.fn() }))

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const

describe('used token definitions', () => {
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
