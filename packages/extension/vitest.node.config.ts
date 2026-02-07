import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

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
      include: [
        'utils/number.ts',
        'utils/string.ts',
        'utils/object.ts',
        'utils/color.ts',
        'utils/css.ts',
        'utils/tailwind.ts',
        'utils/codegen.ts',
        'mcp/tools/code/styles/normalize.ts'
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
        perFile: true
      }
    }
  }
})
