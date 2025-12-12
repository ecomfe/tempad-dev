import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { defineConfig } from 'wxt'

const newElements = ['selectedcontent']

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vue: {
    vite: {
      template: {
        compilerOptions: {
          isCustomElement: (tag) => newElements.includes(tag)
        }
      }
    }
  },
  vite: () => ({
    plugins: [cssInjectedByJsPlugin()],
    optimizeDeps: {
      include: []
    }
  }),
  webExt: {
    disabled: true
  },
  manifest: {
    name: 'TemPad Dev',
    web_accessible_resources: [
      {
        resources: ['/ui.js', '/figma.js', '/codegen.js'],
        matches: ['https://www.figma.com/*']
      }
    ],
    permissions: ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'alarms'],
    declarative_net_request: {
      rule_resources: [
        {
          id: 'figma',
          enabled: true,
          path: 'rules/figma.json'
        }
      ]
    }
  }
})
