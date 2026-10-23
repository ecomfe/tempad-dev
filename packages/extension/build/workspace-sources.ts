import { fileURLToPath } from 'node:url'

// Internal builds and tests consume current SDK source without changing its public package exports.
export const workspaceSources = {
  '@tempad-dev/plugins': fileURLToPath(new URL('../../plugins/src/index.ts', import.meta.url))
}
