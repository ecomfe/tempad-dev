import { z } from 'zod'

import { MAX_ARCHIVE_BYTES } from './archive'
import { compareVersions, IntegritySchema, PACKAGE_NAME, VersionSchema } from './manifest'
import { sha256 } from './package'

const REGISTRY = 'https://registry.npmjs.org'
const MetadataSchema = z.object({
  name: z.literal(PACKAGE_NAME),
  version: VersionSchema,
  deprecated: z.string().optional(),
  dist: z.object({ integrity: IntegritySchema, tarball: z.string() })
})
export type Release = { version: string; integrity: string; url: string; deprecated?: string }

function releaseMetadata(value: unknown, version?: string): Release {
  const metadata = MetadataSchema.parse(value)
  const url = `${REGISTRY}/@tempad-dev/mcp/-/mcp-${metadata.version}.tgz`
  if (metadata.dist.tarball !== url || (version && version !== metadata.version))
    throw new Error('Registry metadata does not identify the requested official release.')
  return {
    version: metadata.version,
    integrity: metadata.dist.integrity,
    url,
    ...(metadata.deprecated ? { deprecated: metadata.deprecated } : {})
  }
}

async function bytes(url: string, limit: number, timeout: number, fetcher: typeof fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { accept: 'application/json, application/octet-stream' }
    })
    if (!response.ok || !response.body)
      throw new Error(`Runtime registry returned HTTP ${response.status}.`)
    reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new Error('Runtime registry response exceeds its byte limit.')
      chunks.push(Buffer.from(next.value))
    }
    return Buffer.concat(chunks)
  } finally {
    clearTimeout(timer)
    await reader?.cancel().catch(() => {})
    controller.abort()
  }
}

export async function resolveRelease(
  selector: string,
  fetcher: typeof fetch = fetch
): Promise<Release> {
  if (selector !== 'latest') VersionSchema.parse(selector)
  const body = await bytes(
    `${REGISTRY}/@tempad-dev%2fmcp/${selector}`,
    2 * 1024 * 1024,
    10_000,
    fetcher
  )
  return releaseMetadata(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)),
    selector === 'latest' ? undefined : selector
  )
}

/** The stable tag is an upper bound, including when its publisher rolls it back. */
export async function releaseCatalog(current: string, fetcher: typeof fetch = fetch) {
  VersionSchema.parse(current)
  const body = await bytes(`${REGISTRY}/@tempad-dev%2fmcp`, 8 * 1024 * 1024, 10_000, fetcher)
  const catalog = z
    .object({
      name: z.literal(PACKAGE_NAME),
      'dist-tags': z.object({ latest: VersionSchema }),
      versions: z.record(z.string(), z.unknown())
    })
    .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)))
  const latest = catalog['dist-tags'].latest
  releaseMetadata(catalog.versions[latest], latest)
  const releases = Object.keys(catalog.versions)
    .filter(
      (version) =>
        VersionSchema.safeParse(version).success &&
        compareVersions(version, current) > 0 &&
        compareVersions(version, latest) <= 0
    )
    .sort((a, b) => compareVersions(b, a))
    .map((version) => releaseMetadata(catalog.versions[version], version))
  return { latest, releases, fingerprint: sha256(JSON.stringify({ latest, releases })) }
}

export function downloadRelease(release: Release, fetcher: typeof fetch = fetch) {
  VersionSchema.parse(release.version)
  IntegritySchema.parse(release.integrity)
  if (release.url !== `${REGISTRY}/@tempad-dev/mcp/-/mcp-${release.version}.tgz`)
    throw new Error('Runtime download must use the official npm artifact URL.')
  return bytes(release.url, MAX_ARCHIVE_BYTES, 120_000, fetcher)
}
