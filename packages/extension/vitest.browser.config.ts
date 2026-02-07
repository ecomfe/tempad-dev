import { playwright } from '@vitest/browser-playwright'
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
    name: 'extension-browser',
    include: ['tests/**/*.browser.test.ts'],
    setupFiles: ['./tests/setup.browser.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }]
    }
  }
})
