import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  launch: vi.fn(),
  contextClose: vi.fn(),
  waitForWorker: vi.fn(),
  listen: vi.fn(),
  serverClose: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  mkdtemp: fixture.mkdtemp,
  readFile: fixture.readFile,
  rm: fixture.rm
}))
vi.mock('node:http', () => ({
  createServer: () => ({
    on: vi.fn(),
    once: vi.fn(),
    listen: fixture.listen,
    address: () => ({ port: 12345 }),
    close: fixture.serverClose
  })
}))
vi.mock('playwright', () => ({
  chromium: { launchPersistentContext: fixture.launch }
}))

import { runCheck } from '@/scripts/check-plugin-sandbox'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.resetAllMocks()
  fixture.readFile.mockResolvedValue(
    JSON.stringify({
      sandbox: { pages: ['plugin-sandbox.html'] },
      content_security_policy: {
        sandbox: "sandbox allow-scripts; default-src 'none'; connect-src 'none'; worker-src blob:"
      },
      web_accessible_resources: [
        {
          matches: ['https://www.figma.com/*'],
          resources: ['/plugin-sandbox.html', '/chunks/plugin-sandbox-*.js']
        }
      ]
    })
  )
  fixture.mkdtemp.mockResolvedValue('/temporary/sandbox-profile')
  fixture.listen.mockImplementation((_port, _host, ready: () => void) => ready())
  fixture.serverClose.mockImplementation((closed: (error?: Error) => void) => closed())
  fixture.launch.mockResolvedValue({
    serviceWorkers: () => [],
    waitForEvent: fixture.waitForWorker,
    close: fixture.contextClose
  })
  fixture.waitForWorker.mockRejectedValue(new Error('Worker did not start'))
  fixture.contextClose.mockResolvedValue(undefined)
  fixture.rm.mockResolvedValue(undefined)
})

it('closes the network listener and removes its profile when Chromium cannot launch', async () => {
  const failure = new Error('Chromium executable is missing')
  fixture.launch.mockRejectedValue(failure)

  await expect(runCheck()).rejects.toBe(failure)

  expect(fixture.serverClose).toHaveBeenCalledOnce()
  expect(fixture.rm).toHaveBeenCalledWith('/temporary/sandbox-profile', {
    force: true,
    recursive: true
  })
})

it('does not open a listener when the temporary profile cannot be created', async () => {
  const failure = new Error('Temporary directory is unavailable')
  fixture.mkdtemp.mockRejectedValue(failure)

  await expect(runCheck()).rejects.toBe(failure)

  expect(fixture.listen).not.toHaveBeenCalled()
  expect(fixture.launch).not.toHaveBeenCalled()
})

it.each(['browser', 'listener'])(
  'still removes resources when %s cleanup fails',
  async (resource) => {
    const failure = new Error(`${resource} cleanup failed`)
    if (resource === 'browser') fixture.contextClose.mockRejectedValue(failure)
    else fixture.serverClose.mockImplementation((closed: (error: Error) => void) => closed(failure))

    await expect(runCheck()).rejects.toBe(failure)

    expect(fixture.contextClose).toHaveBeenCalledOnce()
    expect(fixture.serverClose).toHaveBeenCalledOnce()
    expect(fixture.rm).toHaveBeenCalledOnce()
  }
)

it('bounds an unanswered sandbox handshake and releases its channel and host resources', async () => {
  vi.useFakeTimers()
  const portClose = vi.fn()
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { start: vi.fn(), close: portClose }
      port2 = {}
    }
  )
  vi.stubGlobal('window', { postMessage: vi.fn() })
  const worker = {
    url: () => 'chrome-extension://sandbox/background.js',
    evaluate: vi.fn().mockResolvedValue({
      restored: { items: [{ nodeId: 'probe-node', text: 'Persisted annotation' }] },
      removed: null
    })
  }
  const evaluate = vi
    .fn()
    .mockResolvedValueOnce({ origin: 'null', chromeRuntime: 'undefined' })
    .mockResolvedValueOnce(undefined)
    .mockImplementation(async (callback, argument) => await callback(argument))
  fixture.launch.mockResolvedValue({
    serviceWorkers: () => [worker],
    newPage: async () => ({ goto: vi.fn(), evaluate }),
    close: fixture.contextClose
  })
  let failure: unknown
  const pending = runCheck().catch((error: unknown) => {
    failure = error
  })

  await vi.advanceTimersByTimeAsync(7000)

  expect(failure).toMatchObject({ message: 'Sandbox connection timed out.' })
  await pending
  expect(portClose).toHaveBeenCalledOnce()
  expect(fixture.contextClose).toHaveBeenCalledOnce()
  expect(fixture.serverClose).toHaveBeenCalledOnce()
  expect(fixture.rm).toHaveBeenCalledOnce()
})
