import { defineConfig } from 'tsdown'
import raw from 'unplugin-raw/rolldown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/hub.ts'],
  plugins: [raw()],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  unbundle: false
})
