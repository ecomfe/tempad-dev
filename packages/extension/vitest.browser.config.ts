import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

import { workspaceSources } from './build/workspace-sources.ts'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    include: ['vue/compiler-sfc']
  },
  resolve: {
    conditions: ['source', 'module', 'browser', 'development|production'],
    alias: {
      ...workspaceSources,
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
