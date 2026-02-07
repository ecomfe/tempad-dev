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
        'packages/extension/rewrite/shared.ts',
        'packages/extension/mcp/errors.ts',
        'packages/extension/mcp/transport.ts',
        'packages/extension/mcp/tools/structure.ts',
        'packages/extension/mcp/tools/code/layout-parent.ts',
        'packages/extension/mcp/tools/code/messages.ts',
        'packages/extension/mcp/tools/code/render/props.ts',
        'packages/extension/mcp/tools/code/variables.ts',
        'packages/extension/mcp/tools/code/sanitize/negative-gap.ts',
        'packages/extension/mcp/tools/code/sanitize/relative-parent.ts',
        'packages/extension/mcp/tools/code/sanitize/stacking.ts',
        'packages/extension/mcp/tools/code/styles/layout.ts',
        'packages/extension/mcp/tools/code/styles/overflow.ts',
        'packages/extension/mcp/tools/code/assets/plan.ts',
        'packages/extension/mcp/tools/code/styles/normalize.ts',
        'packages/extension/mcp/tools/code/styles/prepare.ts',
        'packages/extension/mcp/tools/code/tokens/extract.ts',
        'packages/extension/mcp/tools/code/tokens/transform.ts',
        'packages/extension/mcp/tools/code/tokens/process.ts',
        'packages/extension/mcp/tools/code/tokens/rewrite.ts',
        'packages/extension/mcp/tools/code/tokens/source-index.ts',
        'packages/extension/mcp/tools/code/tokens/used.ts',
        'packages/extension/mcp/tools/code/tokens/cache.ts',
        'packages/extension/mcp/tools/code/tokens/resolve.ts',
        'packages/extension/mcp/tools/token/candidates.ts',
        'packages/plugins/src/index.ts',
        'packages/mcp-server/src/asset-utils.ts',
        'packages/mcp-server/src/tools.ts',
        'packages/mcp-server/src/config.ts',
        'packages/mcp-server/src/request.ts',
        'packages/mcp-server/src/asset-store.ts',
        'packages/mcp-server/src/asset-http-server.ts',
        'packages/shared/src/mcp/constants.ts',
        'packages/shared/src/mcp/errors.ts',
        'packages/shared/src/mcp/protocol.ts',
        'packages/shared/src/mcp/tools.ts',
        'packages/shared/src/figma/color.ts',
        'packages/shared/src/figma/gradient.ts',
        'packages/shared/src/figma/stroke.ts',
        'packages/shared/src/figma/style-resolver.ts'
      ],
      exclude: ['**/dist/**', '**/.output/**']
    }
  }
})
