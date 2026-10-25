import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { probeArtifact } from '../runtime-prototype/probe'
import { installArchive, verifyCached } from './cache'
import { compareVersions, MANIFEST_PATH, VersionSchema } from './manifest'
import { sha256 } from './package'
import { downloadRelease, resolveRelease } from './registry'

/** Acquisition validates bytes and behavior; it never changes the active runtime. */
export async function stageRelease(cache: string, selector: string, current: string) {
  if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
    throw new Error('Checkout runtimes cannot acquire releases.')
  VersionSchema.parse(current)
  const release = await resolveRelease(selector)
  if (compareVersions(release.version, current) <= 0) return
  let installed
  try {
    installed = verifyCached(cache, release.version, release.integrity)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    installed = await installArchive(
      cache,
      release.version,
      release.integrity,
      await downloadRelease(release)
    )
  }
  const probe = await probeArtifact(join(installed.directory, installed.manifest.entry))
  if (
    probe.artifact.version !== installed.manifest.packageVersion ||
    probe.wireHash !== installed.manifest.wireHash ||
    probe.presentationHash !== installed.manifest.presentationHash
  )
    throw new Error('The isolated runtime does not match its declared contract.')
  return {
    ...probe.artifact,
    release: {
      directory: installed.directory,
      integrity: release.integrity,
      manifestHash: sha256(readFileSync(join(installed.directory, MANIFEST_PATH)))
    }
  }
}
