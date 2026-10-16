import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

import {
  AGENT_RUNTIME_FILES,
  coverageThresholds,
  MCP_CORE_COVERAGE_FILES,
  MCP_COVERAGE_FILES
} from '../../vitest.coverage.ts'

const agentRuntimeFiles = AGENT_RUNTIME_FILES.map((file) => `../../${file}`)

export default defineConfig({
  resolve: {
    conditions: ['source', 'module', 'node', 'development|production'],
    alias: [
      // Match only the package entry; /ui subpaths keep their own exports.
      {
        find: /^@tempad-dev\/shared$/,
        replacement: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))
      }
    ]
  },
  test: {
    name: 'mcp-server',
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', ...agentRuntimeFiles],
      allowExternal: true,
      thresholds: coverageThresholds(
        [...MCP_COVERAGE_FILES, ...agentRuntimeFiles],
        MCP_CORE_COVERAGE_FILES
      )
    }
  }
})
