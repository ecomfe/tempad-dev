import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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

function listFiles(path) {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return listFiles(child)
    return entry.isFile() ? [child] : []
  })
}

export function listExtensionRuntimeSources(repositoryRoot) {
  const root = resolve(repositoryRoot)
  return EXTENSION_RUNTIME_ENTRIES.flatMap((entry) => listFiles(join(root, entry))).sort(
    (left, right) => relative(root, left).localeCompare(relative(root, right), 'en')
  )
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
