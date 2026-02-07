import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/utils/log'

const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__
const originalConsoleDebug = console.debug

afterEach(() => {
  ;(globalThis as { __DEV__?: boolean }).__DEV__ = originalDev
  Object.defineProperty(console, 'debug', {
    configurable: true,
    writable: true,
    value: originalConsoleDebug
  })
  vi.restoreAllMocks()
})

describe('utils/log', () => {
  it('prefixes log, warn, and error output consistently', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logger.log('hello', 1)
    logger.log()
    logger.warn({ level: 'warn' })
    logger.error('[tempad-dev] already-prefixed')

    expect(logSpy).toHaveBeenCalledWith('[tempad-dev] hello', 1)
    expect(logSpy).toHaveBeenCalledWith('[tempad-dev]')
    expect(warnSpy).toHaveBeenCalledWith('[tempad-dev]', { level: 'warn' })
    expect(errorSpy).toHaveBeenCalledWith('[tempad-dev] already-prefixed')
  })

  it('skips debug output when __DEV__ is false', () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.debug('hidden')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('uses console.debug in development mode when available', () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.debug('visible')

    expect(debugSpy).toHaveBeenCalledWith('[tempad-dev] visible')
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('falls back to console.log when console.debug is unavailable', () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    Object.defineProperty(console, 'debug', {
      configurable: true,
      writable: true,
      value: undefined
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.debug('fallback')

    expect(logSpy).toHaveBeenCalledWith('[tempad-dev] fallback')
  })
})
