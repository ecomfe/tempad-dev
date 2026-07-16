import { describe, expect, it } from 'vitest'

import {
  isPluginSandboxErrorCode,
  isPluginSandboxWorker,
  PLUGIN_SANDBOX_WORKER
} from '@/plugin-sandbox/protocol'

describe('plugin sandbox protocol guards', () => {
  it('accepts only fixed packaged worker kinds', () => {
    Object.values(PLUGIN_SANDBOX_WORKER).forEach((worker) => {
      expect(isPluginSandboxWorker(worker)).toBe(true)
    })
    expect(isPluginSandboxWorker('unknown-worker')).toBe(false)
  })

  it('accepts only defined error codes', () => {
    const errorCodes = [
      'busy',
      'invalid-payload',
      'payload-too-large',
      'protocol-error',
      'timeout',
      'worker-error',
      'worker-message-error'
    ]
    errorCodes.forEach((code) => expect(isPluginSandboxErrorCode(code)).toBe(true))
    expect(isPluginSandboxErrorCode('unknown')).toBe(false)
    expect(isPluginSandboxErrorCode(null)).toBe(false)
  })
})
