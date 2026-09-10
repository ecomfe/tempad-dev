import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'site',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.browser.test.ts']
  }
})
