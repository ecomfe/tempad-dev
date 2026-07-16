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
