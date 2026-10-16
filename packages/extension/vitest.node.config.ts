import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

import {
  coverageThresholds,
  EXTENSION_COVERAGE_FILES,
  EXTENSION_CORE_COVERAGE_FILES,
  EXTENSION_SOURCE_FILES
} from '../../vitest.coverage.ts'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    conditions: ['source', 'module', 'node', 'development|production'],
    alias: [
      // Keep node tests independent of build output, including SSR resolution.
      {
        find: /^@tempad-dev\/shared$/,
        replacement: path.resolve(rootDir, '../shared/src/index.ts')
      },
      { find: '@', replacement: path.resolve(rootDir) }
    ]
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
      include: [...EXTENSION_SOURCE_FILES],
      thresholds: coverageThresholds(EXTENSION_COVERAGE_FILES, EXTENSION_CORE_COVERAGE_FILES)
    }
  }
})
