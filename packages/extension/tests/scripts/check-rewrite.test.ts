import type { Response } from 'playwright'

import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  listener: undefined as ((response: Response) => void) | undefined,
  goto: vi.fn(),
  close: vi.fn(),
  log: vi.fn(),
  error: vi.fn()
}))

vi.mock('playwright', () => ({
  chromium: {
    launch: async () => ({
      newPage: async () => ({
        on: (_event: string, listener: (response: Response) => void) => {
          fixture.listener = listener
        },
        off: () => {
          fixture.listener = undefined
        },
        goto: fixture.goto,
        fill: async () => {},
        click: async () => {},
        waitForURL: async () => {},
        waitForLoadState: async () => {},
        url: () => 'https://www.figma.com/design/test'
      }),
      close: fixture.close
    })
  }
}))
vi.mock('@/rewrite/config', () => ({
  GROUPS: [{ markers: ['original'], replacements: [{ pattern: 'original', replacer: 'patched' }] }]
}))
vi.mock('@/utils/log', () => ({ logger: { log: fixture.log, error: fixture.error } }))

import { runCheck } from '@/scripts/check-rewrite'

function emitScript(text: () => Promise<string>) {
  fixture.listener?.({
    request: () => ({ resourceType: () => 'script' }),
    url: () => 'https://www.figma.com/webpack-artifacts/assets/editor.min.js',
    text
  } as Response)
}

beforeEach(() => {
  fixture.listener = undefined
  fixture.goto.mockReset()
  fixture.close.mockReset().mockResolvedValue(undefined)
  fixture.log.mockClear()
  fixture.error.mockClear()
})

it('waits for a captured script body before reporting rewrite compatibility', async () => {
  const body = Promise.withResolvers<string>()
  const captured = Promise.withResolvers<void>()
  fixture.goto.mockImplementation(async (url: string) => {
    if (url.includes('/design/')) {
      emitScript(() => body.promise)
      captured.resolve()
    }
  })
  const check = runCheck()
  await captured.promise
  // Allow navigation and the old report path to finish while the body stays pending.
  await new Promise<void>((resolve) => setImmediate(resolve))
  const prematureReport = fixture.log.mock.calls.some(([message]) =>
    String(message).includes('Rewrite check report')
  )
  const closedBeforeBody = fixture.close.mock.calls.length > 0
  body.resolve('original')
  const success = await check
  expect(prematureReport).toBe(false)
  expect(closedBeforeBody).toBe(false)
  expect(success).toBe(true)
  expect(fixture.log.mock.calls.some(([message]) => String(message).includes('PASS:'))).toBe(true)
  expect(fixture.listener).toBeUndefined()
  expect(fixture.close).toHaveBeenCalledOnce()
})

it('propagates body failure to the main error path and closes the browser', async () => {
  const body = Promise.withResolvers<string>()
  const navigation = Promise.withResolvers<void>()
  const captured = Promise.withResolvers<void>()
  const failure = new Error('Response body unavailable')
  fixture.goto.mockImplementation(async (url: string) => {
    if (url.includes('/design/')) {
      emitScript(() => body.promise)
      captured.resolve()
      await navigation.promise
    }
  })
  const check = runCheck()
  const result = expect(check).rejects.toBe(failure)
  await captured.promise
  body.reject(failure)
  // Reject before navigation finishes: the event listener must already observe it.
  await new Promise<void>((resolve) => setImmediate(resolve))
  navigation.resolve()
  await result
  expect(fixture.log.mock.calls.some(([message]) => String(message).includes('PASS:'))).toBe(false)
  expect(fixture.listener).toBeUndefined()
  expect(fixture.close).toHaveBeenCalledOnce()
})

it('observes an outstanding body rejection when early navigation failure closes the browser', async () => {
  const body = Promise.withResolvers<string>()
  fixture.goto.mockImplementation(async () => {
    emitScript(() => body.promise)
    throw new Error('Login navigation failed')
  })
  fixture.close.mockImplementation(async () => {
    body.reject(new Error('Browser closed before body finished'))
  })
  expect(await runCheck()).toBe(false)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(fixture.listener).toBeUndefined()
  expect(fixture.error).toHaveBeenCalledWith(
    'Failed to load the login page. Please check your internet connection.'
  )
  expect(fixture.log.mock.calls.some(([message]) => String(message).includes('PASS:'))).toBe(false)
})
