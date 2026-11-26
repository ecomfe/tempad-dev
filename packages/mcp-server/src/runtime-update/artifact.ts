import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

import type { Artifact } from '../runtime-prototype/state'

import { startupPhase } from '../startup-log'
import { MAX_FILE_BYTES } from './archive'
import { privateDirectory, publishDirectory, writePackageFiles } from './cache'
import { assertRunnable, MANIFEST_PATH, ManifestSchema } from './manifest'
import { readInstalledPackage, sha256, verifyPackage } from './package'

function fingerprintModules(names: string[], bytes: (name: string) => Buffer): string {
  return startupPhase('fingerprint-bundle', () => {
    const hash = createHash('sha256')
    for (const name of names.sort()) hash.update(name).update('\0').update(bytes(name))
    return hash.digest('hex')
  })
}

export function fingerprintBundle(entry: string): string {
  const directory = dirname(entry)
  const modules = readdirSync(directory).filter((name) => name.endsWith('.mjs'))
  return fingerprintModules(modules, (name) => readFileSync(join(directory, name)))
}

export function releaseManifest(artifact: Artifact) {
  if (!artifact.release) throw new Error('The runtime has no verified release payload.')
  const bytes = readFileSync(join(artifact.release.directory, MANIFEST_PATH))
  if (bytes.length > 4 * 1024 * 1024 || sha256(bytes) !== artifact.release.manifestHash)
    throw new Error('Runtime manifest changed.')
  const manifest = ManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (
    manifest.packageVersion !== artifact.version ||
    artifact.entry !== join(artifact.release.directory, manifest.entry)
  )
    throw new Error('Runtime release identity changed.')
  return manifest
}

function verifiedRelease(artifact: Omit<Artifact, 'bundle'>) {
  return startupPhase('verify-retained-package', () => {
    if (!artifact.release) throw new Error('The runtime has no verified release payload.')
    const { directory, manifestHash } = artifact.release
    const files = readInstalledPackage(directory)
    if (sha256(files.get(MANIFEST_PATH) ?? '') !== manifestHash)
      throw new Error('Runtime manifest changed.')
    const manifest = verifyPackage(files, artifact.version)
    assertRunnable(manifest)
    if (artifact.entry !== join(directory, manifest.entry))
      throw new Error('Runtime entry differs from its manifest.')
    // Match the loose bundle's top-level module names and bytes, already read and verified here.
    const modules = [...files.keys()]
      .filter((path) => posix.dirname(path) === 'dist' && path.endsWith('.mjs'))
      .map((path) => posix.basename(path))
    const bundle = fingerprintModules(modules, (name) => files.get(`dist/${name}`)!)
    return { manifest, bundle }
  })
}

export function verifyReleaseArtifact(artifact: Artifact) {
  const { manifest, bundle } = verifiedRelease(artifact)
  if (bundle !== artifact.bundle) throw new Error('Verified runtime bundle changed before launch.')
  return manifest
}

/** The installed bootstrap is already trusted. Copy only its inventoried closure
 * so npm cache cleanup and subsequent npm installs cannot change the running owner. */
export async function retainBundledPackage(source: string, cache: string) {
  source = realpathSync(source)
  const manifestBytes = readFileSync(join(source, MANIFEST_PATH))
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  const manifestHash = sha256(manifestBytes)
  const files = startupPhase('read-bundled-package', () => {
    const files = new Map([[MANIFEST_PATH, manifestBytes]])
    for (const path of Object.keys(manifest.files)) {
      const fullPath = join(source, path)
      const stat = lstatSync(fullPath)
      if (!stat.isFile() || realpathSync(fullPath) !== fullPath || stat.size > MAX_FILE_BYTES)
        throw new Error(`Invalid bundled runtime file: ${path}`)
      files.set(path, readFileSync(fullPath))
    }
    return files
  })
  startupPhase('verify-bundled-package', () => {
    verifyPackage(files, manifest.packageVersion)
    assertRunnable(manifest)
  })
  privateDirectory(cache)
  const directory = join(cache, `bundled-${manifestHash}`)
  let exists = false
  try {
    lstatSync(directory)
    exists = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!exists) {
    const staging = mkdtempSync(join(cache, '.bundled-'))
    try {
      await startupPhase('write-runtime-cache', () => writePackageFiles(staging, files))
      startupPhase('publish-runtime-cache', () => publishDirectory(staging, directory))
    } finally {
      rmSync(staging, { force: true, recursive: true })
    }
  }
  const artifact = {
    entry: join(directory, manifest.entry),
    version: manifest.packageVersion,
    release: { directory, manifestHash }
  }
  return { ...artifact, bundle: verifiedRelease(artifact).bundle }
}
