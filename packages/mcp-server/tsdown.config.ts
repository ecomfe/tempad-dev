import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'
import raw from 'unplugin-raw/rolldown'

const require = createRequire(import.meta.url)
const pinoRequire = createRequire(require.resolve('pino'))
export const workerEntries = {
  'thread-stream-worker': pinoRequire.resolve('thread-stream/lib/worker.js'),
  'pino-worker': require.resolve('pino/lib/worker.js'),
  'pino-file': require.resolve('pino/file.js')
}

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    hub: 'src/hub.ts',
    'log-transport': 'src/log-transport.ts',
    'managed-runtime': 'src/managed-runtime.ts',
    'runtime-verification': 'src/runtime-verification.ts',
    'runtime-installer': 'src/runtime-installer.ts',
    ...workerEntries
  },
  plugins: [
    raw(),
    {
      name: 'runtime-licenses',
      generateBundle() {
        const directories = new Set<string>()
        for (const id of this.getModuleIds()) {
          const match = id.replaceAll('\\', '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)
          if (match) directories.add(match[1]!)
        }
        const notices = [...directories].sort().flatMap((directory) =>
          readdirSync(directory)
            .filter((name) => /^(license|copying|notice)(\.|$)/i.test(name))
            .map(
              (name) =>
                `${directory.split('/node_modules/').at(-1)} / ${name}\n${readFileSync(join(directory, name), 'utf8')}`
            )
        )
        if (!notices.length) throw new Error('Bundled runtime licenses are missing.')
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD-PARTY-LICENSES.txt',
          source: notices.join('\n\n')
        })
      }
    }
  ],
  shims: true,
  deps: { onlyBundle: false, onlyImport: [] },
  banner: `import { fileURLToPath as runtimeFilePath } from 'node:url';
globalThis.__bundlerPathsOverrides = {
  'thread-stream-worker': runtimeFilePath(new URL('./thread-stream-worker.mjs', import.meta.url)),
  'pino-worker': runtimeFilePath(new URL('./pino-worker.mjs', import.meta.url)),
  'pino/file': runtimeFilePath(new URL('./pino-file.mjs', import.meta.url))
};`,
  inputOptions: { resolve: { conditionNames: ['source'] } },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  unbundle: false
})
