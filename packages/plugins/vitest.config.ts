import { defineConfig } from 'vitest/config'

import { FULL_COVERAGE_THRESHOLDS } from '../../vitest.coverage'

export default defineConfig({
  test: {
    name: 'plugins',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: ['src/index.ts'],
      thresholds: FULL_COVERAGE_THRESHOLDS
    }
  }
})
