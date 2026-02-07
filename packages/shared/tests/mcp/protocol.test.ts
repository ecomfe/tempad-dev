import { describe, expect, it } from 'vitest'

import { parseMessageFromExtension, parseMessageToExtension } from '../../src/mcp/protocol'

describe('mcp/protocol', () => {
  it('parses valid messages to extension', () => {
    expect(parseMessageToExtension('{"type":"registered","id":"ext-1"}')).toEqual({
      type: 'registered',
      id: 'ext-1'
    })

    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'state',
          activeId: 'abc',
          count: 2,
          port: 7431,
          assetServerUrl: 'https://assets.example.com'
        })
      )
    ).toEqual({
      type: 'state',
      activeId: 'abc',
      count: 2,
      port: 7431,
      assetServerUrl: 'https://assets.example.com'
    })

    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'toolCall',
          id: 'call-1',
          payload: { name: 'get_code', args: { nodeId: '12:34' } }
        })
      )
    ).toEqual({
      type: 'toolCall',
      id: 'call-1',
      payload: { name: 'get_code', args: { nodeId: '12:34' } }
    })
  })

  it('parses valid messages from extension', () => {
    expect(parseMessageFromExtension('{"type":"activate"}')).toEqual({ type: 'activate' })

    expect(
      parseMessageFromExtension(
        JSON.stringify({
          type: 'toolResult',
          id: 'call-2',
          payload: { ok: true },
          error: undefined
        })
      )
    ).toEqual({
      type: 'toolResult',
      id: 'call-2',
      payload: { ok: true },
      error: undefined
    })
  })

  it('returns null for invalid json', () => {
    expect(parseMessageToExtension('{bad json')).toBeNull()
    expect(parseMessageFromExtension('not-json')).toBeNull()
  })

  it('returns null when schema validation fails', () => {
    expect(parseMessageToExtension(JSON.stringify({ type: 'state', activeId: null }))).toBeNull()
    expect(parseMessageFromExtension(JSON.stringify({ type: 'toolResult' }))).toBeNull()
    expect(parseMessageFromExtension(JSON.stringify({ type: 'unknown' }))).toBeNull()
  })
})
