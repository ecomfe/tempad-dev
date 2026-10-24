import { fileURLToPath } from 'node:url'
import { defaultClientConditions } from 'vite'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { defineConfig } from 'wxt'

import { checkoutProfile } from '../../agent-plugin/src/clients/shared/runtime-profile.mjs'
import { computeExtensionRuntimeFingerprint } from '../../scripts/extension-runtime-fingerprint.mjs'
import { pluginSandboxWorkers } from './build/plugin-sandbox-workers'
import { workspaceSources } from './build/workspace-sources'
import { MCP_LOCAL_HOST_ORIGIN } from './mcp/permissions'
import packageJson from './package.json' with { type: 'json' }

const newElements = ['selectedcontent']
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const extensionRuntimeFingerprint = computeExtensionRuntimeFingerprint(repositoryRoot)

export function extensionRuntimeProfile(
  command: string,
  checkout = process.env.TEMPAD_MCP_DEV_CHECKOUT
) {
  if (checkout !== undefined && checkoutProfile(checkout).id !== checkoutProfile(repositoryRoot).id)
    throw new Error('The extension build does not belong to TEMPAD_MCP_DEV_CHECKOUT.')
  return checkout !== undefined || command === 'serve'
    ? checkoutProfile(repositoryRoot)
    : { kind: 'release' as const }
}

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
  hooks: {
    'build:before': (wxt) => {
      const profile = extensionRuntimeProfile(wxt.config.command)
      wxt.logger.info(
        `TemPad MCP profile: ${profile.kind}${profile.kind === 'checkout' ? ` (${profile.id})` : ''}`
      )
    },
    'zip:start': (wxt) => {
      if (extensionRuntimeProfile(wxt.config.command).kind !== 'release')
        throw new Error(
          'Cannot package a checkout extension for release. Unset TEMPAD_MCP_DEV_CHECKOUT and run pnpm zip again.'
        )
    }
  },
  alias: workspaceSources,
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
    resolve: { conditions: ['source', ...defaultClientConditions] },
    plugins: [cssInjectedByJsPlugin(), pluginSandboxWorkers(env.command === 'serve')],
    server: env.command === 'serve' ? { cors: true } : undefined,
    optimizeDeps: {
      include: []
    },
    define: {
      __DEV__: env.mode === 'development',
      __TEMPAD_RUNTIME_PROFILE__: JSON.stringify(extensionRuntimeProfile(env.command)),
      __TEMPAD_RUNTIME_FINGERPRINT__: JSON.stringify(extensionRuntimeFingerprint)
    }
  }),
  webExt: {
    disabled: true
  },
  manifest: (env) => ({
    minimum_chrome_version: '116',
    name: 'TemPad Dev',
    version: packageJson.version,
    content_security_policy: {
      sandbox: getPluginSandboxCsp(env.command === 'serve')
    },
    web_accessible_resources: [
      {
        resources: [
          '/ui.js',
          '/loader.js',
          '/figma.js',
          '/plugin-sandbox.html',
          '/chunks/plugin-sandbox-*.js'
        ],
        matches: ['https://www.figma.com/*']
      }
    ],
    permissions: ['declarativeNetRequestWithHostAccess', 'alarms', 'storage'],
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
