import { describe, expect, it } from 'vitest'

import * as mcp from '../../src/mcp'
import * as constants from '../../src/mcp/constants'
import * as errors from '../../src/mcp/errors'
import * as install from '../../src/mcp/install'
import * as protocol from '../../src/mcp/protocol'
import * as tools from '../../src/mcp/tools'

describe('shared/mcp index barrel', () => {
  it('re-exports constants, errors, install metadata, protocol parsers, and tool schemas', () => {
    expect(mcp.MCP_PORT_CANDIDATES).toBe(constants.MCP_PORT_CANDIDATES)
    expect(mcp.MCP_HASH_PATTERN).toBe(constants.MCP_HASH_PATTERN)

    expect(mcp.TEMPAD_MCP_ERROR_CODES).toBe(errors.TEMPAD_MCP_ERROR_CODES)
    expect(mcp.MCP_SERVER).toBe(install.MCP_SERVER)
    expect(mcp.MCP_CLIENTS_BY_ID).toBe(install.MCP_CLIENTS_BY_ID)
    expect(mcp.MCP_DEFAULT_CONFIG_SNIPPET).toBe(install.MCP_DEFAULT_CONFIG_SNIPPET)

    expect(mcp.parseMessageToExtension).toBe(protocol.parseMessageToExtension)
    expect(mcp.parseMessageFromExtension).toBe(protocol.parseMessageFromExtension)

    expect(mcp.AssetDescriptorSchema).toBe(tools.AssetDescriptorSchema)
    expect(mcp.GetCodeParametersSchema).toBe(tools.GetCodeParametersSchema)
    expect(mcp.GetAssetsResultSchema).toBe(tools.GetAssetsResultSchema)
  })
})
