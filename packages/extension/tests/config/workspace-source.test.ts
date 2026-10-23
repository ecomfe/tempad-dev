import { raw } from '@tempad-dev/plugins'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

import { raw as sourceRaw } from '../../../plugins/src/index'
import { bundleSandboxWorker, pluginSandboxWorkers } from '../../build/plugin-sandbox-workers'
import config from '../../wxt.config'

const extensionRoot = fileURLToPath(new URL('../../', import.meta.url))
const sdkSource = fileURLToPath(new URL('../../../plugins/src/index.ts', import.meta.url))

describe('workspace SDK source resolution', () => {
  it('runs Node tests against the authored SDK', () => {
    expect(raw).toBe(sourceRaw)
  })

  it('bundles authored SDK code into the extension and its production Workers', async () => {
    const modules: string[] = []
    const workerModules: string[] = []
    const entry = 'virtual:sdk-source-probe'
    const workerEntry = fileURLToPath(new URL('../../codegen/worker.ts', import.meta.url))
    await build({
      configFile: false,
      root: extensionRoot,
      logLevel: 'silent',
      resolve: { alias: config.alias },
      plugins: [
        pluginSandboxWorkers(false),
        {
          name: 'sdk-source-probe',
          resolveId: (id) => (id === entry ? `\0${entry}` : null),
          load: (id) =>
            id === `\0${entry}`
              ? `export { raw } from '@tempad-dev/plugins'; export { default as Worker } from ${JSON.stringify(`${workerEntry}?sandbox-worker`)}`
              : null,
          generateBundle() {
            modules.push(...this.getModuleIds())
          }
        }
      ],
      worker: {
        plugins: () => [
          {
            name: 'sdk-worker-source-probe',
            generateBundle() {
              workerModules.push(...this.getModuleIds())
            }
          }
        ]
      },
      build: { write: false, rolldownOptions: { input: entry } }
    })

    for (const bundledModules of [modules, workerModules]) {
      expect(bundledModules).toContain(sdkSource)
      expect(bundledModules.some((id) => id.includes('/plugins/dist/'))).toBe(false)
    }
  })

  it('bundles authored SDK code into development sandbox Workers', async () => {
    const { inputs } = await bundleSandboxWorker('codegen/worker.ts')
    expect(inputs).toContain('../plugins/src/index.ts')
    expect(inputs.some((id) => id.includes('/plugins/dist/'))).toBe(false)
  })
})
