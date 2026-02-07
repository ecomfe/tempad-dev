import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestTransformVariables: vi.fn(),
  createWorkerRequester: vi.fn()
}))

vi.mock('@/codegen/requester', () => ({
  createWorkerRequester: mocks.createWorkerRequester
}))

vi.mock('@/mcp/transform-variables/worker?worker&inline', () => ({
  default: class MockTransformerWorker {}
}))

async function importRequester() {
  vi.resetModules()
  mocks.createWorkerRequester.mockReturnValue(mocks.requestTransformVariables)
  return import('@/mcp/transform-variables/requester')
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('mcp/transform-variables/requester', () => {
  it('returns empty result for empty input references', async () => {
    const { runTransformVariableBatch } = await importRequester()

    const result = await runTransformVariableBatch(
      [],
      {
        useRem: true,
        rootFontSize: 16,
        scale: 1
      },
      'export default {}'
    )

    expect(result).toEqual([])
    expect(mocks.requestTransformVariables).not.toHaveBeenCalled()
  })

  it('formats variable expressions directly when plugin code is missing', async () => {
    const { runTransformVariableBatch } = await importRequester()

    const result = await runTransformVariableBatch(
      [
        { code: 'x', name: 'color-primary', value: '#fff' },
        { code: 'y', name: 'spacing-sm' }
      ],
      {
        useRem: false,
        rootFontSize: 14,
        scale: 2
      }
    )

    expect(result).toEqual(['var(--color-primary, #fff)', 'var(--spacing-sm)'])
    expect(mocks.requestTransformVariables).not.toHaveBeenCalled()
  })

  it('delegates to worker requester when plugin code is provided', async () => {
    mocks.requestTransformVariables.mockResolvedValue({
      results: ['--a', '--b']
    })
    const { runTransformVariableBatch } = await importRequester()

    const references = [
      { code: 'alpha', name: 'token-a', value: '#111' },
      { code: 'beta', name: 'token-b' }
    ]
    const options = {
      useRem: true,
      rootFontSize: 16,
      scale: 0.75
    }

    const result = await runTransformVariableBatch(references, options, 'export default {}')

    expect(mocks.createWorkerRequester).toHaveBeenCalledTimes(1)
    expect(mocks.requestTransformVariables).toHaveBeenCalledWith({
      pluginCode: 'export default {}',
      references,
      options
    })
    expect(result).toEqual(['--a', '--b'])
  })
})
