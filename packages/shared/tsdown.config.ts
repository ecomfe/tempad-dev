import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', install: 'src/mcp/install.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  outDir: 'dist'
})
