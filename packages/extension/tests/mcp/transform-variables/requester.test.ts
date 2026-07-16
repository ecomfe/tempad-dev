import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestPluginSandbox: vi.fn()
}))

vi.mock('@/plugin-sandbox/requester', () => ({
  requestPluginSandbox: mocks.requestPluginSandbox
}))

async function importRequester() {
  vi.resetModules()
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
    expect(mocks.requestPluginSandbox).not.toHaveBeenCalled()
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
    expect(mocks.requestPluginSandbox).not.toHaveBeenCalled()
  })

  it('delegates to worker requester when plugin code is provided', async () => {
    mocks.requestPluginSandbox.mockResolvedValue({
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

    expect(mocks.requestPluginSandbox).toHaveBeenCalledWith('transform-variable', {
      pluginCode: 'export default {}',
      references,
      options
    })
    expect(result).toEqual(['--a', '--b'])
  })
})
