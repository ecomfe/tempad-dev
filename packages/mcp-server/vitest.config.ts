import { defineConfig } from 'vitest/config'

import { AGGREGATE_COVERAGE_THRESHOLDS } from '../../vitest.coverage'

export default defineConfig({
  test: {
    name: 'mcp-server',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: [
        'src/asset-utils.ts',
        'src/tools.ts',
        'src/config.ts',
        'src/request.ts',
        'src/asset-store.ts',
        'src/asset-http-server.ts',
        'src/extension-registry.ts',
        'src/extension-socket.ts',
        'src/security.ts',
        'src/websocket-server.ts',
        'src/shared.ts'
      ],
      thresholds: AGGREGATE_COVERAGE_THRESHOLDS
    }
  }
})
