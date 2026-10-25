import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { IntegritySchema, MANIFEST_PATH } from './manifest'
import { readInstalledPackage, sha256, verifyArchive, verifyPackage } from './package'

export function privateDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error('Runtime cache path must be absolute.')
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (
    !stat.isDirectory() ||
    realpathSync(path) !== path ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error('Runtime cache must be a canonical private directory owned by this user.')
}

export function cacheDirectory(cache: string, integrity: string) {
  IntegritySchema.parse(integrity)
  return join(cache, sha256(integrity))
}

export function verifyCached(cache: string, version: string, integrity: string) {
  privateDirectory(cache)
  const directory = cacheDirectory(cache, integrity)
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

export function installArchive(cache: string, version: string, integrity: string, bytes: Buffer) {
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
    for (const [path, data] of files) {
      const target = join(staging, 'package', path)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeFileSync(target, data, { flag: 'wx', mode: 0o600, flush: true })
    }
    // Publish only a complete closure. A crash before rename leaves an unused
    // staging directory; a crash afterward is caught by full revalidation.
    renameSync(staging, destination)
    const fd = openSync(cache, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    return verifyCached(cache, version, integrity)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
