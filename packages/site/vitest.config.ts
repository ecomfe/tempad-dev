import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      // Match only the package entry; /ui subpaths keep their own exports.
      {
        find: /^@tempad-dev\/shared$/,
        replacement: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))
      }
    ]
  },
  test: {
    name: 'site',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.browser.test.ts']
  }
})
