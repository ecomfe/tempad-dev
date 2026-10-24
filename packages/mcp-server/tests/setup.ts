import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { inject } from 'vitest'

// Isolate each test file before runtime imports can create files or prune logs.
delete process.env.TEMPAD_MCP_DEV_CHECKOUT
const directory = mkdtempSync(join(inject('mcpTestDirectory'), 'worker-'))
process.env.TEMPAD_MCP_RUNTIME_DIR = join(directory, 'runtime')
process.env.TEMPAD_MCP_STATE_DIR = join(directory, 'state')
process.env.TEMPAD_MCP_LOG_DIR = join(directory, 'logs')
process.env.TEMPAD_MCP_ASSET_DIR = join(directory, 'assets')
