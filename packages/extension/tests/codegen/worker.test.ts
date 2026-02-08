import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serializeComponent: vi.fn(),
  stringifyComponent: vi.fn(),
  serializeCSS: vi.fn(),
  evaluate: vi.fn(),
  stringify: vi.fn((value: unknown) => `[stringified:${String(value)}]`),
  lockdownWorker: vi.fn(),
  loggerError: vi.fn(),
  postMessage: vi.fn()
}))

vi.mock('@/utils/component', () => ({
  serializeComponent: mocks.serializeComponent,
  stringifyComponent: mocks.stringifyComponent
}))

vi.mock('@/utils/css', () => ({
  serializeCSS: mocks.serializeCSS
}))

vi.mock('@/utils/module', () => ({
  evaluate: mocks.evaluate
}))

vi.mock('@/utils/string', () => ({
  stringify: mocks.stringify
}))

vi.mock('@/worker/lockdown', () => ({
  lockdownWorker: mocks.lockdownWorker
}))

vi.mock('@/utils/log', () => ({
  logger: {
    error: mocks.loggerError
  }
}))

type WorkerRequest = {
  id: number
  payload: {
    style: Record<string, string>
    component?: Record<string, unknown>
    options: {
      useRem: boolean
      rootFontSize: number
      scale: number
      toJS?: boolean
    }
    pluginCode?: string
    returnDevComponent?: boolean
  }
}

async function importWorker() {
  vi.resetModules()
  vi.stubGlobal('postMessage', mocks.postMessage)
  await import('@/codegen/worker')
}

async function dispatch(request: WorkerRequest) {
  const handler = globalThis.onmessage as
    | ((event: MessageEvent<WorkerRequest>) => Promise<void>)
    | null
  if (!handler) throw new Error('codegen worker onmessage is not initialized')
  await handler({ data: request } as MessageEvent<WorkerRequest>)
}

