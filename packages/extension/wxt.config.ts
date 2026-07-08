import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { defineConfig } from 'wxt'

import { MCP_LOCAL_HOST_ORIGINS } from './mcp/permissions'

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
  vite: (env) => ({
    plugins: [cssInjectedByJsPlugin()],
    optimizeDeps: {
      include: []
    },
    define: {
      __DEV__: env.mode === 'development'
    }
  }),
  webExt: {
    disabled: true
  },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      const hostPermissions = new Set(manifest.host_permissions ?? [])
      manifest.optional_host_permissions = manifest.optional_host_permissions?.filter(
        (origin: string) => !hostPermissions.has(origin)
      )
      if (manifest.optional_host_permissions?.length === 0) {
        delete manifest.optional_host_permissions
      }
    }
  },
  manifest: {
    minimum_chrome_version: '116',
    name: 'TemPad Dev',
    web_accessible_resources: [
      {
        resources: ['/ui.js', '/loader.js', '/figma.js', '/codegen.js'],
        matches: ['https://www.figma.com/*']
      }
    ],
    permissions: ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'alarms'],
    host_permissions: ['https://www.figma.com/*'],
    optional_host_permissions: [...MCP_LOCAL_HOST_ORIGINS],
    declarative_net_request: {
      rule_resources: [
        {
          id: 'figma',
          enabled: true,
          path: 'rules/figma.json'
        }
      ]
    }
  },
  zip: {
    artifactTemplate: 'tempad-dev-{{version}}-{{browser}}.zip'
  }
})
