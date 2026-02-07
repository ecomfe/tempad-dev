import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  postMessage: vi.fn(),
  lockdownWorker: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@/utils/module', () => ({
  evaluate: mocks.evaluate
}))

vi.mock('@/worker/lockdown', () => ({
  lockdownWorker: mocks.lockdownWorker
}))

vi.mock('@/utils/log', () => ({
  logger: {
    error: mocks.loggerError
  }
}))

type WorkerMessage = {
  id: number
  payload: {
    pluginCode?: string
    references: Array<{ code: string; name: string; value?: string }>
    options: {
      useRem: boolean
      rootFontSize: number
      scale: number
    }
  }
}

async function importWorker() {
  vi.resetModules()
  vi.stubGlobal('postMessage', mocks.postMessage)
  return import('@/mcp/transform-variables/worker')
}

async function dispatch(message: WorkerMessage) {
  const handler = globalThis.onmessage as
    | ((event: MessageEvent<WorkerMessage>) => Promise<void>)
    | null
  if (!handler) {
    throw new Error('Worker onmessage handler is not initialized.')
  }
  await handler({ data: message } as MessageEvent<WorkerMessage>)
}

const options = {
  useRem: true,
  rootFontSize: 16,
  scale: 1
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  globalThis.onmessage = null
})

describe('mcp/transform-variables/worker', () => {
  it('locks down worker globals on module load', async () => {
    await importWorker()
    expect(mocks.lockdownWorker).toHaveBeenCalledWith('transform-variable')
  })

  it('formats variables directly when plugin is disabled', async () => {
    await importWorker()

    await dispatch({
      id: 1,
      payload: {
        references: [
          { code: 'a', name: 'color-primary', value: '#fff' },
          { code: 'b', name: 'spacing-sm' }
        ],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 1,
      payload: {
        results: ['var(--color-primary, #fff)', 'var(--spacing-sm)']
      }
    })
  })

  it('posts errors when plugin evaluation fails', async () => {
    const error = new Error('bad plugin')
    mocks.evaluate.mockRejectedValue(error)
    await importWorker()

    await dispatch({
      id: 2,
      payload: {
        pluginCode: 'export default {}',
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 2,
      error
    })
  })

  it('caches plugin transform function by plugin code', async () => {
    const transformVariable = vi.fn(({ name }: { name: string }) => `mapped(${name})`)
    mocks.evaluate.mockResolvedValue({
      default: {
        code: {
          css: {
            transformVariable
          }
        }
      }
    })
    await importWorker()

    await dispatch({
      id: 3,
      payload: {
        pluginCode: 'same-plugin',
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    await dispatch({
      id: 4,
      payload: {
        pluginCode: 'same-plugin',
        references: [{ code: 'y', name: 'token-y' }],
        options
      }
    })

    expect(mocks.evaluate).toHaveBeenCalledTimes(1)
    expect(transformVariable).toHaveBeenCalledTimes(2)
    expect(mocks.postMessage).toHaveBeenNthCalledWith(1, {
      id: 3,
      payload: { results: ['mapped(token-x)'] }
    })
    expect(mocks.postMessage).toHaveBeenNthCalledWith(2, {
      id: 4,
      payload: { results: ['mapped(token-y)'] }
    })
  })

  it('falls back to formatted values when transform function throws', async () => {
    const transformVariable = vi.fn(() => {
      throw new Error('transform failed')
    })
    mocks.evaluate.mockResolvedValue({
      default: {
        code: {
          css: {
            transformVariable
          }
        }
      }
    })
    await importWorker()

    await dispatch({
      id: 5,
      payload: {
        pluginCode: 'throwing-plugin',
        references: [{ code: 'x', name: 'token-x', value: '#123' }],
        options
      }
    })

    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 5,
      payload: { results: ['var(--token-x, #123)'] }
    })
  })

  it('resets cached transform when plugin code is removed', async () => {
    const transformVariable = vi.fn(({ name }: { name: string }) => `mapped(${name})`)
    mocks.evaluate.mockResolvedValue({
      default: {
        code: {
          css: {
            transformVariable
          }
        }
      }
    })
    await importWorker()

    await dispatch({
      id: 6,
      payload: {
        pluginCode: 'reset-plugin',
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    await dispatch({
      id: 7,
      payload: {
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenNthCalledWith(2, {
      id: 7,
      payload: { results: ['var(--token-x)'] }
    })
  })

  it('falls back when evaluated plugin does not expose transformVariable', async () => {
    mocks.evaluate.mockResolvedValue({
      default: {
        code: {
          css: {}
        }
      }
    })
    await importWorker()

    await dispatch({
      id: 8,
      payload: {
        pluginCode: 'missing-transform',
        references: [{ code: 'z', name: 'token-z' }],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 8,
      payload: { results: ['var(--token-z)'] }
    })
  })

  it('falls back when evaluated exports contain no plugin object', async () => {
    mocks.evaluate.mockResolvedValue({})
    await importWorker()

    await dispatch({
      id: 9,
      payload: {
        pluginCode: 'no-plugin',
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 9,
      payload: { results: ['var(--token-x)'] }
    })
  })

  it('falls back when transformVariable is present but not a function', async () => {
    mocks.evaluate.mockResolvedValue({
      default: {
        code: {
          css: {
            transformVariable: 'noop'
          }
        }
      }
    })
    await importWorker()

    await dispatch({
      id: 10,
      payload: {
        pluginCode: 'invalid-transform',
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 10,
      payload: { results: ['var(--token-x)'] }
    })
  })

  it('accepts plugin named export when default export is absent', async () => {
    const transformVariable = vi.fn(({ name }: { name: string }) => `named(${name})`)
    mocks.evaluate.mockResolvedValue({
      plugin: {
        code: {
          css: {
            transformVariable
          }
        }
      }
    })
    await importWorker()

    await dispatch({
      id: 11,
      payload: {
        pluginCode: 'named-export',
        references: [{ code: 'x', name: 'token-x' }],
        options
      }
    })

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 11,
      payload: { results: ['named(token-x)'] }
    })
  })
})
