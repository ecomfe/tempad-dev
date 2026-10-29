import console from 'node:console'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { deployRuntimeDependencies } from './runtime-dependencies.mjs'

const repo = fileURLToPath(new URL('../../..', import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-dependencies-')))
try {
  // A workspace install can verify with online evidence that is absent from its
  // metadata cache. Verify the exact reduced production graph before going offline.
  deployRuntimeDependencies(repo, join(root, 'deploy'), { offline: false })
  console.log('Prepared frozen runtime dependencies for offline packaging; no artifact created.')
} finally {
  rmSync(root, { recursive: true, force: true })
}
