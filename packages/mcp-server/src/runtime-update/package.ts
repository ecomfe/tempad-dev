import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'

import { readArchive, verifyIntegrity } from './archive'
import {
  MANIFEST_PATH,
  ManifestSchema,
  PACKAGE_NAME,
  supportsNode,
  VersionSchema
} from './manifest'

const PackageSchema = z.object({
  name: z.literal(PACKAGE_NAME),
  version: VersionSchema,
  bin: z.literal('dist/cli.mjs'),
  engines: z.object({ node: z.string() }),
  dependencies: z.record(z.string(), z.string()),
  bundleDependencies: z.array(z.string())
})

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')

/** This is checked before even a self-test may execute package code. */
export function verifyPackage(files: ReadonlyMap<string, Buffer>, expectedVersion: string) {
  const json = (path: string) => {
    const bytes = files.get(path)
    if (!bytes || bytes.length > 4 * 1024 * 1024) throw new Error(`Missing or oversized ${path}.`)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  }
  const pkg = PackageSchema.parse(json('package.json'))
  const manifest = ManifestSchema.parse(json(MANIFEST_PATH))
  if (
    pkg.version !== expectedVersion ||
    manifest.packageVersion !== expectedVersion ||
    manifest.node !== pkg.engines.node
  )
    throw new Error('Runtime package identity disagrees with its manifest.')
  if (
    !supportsNode(manifest.node) ||
    !manifest.platforms.includes(process.platform as 'darwin' | 'linux')
  )
    throw new Error('This runtime cannot run on the current Node version/platform.')
  if (Object.keys(manifest.files).length !== files.size - 1 || manifest.files[MANIFEST_PATH])
    throw new Error('The manifest must inventory every payload file exactly once.')
  for (const [path, bytes] of files) {
    if (path !== MANIFEST_PATH && manifest.files[path] !== sha256(bytes))
      throw new Error(`Runtime payload hash mismatch: ${path}`)
  }
  if (!files.has(manifest.entry) || !files.has(pkg.bin) || !files.has('dist/log-transport.mjs'))
    throw new Error('The runtime payload is incomplete.')
  if (Object.keys(pkg.dependencies).some((name) => !pkg.bundleDependencies.includes(name)))
    throw new Error('All runtime dependencies must be bundled.')

  // Node resolution must terminate inside this package, including transitive
  // worker dependencies. The release build supplies them from the frozen lock.
  for (const path of files.keys()) {
    if (
      path !== 'package.json' &&
      !/^node_modules\/(?:@[^/]+\/)?[^/]+\/(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)*package\.json$/.test(
        path
      )
    )
      continue
    const dependencyPackage = z
      .object({
        dependencies: z.record(z.string(), z.string()).optional(),
        optionalDependencies: z.record(z.string(), z.string()).optional()
      })
      .parse(json(path))
    for (const name of Object.keys(dependencyPackage.dependencies ?? {})) {
      if (Object.hasOwn(dependencyPackage.optionalDependencies ?? {}, name)) continue
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
        throw new Error('Invalid dependency name.')
      let directory = dirname(path)
      let found = false
      while (true) {
        const candidate =
          directory === '.'
            ? `node_modules/${name}/package.json`
            : `${directory}/node_modules/${name}/package.json`
        if (files.has(candidate)) {
          found = true
          break
        }
        if (directory === '.') break
        directory = dirname(directory)
      }
      if (!found) throw new Error(`Unbundled runtime dependency ${name} from ${path}.`)
    }
  }
  return manifest
}

export function verifyArchive(bytes: Buffer, version: string, integrity: string) {
  verifyIntegrity(bytes, integrity)
  const files = readArchive(bytes)
  return { files, manifest: verifyPackage(files, version) }
}

/** Revalidate cached bytes, never trust a marker left by an earlier installer. */
export function readInstalledPackage(directory: string) {
  directory = resolve(directory)
  if (realpathSync(directory) !== directory)
    throw new Error('Runtime package path must be canonical.')
  const files = new Map<string, Buffer>()
  let size = 0
  function walk(path: string) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new Error('Runtime packages cannot contain links or special files.')
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) walk(join(path, name))
    } else {
      size += stat.size
      if (size > 256 * 1024 * 1024 || files.size >= 20_000)
        throw new Error('Runtime package exceeds its limits.')
      files.set(relative(directory, path).split('\\').join('/'), readFileSync(path))
    }
  }
  walk(directory)
  return files
}
