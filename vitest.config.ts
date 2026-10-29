import { defineConfig } from 'vitest/config'

import {
  AGENT_RUNTIME_FILES,
  coverageThresholds,
  COVERAGE_BASELINE_FILES,
  EXTENSION_CORE_COVERAGE_FILES,
  MCP_CORE_COVERAGE_FILES,
  EXTENSION_SOURCE_FILES,
  FULL_COVERAGE_THRESHOLDS,
  SHARED_SCHEMA_COVERAGE_FILES
} from './vitest.coverage.ts'

export default defineConfig({
  test: {
    // Keep root-managed projects to package-local node configs.
    // Browser tests run via package-owned scripts to avoid cross-workspace runtime mixing.
    projects: [
      'packages/extension/vitest.node.config.ts',
      'packages/plugins/vitest.config.ts',
      'packages/mcp-server/vitest.config.ts',
      'packages/shared/vitest.config.ts',
      'packages/site/vitest.config.ts'
    ],
    coverage: {
      provider: 'istanbul',
      include: [
        ...AGENT_RUNTIME_FILES,
        ...EXTENSION_SOURCE_FILES.map((file) => `packages/extension/${file}`),
        'packages/{mcp-server,shared,plugins,site}/src/**/*.ts'
      ],
      exclude: ['**/dist/**', '**/.output/**', '**/*.d.ts'],
      thresholds: {
        ...coverageThresholds(
          [...COVERAGE_BASELINE_FILES, ...AGENT_RUNTIME_FILES],
          [
            ...EXTENSION_CORE_COVERAGE_FILES.map((file) => `packages/extension/${file}`),
            ...MCP_CORE_COVERAGE_FILES.map((file) => `packages/mcp-server/${file}`)
          ]
        ),
        [`{${[
          ...SHARED_SCHEMA_COVERAGE_FILES.map((file) => `packages/shared/${file}`),
          'packages/plugins/src/index.ts'
        ].join(',')}}`]: FULL_COVERAGE_THRESHOLDS
      }
    }
  }
})
