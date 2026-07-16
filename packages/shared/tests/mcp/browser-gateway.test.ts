import { describe, expect, it } from 'vitest'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  parseBridgeToPageMessage,
  parsePageToBridgeMessage
} from '../../src/mcp/browser-gateway'
import { MCP_MAX_ASSET_BYTES } from '../../src/mcp/constants'

const base = {
  sessionId: 'session-1',
  source: TEMPAD_MCP_BROWSER_SOURCE,
  version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
} as const

describe('mcp/browser-gateway', () => {
  it('parses page-to-bridge control messages', () => {
    expect(
      parsePageToBridgeMessage({
        ...base,
        type: 'mcp.enable'
      })
    ).toEqual({
      ...base,
      type: 'mcp.enable'
    })

    expect(parsePageToBridgeMessage({ ...base, type: 'mcp.activateSession' })).toEqual({
      ...base,
      type: 'mcp.activateSession'
    })

    expect(
      parsePageToBridgeMessage({
        ...base,
        payload: {
          base64: 'AQID',
          hash: 'abcdef12',
          metadata: { height: 20, themeable: true, width: 10 },
          mimeType: 'image/png'
        },
        requestId: 'upload-1',
        type: 'mcp.uploadAsset'
      })
    ).toMatchObject({
      requestId: 'upload-1',
      type: 'mcp.uploadAsset'
    })
  })

  it('parses bridge-to-page state and tool calls', () => {
    expect(
      parseBridgeToPageMessage({
        payload: {
          activeSessionId: 'session-1',
          assetServerUrl: 'http://127.0.0.1:9000',
          errorMessage: null,
          sessionCount: 1,
          sessionId: 'session-1',
          status: 'connected'
        },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.state',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    ).toMatchObject({
      payload: {
        sessionId: 'session-1',
        status: 'connected'
      },
      type: 'mcp.state'
    })

    expect(
      parseBridgeToPageMessage({
        callId: 'call-1',
        payload: { args: { nodeId: '1:2' }, name: 'get_code' },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.toolCall',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    ).toMatchObject({
      callId: 'call-1',
      type: 'mcp.toolCall'
    })

    expect(
      parseBridgeToPageMessage({
        requestId: 'upload-1',
        sessionId: 'session-1',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.assetUploadResult',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    ).toEqual({
      requestId: 'upload-1',
      sessionId: 'session-1',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetUploadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })
  })

  it('rejects malformed or cross-protocol messages', () => {
    const invalidResults = [
      {},
      { payload: undefined },
      { error: undefined },
      { error: { message: 'Nope' }, payload: {} },
      { error: { code: 'NOT_A_TEMPAD_ERROR', message: 'Nope' } }
    ]
    for (const result of invalidResults) {
      expect(
        parsePageToBridgeMessage({
          ...result,
          ...base,
          callId: 'call-1',
          type: 'mcp.toolResult'
        })
      ).toBeNull()
    }
    expect(parsePageToBridgeMessage({ ...base, source: 'other', type: 'mcp.enable' })).toBeNull()
    expect(parsePageToBridgeMessage({ ...base, payload: {}, type: 'mcp.enable' })).toBeNull()
    expect(
      parsePageToBridgeMessage({
        ...base,
        payload: { base64: 'AQID', hash: 'bad', mimeType: 'image/png' },
        requestId: 'upload-1',
        type: 'mcp.uploadAsset'
      })
    ).toBeNull()
    expect(
      parseBridgeToPageMessage({
        payload: { sessionId: 'session-1', status: 'connected' },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.state',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    ).toBeNull()
  })

  it('bounds asset uploads before they enter the extension runtime', () => {
    const maxLength = 4 * Math.ceil(MCP_MAX_ASSET_BYTES / 3)
    const message = {
      ...base,
      payload: {
        base64: 'A'.repeat(maxLength),
        hash: 'abcdef12',
        mimeType: 'image/png'
      },
      requestId: 'upload-1',
      type: 'mcp.uploadAsset'
    } as const

    expect(parsePageToBridgeMessage(message)).not.toBeNull()
    expect(
      parsePageToBridgeMessage({
        ...message,
        payload: {
          ...message.payload,
          base64: `${message.payload.base64}A`
        }
      })
    ).toBeNull()
  })
})
