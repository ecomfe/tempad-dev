import { describe, expect, it } from 'vitest'

import * as mcp from '../../src/mcp'
import * as constants from '../../src/mcp/constants'
import * as errors from '../../src/mcp/errors'
import * as protocol from '../../src/mcp/protocol'
import * as tools from '../../src/mcp/tools'

describe('shared/mcp index barrel', () => {
  it('re-exports constants, errors, protocol parsers, and tool schemas', () => {
    expect(mcp.MCP_PORT_CANDIDATES).toBe(constants.MCP_PORT_CANDIDATES)
    expect(mcp.MCP_HASH_PATTERN).toBe(constants.MCP_HASH_PATTERN)

    expect(mcp.TEMPAD_MCP_ERROR_CODES).toBe(errors.TEMPAD_MCP_ERROR_CODES)

    expect(mcp.parseMessageToExtension).toBe(protocol.parseMessageToExtension)
    expect(mcp.parseMessageFromExtension).toBe(protocol.parseMessageFromExtension)

    expect(mcp.AssetDescriptorSchema).toBe(tools.AssetDescriptorSchema)
    expect(mcp.GetCodeParametersSchema).toBe(tools.GetCodeParametersSchema)
    expect(mcp.GetAssetsResultSchema).toBe(tools.GetAssetsResultSchema)
  })
})
