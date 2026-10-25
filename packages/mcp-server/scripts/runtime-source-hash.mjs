import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Release review covers behavior, not only the visible instructions hash. */
export function runtimeSourceHash(repo) {
  const paths = [
    'packages/mcp-server/package.json',
    'packages/mcp-server/tsdown.config.ts',
    'packages/mcp-server/scripts/runtime-contract.mjs',
    'pnpm-lock.yaml'
  ]
  function visit(path) {
    for (const entry of readdirSync(join(repo, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) paths.push(child)
      else throw new Error('Release sources may not contain symlinks.')
    }
  }
  visit('packages/mcp-server/src')
  visit('packages/shared/src')
  const hash = createHash('sha256')
  for (const path of paths.sort())
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(repo, path)))
      .update('\0')
  return hash.digest('hex')
}
