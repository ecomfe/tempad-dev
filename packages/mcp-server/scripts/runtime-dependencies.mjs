import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { runPackageManagerSync } from './package-manager.mjs'

/** Keep cache preparation and offline packaging on the same frozen dependency graph. */
export function deployRuntimeDependencies(repo, directory, { offline }) {
  const { packageManager } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const selectedPnpm = runPackageManagerSync('pnpm', ['--version'], {
    cwd: repo,
    encoding: 'utf8'
  }).trim()
  assert.equal(
    `pnpm@${selectedPnpm}`,
    packageManager,
    'Release packaging must use the pnpm version pinned by the workspace.'
  )
  runPackageManagerSync(
    'pnpm',
    [
      '--filter',
      '@tempad-dev/mcp',
      'deploy',
      '--prod',
      ...(offline ? ['--offline'] : []),
      '--ignore-scripts',
      '--frozen-lockfile',
      '--config.node-linker=hoisted',
      // npm pack can stall on shared inodes from content-store hardlinks.
      // Independent files also keep release artifacts free of tar hardlinks.
      '--config.package-import-method=copy',
      directory
    ],
    { cwd: repo, stdio: 'inherit' }
  )
}
