import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

import type { Artifact } from '../runtime-prototype/state'

import { ensurePrivateDirectory, ensurePrivateDirectoryAsync } from '../runtime-platform'
import { IntegritySchema, MANIFEST_PATH } from './manifest'
import { readInstalledPackage, sha256, verifyArchive, verifyPackage } from './package'

export function privateDirectory(path: string) {
  ensurePrivateDirectory(path)
}

export function cacheDirectory(cache: string, integrity: string) {
  IntegritySchema.parse(integrity)
  return join(cache, sha256(integrity))
}

function retainedDirectory(path: string, retained: (Artifact | undefined)[]) {
  return retained.some(
    (artifact) =>
      artifact?.release &&
      (artifact.release.directory === path || artifact.release.directory.startsWith(path + sep))
  )
}

/** Download caches are replaceable; the running, control and rollback closures are not. */
export function discardUnusedCache(
  cache: string,
  integrity: string,
  retained: (Artifact | undefined)[]
) {
  privateDirectory(cache)
  const directory = cacheDirectory(cache, integrity)
  if (retainedDirectory(directory, retained))
    throw new Error('A retained runtime cache is damaged; automatic replacement was refused.')
  try {
    lstatSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  privateDirectory(directory)
  rmSync(directory, { recursive: true })
  return true
}

/** Called by the sole owner after an acquisition worker has exited. */
export async function pruneCache(
  cache: string,
  retained: (Artifact | undefined)[],
  signal?: AbortSignal
) {
  await ensurePrivateDirectoryAsync(cache)
  signal?.throwIfAborted()
  for (const entry of readdirSync(cache, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(cache, entry.name)
    if (/^(?:bundled-)?[a-f0-9]{64}$/.test(entry.name)) {
      if (retainedDirectory(path, retained)) continue
      rmSync(path, { recursive: true, force: true })
    } else if (
      /^\.(?:install|bundled)-/.test(entry.name) &&
      Date.now() - lstatSync(path).mtimeMs > 24 * 60 * 60 * 1000
    ) {
      rmSync(path, { recursive: true, force: true })
    }
  }
}

export function verifyCached(cache: string, version: string, integrity: string) {
  privateDirectory(cache)
  const directory = cacheDirectory(cache, integrity)
  lstatSync(directory)
  privateDirectory(directory)
  const archivePath = join(directory, 'archive.tgz')
  const stat = lstatSync(archivePath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
    throw new Error('Invalid cached archive.')
  const expected = verifyArchive(readFileSync(archivePath), version, integrity)
  const packageDir = join(directory, 'package')
  const installed = readInstalledPackage(packageDir)
  const manifest = verifyPackage(installed, version)
  if (!installed.get(MANIFEST_PATH)!.equals(expected.files.get(MANIFEST_PATH)!))
    throw new Error('Cached manifest differs from the verified release.')
  return { directory: packageDir, manifest }
}

/** Bound file-system concurrency while durably writing every verified payload file. */
export async function writePackageFiles(directory: string, files: ReadonlyMap<string, Buffer>) {
  const entries = [...files]
  let next = 0
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, async () => {
      while (next < entries.length) {
        const [path, data] = entries[next++]!
        const target = join(directory, path)
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, data, { flag: 'wx', mode: 0o600, flush: true })
      }
    })
  )
  for (const result of results) if (result.status === 'rejected') throw result.reason
}

export function publishDirectory(staging: string, destination: string) {
  renameSync(staging, destination)
  // Windows cannot open directories for fsync; payload files were flushed above,
  // and every startup revalidates the complete published closure.
  if (process.platform === 'win32') return
  const fd = openSync(dirname(destination), 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export async function installArchive(
  cache: string,
  version: string,
  integrity: string,
  bytes: Buffer
) {
  const { files } = verifyArchive(bytes, version, integrity)
  privateDirectory(cache)
  const destination = cacheDirectory(cache, integrity)
  try {
    lstatSync(destination)
    return verifyCached(cache, version, integrity)
  } catch (error) {
    // A corrupt existing cache is evidence, never silently replaced or executed.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const staging = mkdtempSync(join(cache, '.install-'))
  try {
    writeFileSync(join(staging, 'archive.tgz'), bytes, { flag: 'wx', mode: 0o600, flush: true })
    await writePackageFiles(join(staging, 'package'), files)
    // Publish only a complete closure. A crash before rename leaves an unused
    // staging directory; a crash afterward is caught by full revalidation.
    publishDirectory(staging, destination)
    return verifyCached(cache, version, integrity)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
