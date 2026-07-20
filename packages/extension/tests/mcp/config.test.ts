import * as shared from '@tempad-dev/shared'
import { describe, expect, it } from 'vitest'

import * as config from '../../mcp/config'

const exports = [
  'AGENT_INTEGRATIONS',
  'AGENT_INTEGRATIONS_BY_ID',
  'AGENT_SKILL_INSTALL_COMMAND',
  'getMcpClientCopyPayload',
  'getNextMcpClientCopyVariant',
  'MCP_CLIENTS',
  'MCP_CLIENTS_BY_ID',
  'MCP_DEFAULT_CONFIG_SNIPPET',
  'MCP_SERVERS_CONFIG_SNIPPET',
  'MCP_SERVER'
] as const

describe('mcp/config', () => {
  it('re-exports the shared install metadata', () => {
    for (const name of exports) {
      expect(config[name]).toBe(shared[name])
    }
  })
})
