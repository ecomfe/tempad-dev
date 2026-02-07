import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: [
        'src/index.ts',
        'src/mcp/index.ts',
        'src/mcp/protocol.ts',
        'src/mcp/tools.ts',
        'src/mcp/constants.ts',
        'src/mcp/errors.ts',
        'src/figma/index.ts',
        'src/figma/color.ts',
        'src/figma/gradient.ts',
        'src/figma/stroke.ts',
        'src/figma/style-resolver.ts'
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
