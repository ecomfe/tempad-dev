import { defineConfig } from 'tsdown'

import config from './tsdown.config.ts'

// Keep the local-only diagnostic entry separate from the verified release payload.
export default defineConfig({
  ...config,
  entry: ['src/runtime-prototype.ts', 'src/log-transport.ts'],
  outDir: 'dist/prototype'
})
