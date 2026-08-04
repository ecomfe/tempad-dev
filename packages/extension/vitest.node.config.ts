import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

import { AGGREGATE_COVERAGE_THRESHOLDS, EXTENSION_COVERAGE_FILES } from '../../vitest.coverage'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir)
    }
  },
  test: {
    name: 'extension-node',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.browser.test.ts'],
    setupFiles: ['./tests/setup.node.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: [...EXTENSION_COVERAGE_FILES],
      thresholds: AGGREGATE_COVERAGE_THRESHOLDS
    }
  }
})
