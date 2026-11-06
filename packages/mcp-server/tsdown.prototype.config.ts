import { defineConfig } from 'tsdown'

import config, { workerEntries } from './tsdown.config.ts'

// Keep the local-only diagnostic entry separate from the verified release payload.
export default defineConfig({
  ...config,
  entry: {
    'runtime-prototype': 'src/runtime-prototype.ts',
    'log-transport': 'src/log-transport.ts',
    ...workerEntries
  },
  outDir: 'dist/prototype'
})
