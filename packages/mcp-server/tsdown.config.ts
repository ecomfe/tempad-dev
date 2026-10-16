import { defineConfig } from 'tsdown'
import raw from 'unplugin-raw/rolldown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/hub.ts', 'src/log-transport.ts'],
  plugins: [raw()],
  inputOptions: { resolve: { conditionNames: ['source'] } },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  unbundle: false
})
