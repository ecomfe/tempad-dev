import type { Plugin } from 'vite'

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSION_ROOT = fileURLToPath(new URL('../', import.meta.url))
const SANDBOX_WORKER_QUERY = '?sandbox-worker'
const VIRTUAL_WORKER_PREFIX = '\0tempad-plugin-sandbox-worker:'

export async function bundleSandboxWorker(
  entry: string
): Promise<{ code: string; inputs: string[] }> {
  const result = await build({
    absWorkingDir: EXTENSION_ROOT,
    bundle: true,
    define: { __DEV__: 'true' },
    entryPoints: [entry],
    format: 'iife',
    logLevel: 'silent',
    metafile: true,
    platform: 'browser',
    target: 'chrome116',
    write: false
  })
  const output = result.outputFiles[0]
  if (!output) throw new Error(`Sandbox Worker bundle is empty: ${entry}`)
  return { code: output.text, inputs: Object.keys(result.metafile.inputs) }
}

export function pluginSandboxWorkers(development: boolean): Plugin {
  return {
    name: 'tempad-plugin-sandbox-workers',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(SANDBOX_WORKER_QUERY)) return null

      const workerRequest = source.slice(0, -SANDBOX_WORKER_QUERY.length)
      const resolved = await this.resolve(
        development ? workerRequest : `${workerRequest}?worker&inline`,
        importer,
        { skipSelf: true }
      )
      if (!resolved) throw new Error(`Unable to resolve sandbox Worker: ${workerRequest}`)
      return development ? `${VIRTUAL_WORKER_PREFIX}${resolved.id}` : resolved
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL_WORKER_PREFIX)) return null

      const entry = id.slice(VIRTUAL_WORKER_PREFIX.length)
      const { code, inputs } = await bundleSandboxWorker(entry)

      for (const input of inputs) {
        this.addWatchFile(path.resolve(EXTENSION_ROOT, input))
      }

      return `
const source = ${JSON.stringify(code)}
export default function PluginSandboxWorker(options) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try {
    return new Worker(url, options)
  } finally {
    URL.revokeObjectURL(url)
  }
}
`
    }
  }
}
