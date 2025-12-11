import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/hub.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // Leave deps external automatically; tsdown will treat deps/peerDeps as externals when unbundle=true.
  unbundle: true
})
