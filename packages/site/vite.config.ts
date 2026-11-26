import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defaultClientConditions, defaultServerConditions, defineConfig, type Plugin } from 'vite'

import { loadSkillPreview } from './scripts/skill-preview.ts'

export function skillPreviewPlugin(): Plugin {
  return {
    name: 'skill-preview',
    async load(id: string) {
      if (!id.endsWith('?skill-preview')) return null
      const preview = await loadSkillPreview(id.slice(0, -'?skill-preview'.length), (path) =>
        this.addWatchFile(path)
      )
      return `export default ${JSON.stringify(preview)}`
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    skillPreviewPlugin(),
    {
      name: 'external-hermes-artwork',
      enforce: 'pre',
      load(id) {
        if (!id.endsWith('/shared/src/ui/assets/hermes-agent.svg?raw')) return
        const path = id.slice(0, -'?raw'.length)
        return `import url from ${JSON.stringify(path + '?no-inline')}
          export default '<svg><use width="100%" height="100%" href="' + url + '#tempad-hermes-wing"/></svg>'`
      }
    }
  ],
  ssr: {
    noExternal: ['@tempad-dev/shared'],
    resolve: { conditions: ['source', ...defaultServerConditions] }
  },
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
