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
        'utils/module.ts',
        'utils/log.ts',
        'utils/figma.ts',
        'utils/css.ts',
        'utils/tailwind.ts',
        'utils/codegen.ts',
        'utils/index.ts',
        'utils/tempad.ts',
        'composables/copy.ts',
        'composables/deep-link.ts',
        'composables/input.ts',
        'composables/scrollbar.ts',
        'composables/toast.ts',
        'composables/index.ts',
        'worker/safe.ts',
        'worker/lockdown.ts',
        'mcp/index.ts',
        'mcp/config.ts',
        'mcp/assets.ts',
        'mcp/runtime.ts',
        'mcp/transform-variables/requester.ts',
        'mcp/transform-variables/worker.ts',
        'rewrite/config.ts',
        'rewrite/figma.ts',
        'rewrite/runtime.ts',
        'rewrite/shared.ts',
        'mcp/errors.ts',
        'mcp/transport.ts',
        'mcp/tools/config.ts',
        'mcp/tools/structure.ts',
        'mcp/tools/screenshot.ts',
        'mcp/tools/code/layout-parent.ts',
        'mcp/tools/code/messages.ts',
        'mcp/tools/code/render/props.ts',
        'mcp/tools/code/variables.ts',
        'mcp/tools/code/sanitize/negative-gap.ts',
        'mcp/tools/code/sanitize/relative-parent.ts',
        'mcp/tools/code/sanitize/stacking.ts',
        'mcp/tools/code/sanitize/index.ts',
        'mcp/tools/code/styles/layout.ts',
        'mcp/tools/code/styles/overflow.ts',
        'mcp/tools/code/styles/index.ts',
        'mcp/tools/code/assets/plan.ts',
        'mcp/tools/code/assets/vector.ts',
        'mcp/tools/code/assets/export.ts',
        'mcp/tools/code/assets/image.ts',
        'mcp/tools/code/assets/index.ts',
        'mcp/tools/code/styles/normalize.ts',
        'mcp/tools/code/styles/prepare.ts',
        'mcp/tools/code/tokens/extract.ts',
        'mcp/tools/code/tokens/index.ts',
        'mcp/tools/code/tokens/transform.ts',
        'mcp/tools/code/tokens/process.ts',
        'mcp/tools/code/tokens/rewrite.ts',
        'mcp/tools/code/tokens/source-index.ts',
        'mcp/tools/code/tokens/used.ts',
        'mcp/tools/code/text/index.ts',
        'mcp/tools/code/text/types.ts',
        'mcp/tools/code/tokens/cache.ts',
        'mcp/tools/code/tokens/resolve.ts',
        'mcp/tools/token/candidates.ts',
        'mcp/tools/token/cache.ts',
        'mcp/tools/token/indexer.ts',
        'mcp/tools/token/mapping.ts',
        'mcp/tools/token/index.ts'
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
