import { describe, expect, it } from 'vitest'

import { LegacyToolCallPayloadSchema, LegacyMessageFromExtensionSchema } from '../../src/mcp'

describe('unversioned extension contract', () => {
  it.each([
    { name: 'get_code', args: {} },
    {
      name: 'get_code',
      args: { nodeId: '1:2', preferredLang: 'vue', resolveTokens: true, vectorMode: 'snapshot' }
    },
    { name: 'get_structure', args: { nodeId: '1:2', options: { depth: 2 } } },
    { name: 'get_screenshot', args: { nodeId: '1:2' } },
    { name: 'get_token_defs', args: { names: ['--color-primary'], includeAllModes: true } }
  ])('preserves released arguments for $name', (payload) => {
    expect(LegacyToolCallPayloadSchema.parse(payload)).toEqual(payload)
  })

  it.each([
    { name: 'apply_canvas', args: {} },
    { name: 'get_design_system', args: {} },
    { name: 'get_structure', args: { pageId: '0:1' } },
    { name: 'get_structure', args: { pageKey: 'page' } },
    { name: 'get_structure', args: { options: { native: true } } },
    { name: 'get_code', args: { taskId: 'task' } },
    { name: 'get_code', args: { taskEpoch: 1 } },
    { name: 'get_code', args: { futureOption: true } }
  ])('rejects unsupported semantics instead of dropping fields: %j', (payload) => {
    expect(LegacyToolCallPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it('accepts only legacy lifecycle and result frames', () => {
    for (const message of [
      { type: 'activate' },
      { type: 'ping' },
      { type: 'toolResult', id: 'request', payload: { roots: [] } },
      {
        type: 'toolResult',
        id: 'request',
        error: { code: 'INVALID_SELECTION', message: 'Select a node' }
      }
    ])
      expect(LegacyMessageFromExtensionSchema.parse(message)).toEqual(message)
    for (const type of ['sessions', 'runtimeHello', 'designAction']) {
      expect(LegacyMessageFromExtensionSchema.safeParse({ type }).success).toBe(false)
    }
  })
})
