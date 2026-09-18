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
        'src/design-tasks.ts',
        'src/agent-clients/identity.ts',
        'src/agent-clients/registry.ts',
        'src/agent-clients/hooks.ts',
        'src/agent-clients/codex-ipc.ts',
        'src/agent-clients/codex-feedback.ts',
        'src/agent-clients/types.ts',
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
