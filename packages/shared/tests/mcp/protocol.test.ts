import { describe, expect, it } from 'vitest'

import { TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION } from '../../src/mcp/constants'
import {
  ToolResultMessageSchema,
  parseMessageFromExtension,
  parseMessageToExtension
} from '../../src/mcp/protocol'

describe('mcp/protocol', () => {
  it('parses valid messages to extension', () => {
    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'registered',
          id: 'ext-1',
          protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
        })
      )
    ).toEqual({
      type: 'registered',
      id: 'ext-1',
      protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
    })

    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'state',
          activeId: 'abc',
          assetServerUrl: 'https://assets.example.com'
        })
      )
    ).toEqual({
      type: 'state',
      activeId: 'abc',
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

    expect(parseMessageFromExtension('{"type":"ping"}')).toEqual({ type: 'ping' })
    expect(
      parseMessageFromExtension(
        JSON.stringify({
          type: 'runtimeHello',
          extensionVersion: '0.21.0',
          extensionRuntimeFingerprint: 'a'.repeat(64)
        })
      )
    ).toEqual({
      type: 'runtimeHello',
      extensionVersion: '0.21.0',
      extensionRuntimeFingerprint: 'a'.repeat(64)
    })
  })

  it('returns null for invalid json', () => {
    expect(parseMessageToExtension('{bad json')).toBeNull()
    expect(parseMessageFromExtension('not-json')).toBeNull()
  })

  it('accepts a newer hub announcement instead of rejecting the added fields', () => {
    // A Hub release reaches extensions that are still waiting for store review, so parsing must
    // survive both an unfamiliar version and fields this extension has never seen.
    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'registered',
          id: 'ext-1',
          protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1,
          supportedProtocolVersions: [
            TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
            TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1
          ],
          announcedLater: 'ignored'
        })
      )
    ).toEqual({
      type: 'registered',
      id: 'ext-1',
      protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1,
      supportedProtocolVersions: [
        TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
        TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION + 1
      ]
    })
    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'state',
          activeId: null,
          assetServerUrl: 'https://assets.example.com',
          count: 1,
          port: 6220
        })
      )
    ).toEqual({ type: 'state', activeId: null, assetServerUrl: 'https://assets.example.com' })
  })

  it('returns null when schema validation fails', () => {
    expect(parseMessageToExtension('{"type":"registered","id":"ext-1"}')).toBeNull()
    expect(
      parseMessageToExtension(
        JSON.stringify({ type: 'registered', id: 'ext-1', protocolVersion: 0 })
      )
    ).toBeNull()
    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'registered',
          id: 'ext-1',
          protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
          supportedProtocolVersions: []
        })
      )
    ).toBeNull()
    expect(parseMessageToExtension(JSON.stringify({ type: 'state', activeId: null }))).toBeNull()
    expect(parseMessageFromExtension(JSON.stringify({ type: 'toolResult' }))).toBeNull()
    expect(
      parseMessageFromExtension(
        JSON.stringify({
          type: 'runtimeHello',
          extensionVersion: '0.21.0',
          extensionRuntimeFingerprint: 'short'
        })
      )
    ).toBeNull()
    expect(
      parseMessageFromExtension(
        JSON.stringify({ type: 'toolResult', id: 'call-1', error: 'plain string' })
      )
    ).toBeNull()
    expect(
      parseMessageFromExtension(
        JSON.stringify({ type: 'toolResult', id: 'call-1', error: null, payload: {} })
      )
    ).toBeNull()
    const invalidResults = [
      { payload: undefined },
      { error: undefined },
      {},
      {
        error: { message: 'failed' },
        payload: {}
      }
    ]
    for (const result of invalidResults) {
      expect(
        ToolResultMessageSchema.safeParse({
          ...result,
          type: 'toolResult',
          id: 'call-1'
        }).success
      ).toBe(false)
    }
    expect(parseMessageFromExtension(JSON.stringify({ type: 'unknown' }))).toBeNull()
  })
})
