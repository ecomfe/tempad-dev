import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Artifact } from '../runtime-prototype/state'

import { privateDirectory, publishDirectory, writePackageFiles } from './cache'
import { MANIFEST_PATH, ManifestSchema } from './manifest'
import { readInstalledPackage, sha256, verifyPackage } from './package'

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

export function verifyReleaseArtifact(artifact: Artifact) {
  if (!artifact.release) throw new Error('The runtime has no verified release payload.')
  const { directory, manifestHash } = artifact.release
  const files = readInstalledPackage(directory)
  if (sha256(files.get(MANIFEST_PATH) ?? '') !== manifestHash)
    throw new Error('Runtime manifest changed.')
  const manifest = verifyPackage(files, artifact.version)
  if (artifact.entry !== join(directory, manifest.entry))
    throw new Error('Runtime entry differs from its manifest.')
  return manifest
}

/** The installed bootstrap is already trusted. Copy only its inventoried closure
 * so npm cache cleanup and subsequent npm installs cannot change the running owner. */
export async function retainBundledPackage(source: string, cache: string) {
  source = realpathSync(source)
  const manifestBytes = readFileSync(join(source, MANIFEST_PATH))
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  const manifestHash = sha256(manifestBytes)
  const files = new Map([[MANIFEST_PATH, manifestBytes]])
  for (const path of Object.keys(manifest.files)) {
    const fullPath = join(source, path)
    const stat = lstatSync(fullPath)
    if (!stat.isFile() || realpathSync(fullPath) !== fullPath || stat.size > 16 * 1024 * 1024)
      throw new Error(`Invalid bundled runtime file: ${path}`)
    files.set(path, readFileSync(fullPath))
  }
  verifyPackage(files, manifest.packageVersion)
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
      await writePackageFiles(staging, files)
      publishDirectory(staging, directory)
    } finally {
      rmSync(staging, { force: true, recursive: true })
    }
  }
  const artifact = {
    entry: join(directory, manifest.entry),
    version: manifest.packageVersion,
    bundle: '',
    release: { directory, manifestHash }
  }
  verifyReleaseArtifact(artifact)
  return artifact
}
