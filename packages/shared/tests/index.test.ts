import { describe, expect, it } from 'vitest'

import * as shared from '../src'
import * as figma from '../src/figma'
import * as mcp from '../src/mcp'

describe('shared root index barrel', () => {
  it('re-exports mcp and figma module surfaces', () => {
    expect(shared.MCP_MAX_PAYLOAD_BYTES).toBe(mcp.MCP_MAX_PAYLOAD_BYTES)
    expect(shared.TEMPAD_MCP_ERROR_CODES).toBe(mcp.TEMPAD_MCP_ERROR_CODES)
    expect(shared.GetCodeParametersSchema).toBe(mcp.GetCodeParametersSchema)
    expect(shared.parseMessageToExtension).toBe(mcp.parseMessageToExtension)

    expect(shared.formatHexAlpha).toBe(figma.formatHexAlpha)
    expect(shared.resolveGradientFromPaints).toBe(figma.resolveGradientFromPaints)
    expect(shared.resolveStylesFromNode).toBe(figma.resolveStylesFromNode)
  })
})
