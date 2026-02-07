import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/extension/vitest.node.config.ts',
      'packages/extension/vitest.browser.config.ts',
      'packages/plugins/vitest.config.ts',
      'packages/mcp-server/vitest.config.ts',
      'packages/shared/vitest.config.ts'
    ],
    coverage: {
      provider: 'istanbul',
      include: [
        'packages/extension/utils/number.ts',
        'packages/extension/utils/string.ts',
        'packages/extension/utils/object.ts',
        'packages/extension/utils/color.ts',
        'packages/extension/utils/css.ts',
        'packages/extension/utils/tailwind.ts',
        'packages/extension/utils/codegen.ts',
        'packages/extension/mcp/tools/code/styles/normalize.ts',
        'packages/plugins/src/index.ts',
        'packages/mcp-server/src/asset-utils.ts',
        'packages/mcp-server/src/tools.ts',
        'packages/mcp-server/src/config.ts',
        'packages/mcp-server/src/request.ts',
        'packages/shared/src/mcp/protocol.ts',
        'packages/shared/src/figma/color.ts',
        'packages/shared/src/figma/gradient.ts',
        'packages/shared/src/figma/stroke.ts',
        'packages/shared/src/figma/style-resolver.ts'
      ],
      exclude: ['**/dist/**', '**/.output/**']
    }
  }
})