const baseOptions = {
  useRem: false,
  rootFontSize: 16,
  scale: 1
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.serializeCSS.mockReset()
  mocks.serializeComponent.mockReset()
  mocks.stringifyComponent.mockReset()
  mocks.evaluate.mockReset()
  mocks.postMessage.mockReset()

  mocks.serializeCSS.mockImplementation((_style, options, extra) => {
    if ((options as { toJS?: boolean }).toJS) return 'js-code'
    if (extra && typeof extra === 'object' && 'title' in extra && extra.title === 'Tokens') {
      return 'tokens-code'
    }
    return 'css-code'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.onmessage = null
})

describe('codegen/worker', () => {
  it('locks down the worker on module load', async () => {
    await importWorker()
    expect(mocks.lockdownWorker).toHaveBeenCalledWith('codegen')
  })

  it('rejects plugin code that uses static import statements', async () => {
    await importWorker()

    await dispatch({
      id: 1,
      payload: {
        style: { color: 'red' },
        options: baseOptions,
        pluginCode: 'import { x } from "./x"\nexport default {}'
      }
    })

    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    const firstMessage = mocks.postMessage.mock.calls[0]?.[0] as { error?: unknown }
    const { error } = firstMessage
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('`import` is not allowed')
  })

  it('posts an error when plugin evaluation throws', async () => {
    const failure = new Error('plugin failed')
    mocks.evaluate.mockRejectedValueOnce(failure)

    await importWorker()

    await dispatch({
      id: 2,
      payload: {
        style: { color: 'red' },
        options: baseOptions,
        pluginCode: 'export default {}'
      }
    })

    expect(mocks.loggerError).toHaveBeenCalledWith(failure)
    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 2,
      error: failure
    })
  })

  it('renders component/css/js/extra code blocks from plugin options', async () => {
    const transformComponent = vi.fn(() => '<Card />')
    mocks.evaluate.mockResolvedValueOnce({
      default: {
        name: 'Demo plugin',
        code: {
          component: {
            lang: 'vue',
            title: 'Component title',
            transformComponent
          },
          css: { title: 'Styles', lang: 'css' },
          js: { title: 'Script', lang: 'ts' },
          tokens: { title: 'Tokens', lang: 'json' },
          skipped: false
        }
      }
    })

    await importWorker()

    await dispatch({
      id: 3,
      payload: {
        style: { color: 'blue' },
        component: { name: 'Card' },
        options: baseOptions,
        pluginCode: 'export default plugin'
      }
    })

    expect(transformComponent).toHaveBeenCalledWith({ component: { name: 'Card' } })
    expect(mocks.serializeComponent).not.toHaveBeenCalled()
    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 3,
      payload: {
        pluginName: 'Demo plugin',
        codeBlocks: [
          {
            name: 'component',
            title: 'Component title',
            lang: 'vue',
            code: '<Card />'
          },
          {
            name: 'css',
            title: 'Styles',
            lang: 'css',
            code: 'css-code'
          },
          {
            name: 'js',
            title: 'Script',
            lang: 'ts',
            code: 'js-code'
          },
          {
            name: 'tokens',
            title: 'Tokens',
            lang: 'json',
            code: 'tokens-code'
          }
        ]
      }
    })

    expect(mocks.serializeCSS).toHaveBeenCalledWith(
      { color: 'blue' },
      expect.objectContaining({ toJS: true }),
      { title: 'Script', lang: 'ts' }
    )
  })

  it('uses serializeComponent when transformComponent is not a function', async () => {
    mocks.serializeComponent.mockReturnValueOnce('<Serialized />')
    mocks.evaluate.mockResolvedValueOnce({
      plugin: {
        name: 'named plugin',
        code: {
          component: {
            lang: 'jsx',
            transformComponent: { fallback: true }
          },
          css: false,
          js: false
        }
      }
    })

    await importWorker()

    await dispatch({
      id: 4,
      payload: {
        style: { color: 'green' },
        component: { name: 'Button' },
        options: baseOptions,
        pluginCode: 'export const plugin = {}'
      }
    })

    expect(mocks.serializeComponent).toHaveBeenCalledWith(
      { name: 'Button' },
      { lang: 'jsx' },
      { transformComponent: { fallback: true } }
    )
    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 4,
      payload: {
        pluginName: 'named plugin',
        codeBlocks: [
          {
            name: 'component',
            title: 'Component',
            lang: 'jsx',
            code: '<Serialized />'
          }
        ]
      }
    })
  })

  it('stringifies dev component output and optionally returns it', async () => {
    const devComponent = {
      name: 'div',
      props: {
        onClick: () => 'noop'
      },
      children: []
    }

    mocks.stringifyComponent.mockReturnValueOnce('<FromDevComponent />')
    mocks.evaluate.mockResolvedValueOnce({
      default: {
        name: 'dev component plugin',
        code: {
          component: {
            transformComponent: vi.fn(() => devComponent)
          },
          css: false,
          js: false,
          tokenMap: { title: 'Token map', lang: 'json' },
          extraEmpty: { title: 'Empty', lang: 'json' }
        }
      }
    })

    mocks.serializeCSS.mockImplementation((_style, _options, extra) => {
      if (extra && typeof extra === 'object' && 'title' in extra && extra.title === 'Token map') {
        return 'token-map-code'
      }
      return ''
    })

    await importWorker()

    await dispatch({
      id: 5,
      payload: {
        style: { color: 'purple' },
        component: { name: 'Tag' },
        options: baseOptions,
        pluginCode: 'export default {}',
        returnDevComponent: true
      }
    })

    expect(mocks.stringifyComponent).toHaveBeenCalledWith(devComponent, 'jsx')
    expect(mocks.stringify).toHaveBeenCalledTimes(1)
    expect(mocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 5,
        payload: expect.objectContaining({
          pluginName: 'dev component plugin',
          devComponent: expect.objectContaining({
            name: 'div',
            props: expect.objectContaining({
              onClick: expect.stringContaining('[stringified:')
            }),
            children: []
          }),
          codeBlocks: [
            {
              name: 'component',
              title: 'Component',
              lang: 'jsx',
              code: '<FromDevComponent />'
            },
            {
              name: 'tokenMap',
              title: 'Token map',
              lang: 'json',
              code: 'token-map-code'
            }
          ]
        })
      })
    )
  })

  it('generates default css/js blocks when plugin is not provided', async () => {
    await importWorker()

    await dispatch({
      id: 6,
      payload: {
        style: { color: 'black' },
        options: baseOptions
      }
    })

    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 6,
      payload: {
        pluginName: undefined,
        codeBlocks: [
          {
            name: 'css',
            title: 'CSS',
            lang: 'css',
            code: 'css-code'
          },
          {
            name: 'js',
            title: 'JavaScript',
            lang: 'js',
            code: 'js-code'
          }
        ]
      }
    })
  })
})
