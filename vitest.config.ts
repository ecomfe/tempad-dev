import { defineConfig } from 'vitest/config'

import { AGGREGATE_COVERAGE_THRESHOLDS, EXTENSION_COVERAGE_FILES } from './vitest.coverage'

export default defineConfig({
  test: {
    // Keep root-managed projects to package-local node configs.
    // Browser tests run via package-owned scripts to avoid cross-workspace runtime mixing.
    projects: [
      'packages/extension/vitest.node.config.ts',
      'packages/plugins/vitest.config.ts',
      'packages/mcp-server/vitest.config.ts',
      'packages/shared/vitest.config.ts'
    ],
    coverage: {
      provider: 'istanbul',
      include: [
        ...EXTENSION_COVERAGE_FILES.map((file) => `packages/extension/${file}`),
        'packages/plugins/src/index.ts',
        'packages/mcp-server/src/asset-utils.ts',
        'packages/mcp-server/src/tools.ts',
        'packages/mcp-server/src/config.ts',
        'packages/mcp-server/src/request.ts',
        'packages/mcp-server/src/asset-store.ts',
        'packages/mcp-server/src/asset-http-server.ts',
        'packages/mcp-server/src/extension-registry.ts',
        'packages/mcp-server/src/extension-socket.ts',
        'packages/mcp-server/src/security.ts',
        'packages/mcp-server/src/websocket-server.ts',
        'packages/mcp-server/src/shared.ts',
        'packages/shared/src/index.ts',
        'packages/shared/src/mcp/browser-gateway.ts',
        'packages/shared/src/mcp/constants.ts',
        'packages/shared/src/mcp/errors.ts',
        'packages/shared/src/mcp/index.ts',
        'packages/shared/src/mcp/protocol.ts',
        'packages/shared/src/mcp/responses.ts',
        'packages/shared/src/mcp/tool-result.ts',
        'packages/shared/src/mcp/tools.ts'
      ],
      exclude: ['**/dist/**', '**/.output/**'],
      thresholds: AGGREGATE_COVERAGE_THRESHOLDS
    }
  }
})
