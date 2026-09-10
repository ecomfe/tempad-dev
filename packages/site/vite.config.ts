import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

import { loadSkillPreview } from './scripts/skill-preview'

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
  plugins: [vue(), skillPreviewPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
