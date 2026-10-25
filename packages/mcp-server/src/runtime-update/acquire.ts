import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { probeArtifact } from '../runtime-prototype/probe'
import { fingerprintBundle } from '../runtime-prototype/processes'
import { ArtifactSchema } from '../runtime-prototype/state'
import { readArchive, verifyIntegrity } from './archive'
import { releaseManifest } from './artifact'
import { installArchive, verifyCached } from './cache'
import {
  automaticCompatibilityReasons,
  compareVersions,
  compatibilityReasons,
  crossesBreakingBoundary,
  MANIFEST_PATH,
  ManifestSchema,
  PACKAGE_NAME,
  VersionSchema,
  type RuntimeManifest
} from './manifest'
import { sha256 } from './package'
import { downloadRelease, releaseCatalog, resolveRelease, type Release } from './registry'

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const ReasonsSchema = z.array(z.string().max(2000)).max(32)
export const AcquisitionContextSchema = z
  .object({
    active: ArtifactSchema,
    control: ArtifactSchema,
    excludedBundles: z.array(HashSchema).optional()
  })
  .strict()
export type AcquisitionContext = z.infer<typeof AcquisitionContextSchema>
export const SelectionCursorSchema = z
  .object({
    fingerprint: HashSchema,
    before: VersionSchema,
    latestReasons: ReasonsSchema
  })
  .strict()
export type SelectionCursor = z.infer<typeof SelectionCursorSchema>
export const SelectionSchema = z
  .object({
    latest: VersionSchema,
    latestReasons: ReasonsSchema,
    inspected: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    cursor: SelectionCursorSchema.optional()
  })
  .strict()
export const AcquisitionResultSchema = z
  .object({
    candidate: ArtifactSchema.optional(),
    selection: SelectionSchema.optional()
  })
  .strict()
export type AcquisitionResult = z.infer<typeof AcquisitionResultSchema>
const SEARCH_BATCH_SIZE = 16

/** Acquisition validates bytes and behavior; it never changes the active runtime. */
export async function stageRelease(
  cache: string,
  selector: string,
  context: AcquisitionContext,
  cursor?: SelectionCursor
): Promise<AcquisitionResult> {
  if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
    throw new Error('Checkout runtimes cannot acquire releases.')
  const active = releaseManifest(context.active)
  const control = releaseManifest(context.control)
  const excluded = new Set(context.excludedBundles)
  let downloaded = false
  let inspected = 0
  const reasonsFor = (manifest: RuntimeManifest) => [
    ...new Set([
      ...automaticCompatibilityReasons(active, manifest),
      ...compatibilityReasons(control, manifest)
    ])
  ]

  async function inspectRelease(release: Release, selectCompatible: boolean) {
    let installed
    try {
      installed = verifyCached(cache, release.version, release.integrity)
    } catch (error) {
      // Corrupt cache evidence is never replaced or hidden by selecting an older release.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!installed) {
      // Commit completed cached inspections before starting a network archive;
      // the next worker gets the entire download/probe budget for this version.
      if (selectCompatible && inspected > 0) return { deferred: true, reasons: [] }
      downloaded = true
      const bytes = await downloadRelease(release)
      if (selectCompatible) {
        verifyIntegrity(bytes, release.integrity)
        const files = readArchive(bytes)
        const declared = files.get(MANIFEST_PATH)
        if (!declared) return { reasons: ['Release has no managed runtime manifest'] }
        if (declared.length > 4 * 1024 * 1024) throw new Error('Oversized runtime manifest.')
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(declared)
        )
        const identity = z
          .object({
            version: z.number().int().positive(),
            name: z.literal(PACKAGE_NAME),
            packageVersion: VersionSchema
          })
          .parse(value)
        if (identity.packageVersion !== release.version)
          throw new Error('Runtime package identity disagrees with registry metadata.')
        if (identity.version !== 1)
          return { reasons: ['Release uses an unsupported runtime manifest version'] }
        const manifest = ManifestSchema.parse(value)
        const reasons = reasonsFor(manifest)
        // No package code executes and incompatible archives never enter the cache.
        if (reasons.length) return { reasons }
      }
      installed = await installArchive(cache, release.version, release.integrity, bytes)
    }
    if (selectCompatible) {
      const reasons = reasonsFor(installed.manifest)
      if (reasons.length) return { reasons }
      if (excluded.has(fingerprintBundle(join(installed.directory, installed.manifest.entry))))
        return { reasons: ['Candidate was quarantined after a failed activation'] }
    }
    const probe = await probeArtifact(join(installed.directory, installed.manifest.entry))
    if (
      probe.artifact.version !== installed.manifest.packageVersion ||
      probe.wireHash !== installed.manifest.wireHash ||
      probe.presentationHash !== installed.manifest.presentationHash
    )
      throw new Error('The isolated runtime does not match its declared contract.')
    return {
      candidate: {
        ...probe.artifact,
        release: {
          directory: installed.directory,
          integrity: release.integrity,
          manifestHash: sha256(readFileSync(join(installed.directory, MANIFEST_PATH)))
        }
      },
      reasons: []
    }
  }

  if (selector !== 'latest') {
    const release = await resolveRelease(selector)
    if (compareVersions(release.version, active.packageVersion) <= 0) return {}
    const { candidate } = await inspectRelease(release, false)
    return { candidate }
  }

  const catalog = await releaseCatalog(active.packageVersion)
  const fingerprint = sha256(
    JSON.stringify({
      catalog: catalog.fingerprint,
      active: context.active.release!.manifestHash,
      control: context.control.release!.manifestHash,
      excluded: [...excluded].sort()
    })
  )
  const continuing = cursor?.fingerprint === fingerprint ? cursor : undefined
  let latestReasons = continuing?.latestReasons ?? []
  if (crossesBreakingBoundary(active.packageVersion, catalog.latest))
    latestReasons = ['Breaking release boundary; explicit update required']
  const deprecatedLatest = catalog.releases.find(
    (release) => release.version === catalog.latest
  )?.deprecated
  if (deprecatedLatest)
    latestReasons = [`Release is deprecated: ${deprecatedLatest.slice(0, 1900)}`]
  const releases = catalog.releases.filter(
    (release) =>
      !release.deprecated &&
      !crossesBreakingBoundary(active.packageVersion, release.version) &&
      (!continuing || compareVersions(release.version, continuing.before) < 0)
  )
  let before: string | undefined
  const deadline = performance.now() + 30_000
  for (const release of releases.slice(0, SEARCH_BATCH_SIZE)) {
    const result = await inspectRelease(release, true)
    if (result.deferred) break
    inspected++
    before = release.version
    if (release.version === catalog.latest) latestReasons = result.reasons
    if (result.candidate)
      return {
        candidate: result.candidate,
        selection: { latest: catalog.latest, latestReasons, inspected, remaining: 0 }
      }
    // One network archive retains the existing 120-second download allowance
    // without losing an entire history batch to the worker's time bound.
    // Cached inspections also checkpoint between candidates after 30 seconds.
    if (downloaded || performance.now() >= deadline) break
  }
  const remaining = releases.length - inspected
  return {
    selection: {
      latest: catalog.latest,
      latestReasons,
      inspected,
      remaining,
      ...(remaining && before ? { cursor: { fingerprint, before, latestReasons } } : {})
    }
  }
}
