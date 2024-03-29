import { defineConfig } from 'wxt'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  srcDir: 'src',
  imports: {
    addons: {
      vueTemplate: true
    }
  },
  vite: () => ({
    plugins: [vue(), cssInjectedByJsPlugin()],
    build: {
      sourcemap: false
    }
  }),
  manifest: {
    name: 'TemPad Dev',
    web_accessible_resources: [
      {
        resources: ['/ui.js'],
        matches: ['https://www.figma.com/*']
      }
    ]
  }
})
