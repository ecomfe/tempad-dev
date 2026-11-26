import { defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    name: 'site',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.browser.test.ts']
  }
})
