import { defineConfig } from 'vitest/config'

import { SHARED_COVERAGE_FILES, SHARED_SCHEMA_COVERAGE_FILES } from '../../vitest.coverage.ts'

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: [...SHARED_COVERAGE_FILES],
      thresholds: {
        [`{${SHARED_SCHEMA_COVERAGE_FILES.join(',')}}`]: {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
          perFile: true
        }
      }
    }
  }
})
