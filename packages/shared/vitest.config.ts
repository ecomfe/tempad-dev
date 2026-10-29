import { defineConfig } from 'vitest/config'

import {
  FULL_COVERAGE_THRESHOLDS,
  SHARED_COVERAGE_FILES,
  SHARED_SCHEMA_COVERAGE_FILES
} from '../../vitest.coverage.ts'

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
        [`{${SHARED_SCHEMA_COVERAGE_FILES.join(',')}}`]: FULL_COVERAGE_THRESHOLDS
      }
    }
  }
})
