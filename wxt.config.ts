import { defineConfig } from 'wxt'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [cssInjectedByJsPlugin()],
    optimizeDeps: {
      include: []
    }
  }),
  runner: {
    disabled: true
  },
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
