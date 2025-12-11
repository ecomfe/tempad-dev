import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import raw from 'unplugin-raw/rolldown'

const dir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

// Treat workspace-internal deps as bundled, leave others external.
const internalDeps = Object.keys(pkg.dependencies ?? {}).filter((name: string) =>
  name.startsWith('@tempad-dev/')
)

export default defineConfig({
  entry: ['src/cli.ts', 'src/hub.ts'],
  plugins: [raw()],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  unbundle: false,
  noExternal: internalDeps
})
