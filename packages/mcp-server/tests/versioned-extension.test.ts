import { describe, expect, it } from 'vitest'

import { assertVersionedToolSupport, versionedReadNotice } from '../src/versioned-extension'

describe('protocol 13 read compatibility', () => {
  it.each([
    ['get_code', { nodeIds: ['1:2'] }],
    ['get_screenshot', { nodeIds: ['1:2', '1:3'] }],
    ['get_structure', { nodeIds: ['1:2'] }],
    ['get_structure', { options: { depth: 0 } }],
    ['get_code', { nodeId: '1:2', resolveTokens: true }]
  ])('rejects unsupported %s options before dispatch', (name, args) => {
    expect(() => assertVersionedToolSupport(13, name, args)).toThrow(
      expect.objectContaining({ code: 'EXTENSION_UPGRADE_REQUIRED' })
    )
    expect(() => assertVersionedToolSupport(15, name, args)).not.toThrow()
  })

  it.each([
    ['get_code', { nodeId: '1:2', resolveTokens: false }],
    ['get_code', {}],
    ['get_screenshot', { nodeId: '1:2' }],
    ['get_structure', { pageId: 'page', options: { depth: 1, native: true } }],
    ['get_design_system', { scope: 'pages' }],
    ['get_token_defs', { names: ['--color'], includeAllModes: true }],
    ['set_design_anchor', { nodeId: '1:2' }],
    ['apply_canvas', { mode: 'update', targetNodeId: '1:2', markup: '<frame key="root" />' }]
  ])('preserves released %s calls', (name, args) => {
    expect(() => assertVersionedToolSupport(13, name, args)).not.toThrow()
  })

  it('labels older result semantics without changing task or write results', () => {
    expect(versionedReadNotice(13, 'get_code')).toContain(
      'complete modes and alias dependencies are not guaranteed'
    )
    expect(versionedReadNotice(13, 'get_token_defs')).toContain('original semantics')
    expect(versionedReadNotice(13, 'get_structure')).toContain('common ancestor')
    expect(versionedReadNotice(13, 'get_screenshot')).toContain('exact nodeId')
    expect(versionedReadNotice(13, 'apply_canvas')).toBeUndefined()
    expect(versionedReadNotice(15, 'get_code')).toBeUndefined()
  })
})
