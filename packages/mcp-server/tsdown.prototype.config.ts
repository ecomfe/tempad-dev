import { defineConfig } from 'tsdown'

import config from './tsdown.config.ts'

// Build separately so prototype imports cannot split the installed Hub entry or
// change the runtime fingerprint used by development preflight.
export default defineConfig({
  ...config,
  entry: ['src/runtime-prototype.ts', 'src/log-transport.ts'],
  outDir: 'dist/prototype'
})
