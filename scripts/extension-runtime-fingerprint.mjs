import { globbySync } from 'globby'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const EXTENSION_RUNTIME_ENTRIES = [
  'packages/extension/assets',
  'packages/extension/build',
  'packages/extension/codegen',
  'packages/extension/components',
  'packages/extension/composables',
  'packages/extension/entrypoints',
  'packages/extension/mcp',
  'packages/extension/plugin-sandbox',
  'packages/extension/plugins',
  'packages/extension/public',
  'packages/extension/rewrite',
  'packages/extension/types',
  'packages/extension/ui',
  'packages/extension/utils',
  'packages/extension/worker',
  'packages/extension/package.json',
  'packages/extension/types.d.ts',
  'packages/extension/wxt.config.ts',
  'packages/shared/package.json',
  'packages/shared/src',
  'scripts/extension-runtime-fingerprint.mjs'
]

export function listExtensionRuntimeSources(repositoryRoot) {
  const root = resolve(repositoryRoot)
  return globbySync(EXTENSION_RUNTIME_ENTRIES, {
    cwd: root,
    absolute: true,
    dot: true,
    gitignore: true,
    followSymbolicLinks: false
  }).sort((left, right) => relative(root, left).localeCompare(relative(root, right), 'en'))
}

export function computeExtensionRuntimeFingerprint(repositoryRoot) {
  const root = resolve(repositoryRoot)
  const hash = createHash('sha256')
  for (const path of listExtensionRuntimeSources(root)) {
    hash.update(relative(root, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}
