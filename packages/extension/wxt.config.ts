import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { defineConfig } from 'wxt'

import { pluginSandboxWorkers } from './build/plugin-sandbox-workers'
import { MCP_LOCAL_HOST_ORIGIN } from './mcp/permissions'

const newElements = ['selectedcontent']

export function getPluginSandboxCsp(development: boolean): string {
  const connectSources = development ? 'ws://localhost:* ws://127.0.0.1:*' : "'none'"

  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src 'self' blob:",
    'worker-src blob:',
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

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
    plugins: [cssInjectedByJsPlugin(), pluginSandboxWorkers(env.command === 'serve')],
    server: env.command === 'serve' ? { cors: true } : undefined,
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
  manifest: (env) => ({
    minimum_chrome_version: '116',
    name: 'TemPad Dev',
    content_security_policy: {
      sandbox: getPluginSandboxCsp(env.command === 'serve')
    },
    web_accessible_resources: [
      {
        resources: [
          '/ui.js',
          '/loader.js',
          '/figma.js',
          '/codegen.js',
          '/plugin-sandbox.html',
          '/chunks/plugin-sandbox-*.js'
        ],
        matches: ['https://www.figma.com/*']
      }
    ],
    permissions: ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'alarms'],
    host_permissions: ['https://www.figma.com/*'],
    optional_host_permissions: [MCP_LOCAL_HOST_ORIGIN],
    declarative_net_request: {
      rule_resources: [
        {
          id: 'figma',
          enabled: true,
          path: 'rules/figma.json'
        }
      ]
    }
  }),
  zip: {
    artifactTemplate: 'tempad-dev-{{version}}-{{browser}}.zip'
  }
})
