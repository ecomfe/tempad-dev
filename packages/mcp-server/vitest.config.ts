import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'mcp-server',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: [
        'src/asset-utils.ts',
        'src/tools.ts',
        'src/config.ts',
        'src/request.ts',
        'src/asset-store.ts',
        'src/asset-http-server.ts',
        'src/shared.ts'
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
