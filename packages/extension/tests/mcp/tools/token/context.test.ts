import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTokenReadContext } from '@/mcp/tools/token/context'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn(async (refs: { code: string }[]) => refs.map(({ code }) => code))
}))

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('token read context', () => {
  it('retries a failed native-name transform within the same context', async () => {
    const variable = { id: 'v', name: 'size' } as Variable
    const context = createTokenReadContext(config, 'plugin')
    vi.mocked(runTransformVariableBatch).mockRejectedValueOnce(new Error('sandbox timed out'))

    await expect(context.getName(variable)).rejects.toThrow('sandbox timed out')
    await context.prepareNames([variable])
    expect(await context.getName(variable)).toBe('--size')
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(2)
  })

  it('keeps an expired caller’s checkpoint out of a cached native-name promise', async () => {
    const context = createTokenReadContext(config, 'plugin')
    const variable = { id: 'v', name: 'size' } as Variable
    let expired = false
    let finish!: () => void
    vi.mocked(runTransformVariableBatch).mockImplementationOnce(
      (refs) =>
        new Promise((resolve) => {
          finish = () => resolve(refs.map(({ code }) => code))
        })
    )
    const pending = context.getName(variable, () => {
      if (expired) throw new Error('expired')
    })
    expired = true
    const fresh = context.getName(variable, () => {})
    finish()
    await expect(pending).rejects.toThrow('expired')
    expect(await fresh).toBe('--size')
    expect(await context.getName(variable, () => {})).toBe('--size')
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
  })

  it('canonicalizes a discovered alias batch in one sandbox request and reuses the names', async () => {
    const context = createTokenReadContext(config, 'plugin')
    const variables = Array.from(
      { length: 40 },
      (_, index) => ({ id: `v${index}`, name: `token-${index}` }) as Variable
    )
    await context.prepareNames(variables)
    expect(await Promise.all(variables.map((variable) => context.getName(variable)))).toHaveLength(
      40
    )
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runTransformVariableBatch).mock.calls[0]![0]).toHaveLength(40)
  })

  it('reads variables, collections, canonical names, and a lazy index once per request', async () => {
    const variable = { id: 'v', name: 'size' } as Variable
    const getVariableById = vi.fn(() => variable)
    const getVariableCollectionById = vi.fn(() => null)
    const getLocalVariablesAsync = vi.fn(async () => [variable])
    vi.stubGlobal('figma', {
      variables: { getVariableById, getVariableCollectionById, getLocalVariablesAsync }
    })
    const context = createTokenReadContext(config, 'plugin')
    expect(context.getVariable('v')).toBe(variable)
    expect(context.getVariable('v')).toBe(variable)
    expect(context.getCollection('c')).toBeNull()
    expect(context.getCollection('c')).toBeNull()
    expect(await context.getName(variable)).toBe('--size')
    expect(await context.getName(variable)).toBe('--size')
    expect(getLocalVariablesAsync).not.toHaveBeenCalled()
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
    expect(await context.getIndex()).toBe(await context.getIndex())
    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(1)
    expect(getVariableById).toHaveBeenCalledTimes(1)
    expect(getVariableCollectionById).toHaveBeenCalledTimes(1)
  })

  it('does not carry rejected lookups or index promises into later requests', async () => {
    const getVariableById = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Error('stale')
      })
      .mockReturnValue({ id: 'v' })
    const getVariableCollectionById = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Error('stale')
      })
      .mockReturnValue({ id: 'c' })
    const getLocalVariablesAsync = vi
      .fn()
      .mockRejectedValueOnce(Error('stale'))
      .mockResolvedValue([])
    vi.stubGlobal('figma', {
      variables: { getVariableById, getVariableCollectionById, getLocalVariablesAsync }
    })
    const first = createTokenReadContext(config)
    expect(first.getVariable('v')).toBeNull()
    expect(first.getCollection('c')).toBeNull()
    await expect(first.getIndex()).rejects.toThrow('stale')
    const second = createTokenReadContext(config)
    expect(second.getVariable('v')?.id).toBe('v')
    expect(second.getCollection('c')?.id).toBe('c')
    expect((await second.getIndex()).totalVariables).toBe(0)
  })
})
