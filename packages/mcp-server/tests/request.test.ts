import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { nanoid } from 'nanoid'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanupAll, cleanupForExtension, register, reject, resolve } from '../src/request'
import { log } from '../src/shared'

vi.mock('nanoid', () => ({
  nanoid: vi.fn()
}))

vi.mock('../src/shared', () => ({
  log: {
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

afterEach(() => {
  cleanupAll()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('mcp-server/request', () => {
  it('rejects an already cancelled request without retaining timers or listeners', () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    expect(() => register('ext', 1000, { signal: controller.signal })).toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the wait after a write warning without claiming native execution stopped', async () => {
    vi.useFakeTimers()
    vi.mocked(nanoid).mockReturnValue('cancelled')
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const { promise, requestId } = register('ext', 1000, {
      signal: controller.signal,
      waitForDefinitiveResult: true
    })
    const result = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: expect.stringContaining('may still be running')
    })
    await vi.advanceTimersByTimeAsync(1000)
    controller.abort()
    await result
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    resolve(requestId, 'ext', { late: true })
    expect(log.warn).toHaveBeenLastCalledWith(
      { reqId: requestId },
      'Received result for unknown/timed-out call.'
    )
  })

  it.each(['result', 'error', 'timeout', 'disconnect', 'shutdown'])(
    'detaches cancellation after %s settlement',
    async (outcome) => {
      vi.useFakeTimers()
      vi.mocked(nanoid).mockReturnValue('settled')
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      const { promise, requestId } = register('ext', 1000, { signal: controller.signal })
      const settled = promise.catch(() => undefined)
      if (outcome === 'result') resolve(requestId, 'ext', {})
      else if (outcome === 'error') reject(requestId, 'ext', new Error('Native failure'))
      else if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(1000)
      else if (outcome === 'disconnect') cleanupForExtension('ext')
      else cleanupAll()
      await settled
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
      expect(vi.getTimerCount()).toBe(0)
      controller.abort()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('bounds uncertain canvas calls without suggesting a replay', async () => {
    vi.useFakeTimers()
    vi.mocked(nanoid).mockReturnValue('uncertain')
    const { promise } = register('ext', 1000, { waitForDefinitiveResult: true })
    const result = expect(promise).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT,
      message: expect.stringContaining('Do not replay')
    })
    await vi.advanceTimersByTimeAsync(2000)
    await result
  })

  it.each(['socket', 'page'] as const)(
    'warns against replaying a write after a %s disconnect',
    async (source) => {
      vi.mocked(nanoid).mockReturnValue('disconnected-write')
      const { promise, requestId } = register('ext', 1000, { waitForDefinitiveResult: true })
      if (source === 'socket') cleanupForExtension('ext')
      else
        reject(
          requestId,
          'ext',
          Object.assign(new Error('The page port disconnected.'), {
            code: TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED
          })
        )
      await expect(promise).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
        message: expect.stringMatching(/outcome is unknown.*Do not replay/)
      })
    }
  )

  it('registers and resolves a pending call', async () => {
    vi.mocked(nanoid).mockReturnValue('req-1')

    const { promise, requestId } = register<{ ok: boolean }>('ext-1', 1000)
    expect(requestId).toBe('req-1')

    resolve(requestId, 'ext-1', { ok: true })
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('rejects a pending call by request id', async () => {
    vi.mocked(nanoid).mockReturnValue('req-2')

    const { promise, requestId } = register('ext-1', 1000)
    const err = new Error('tool failed')

    reject(requestId, 'ext-1', err)
    await expect(promise).rejects.toBe(err)
  })

  it('rejects with timeout error code when extension does not respond in time', async () => {
    vi.useFakeTimers()
    vi.mocked(nanoid).mockReturnValue('req-timeout')

    const { promise } = register('ext-1', 1500)
    const rejection = expect(promise).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT,
      message: 'Extension did not respond within 1.5s.'
    })

    await vi.advanceTimersByTimeAsync(1500)
    await rejection
  })

  it('keeps mutating calls pending after their slow-call warning threshold', async () => {
    vi.useFakeTimers()
    vi.mocked(nanoid).mockReturnValue('req-slow-apply')

    const call = register<{ ok: boolean }>('ext-1', 1500, {
      waitForDefinitiveResult: true
    })
    let settled = false
    void call.promise.then(
      () => (settled = true),
      () => (settled = true)
    )

    await vi.advanceTimersByTimeAsync(1500)
    expect(settled).toBe(false)
    expect(log.warn).toHaveBeenCalledWith(
      { reqId: 'req-slow-apply', extId: 'ext-1', timeout: 1500 },
      'Extension call exceeded its warning threshold; waiting for a definitive result.'
    )

    resolve(call.requestId, 'ext-1', { ok: true })
    await expect(call.promise).resolves.toEqual({ ok: true })
  })

  it('warns when resolving or rejecting unknown calls', () => {
    const warnSpy = vi.mocked(log.warn)

    resolve('missing-id', 'ext-1', { ok: true })
    reject('missing-id', 'ext-1', new Error('missing'))

    expect(warnSpy).toHaveBeenCalledWith(
      { reqId: 'missing-id' },
      'Received result for unknown/timed-out call.'
    )
    expect(warnSpy).toHaveBeenCalledWith(
      { reqId: 'missing-id' },
      'Received error for unknown/timed-out call.'
    )
  })

  it('rejects only calls for the disconnected extension', async () => {
    vi.mocked(nanoid).mockReturnValueOnce('req-a').mockReturnValueOnce('req-b')

    const first = register('ext-a', 1000)
    const second = register<{ done: boolean }>('ext-b', 1000)

    cleanupForExtension('ext-a')

    await expect(first.promise).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
      message: 'Extension disconnected before providing a result.'
    })

    resolve(second.requestId, 'ext-b', { done: true })
    await expect(second.promise).resolves.toEqual({ done: true })
  })

  it('rejects all pending calls during shutdown cleanup', async () => {
    vi.mocked(nanoid).mockReturnValue('req-shutdown')
    const debugSpy = vi.mocked(log.debug)

    const { promise } = register('ext-1', 1000)
    cleanupAll()

    await expect(promise).rejects.toThrow('Hub is shutting down.')
    expect(debugSpy).toHaveBeenCalledWith(
      { reqId: 'req-shutdown' },
      'Rejected pending tool call due to shutdown.'
    )
  })

  it('ignores results and errors from a different extension connection', async () => {
    vi.mocked(nanoid).mockReturnValueOnce('req-result').mockReturnValueOnce('req-error')
    const result = register<{ ok: boolean }>('ext-owner', 1000)
    const failure = register('ext-owner', 1000)

    resolve(result.requestId, 'ext-attacker', { ok: false })
    reject(failure.requestId, 'ext-attacker', new Error('spoofed'))
    resolve(result.requestId, 'ext-owner', { ok: true })
    reject(failure.requestId, 'ext-owner', new Error('real'))

    await expect(result.promise).resolves.toEqual({ ok: true })
    await expect(failure.promise).rejects.toThrow('real')
    expect(log.warn).toHaveBeenCalledWith(
      {
        reqId: 'req-result',
        expectedExtId: 'ext-owner',
        receivedExtId: 'ext-attacker'
      },
      'Ignored tool result from the wrong extension.'
    )
    expect(log.warn).toHaveBeenCalledWith(
      {
        reqId: 'req-error',
        expectedExtId: 'ext-owner',
        receivedExtId: 'ext-attacker'
      },
      'Ignored tool error from the wrong extension.'
    )
  })
})
