#!/usr/bin/env node

import { build } from 'esbuild'
import { rmSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(THIS_DIR)
const DIST_DIR = join(ROOT, 'dist')
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const externalDeps = Object.keys(PACKAGE_JSON.dependencies ?? {})

rmSync(DIST_DIR, { recursive: true, force: true })

await build({
  entryPoints: [join(ROOT, 'src/cli.ts'), join(ROOT, 'src/hub.ts')],
  outdir: DIST_DIR,
  platform: 'node',
  format: 'esm',
  target: ['node18'],
  bundle: true,
  external: externalDeps,
  sourcemap: true,
  logLevel: 'info',
  loader: {
    '.md': 'text'
  }
})
