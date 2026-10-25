import { z } from 'zod'

import { MAX_ARCHIVE_BYTES } from './archive'
import { IntegritySchema, PACKAGE_NAME, VersionSchema } from './manifest'

const REGISTRY = 'https://registry.npmjs.org'
const MetadataSchema = z.object({
  name: z.literal(PACKAGE_NAME),
  version: VersionSchema,
  dist: z.object({ integrity: IntegritySchema, tarball: z.string() })
})
export type Release = { version: string; integrity: string; url: string }

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
  const metadata = MetadataSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  )
  const url = `${REGISTRY}/@tempad-dev/mcp/-/mcp-${metadata.version}.tgz`
  if (metadata.dist.tarball !== url || (selector !== 'latest' && selector !== metadata.version))
    throw new Error('Registry metadata does not identify the requested official release.')
  return { version: metadata.version, integrity: metadata.dist.integrity, url }
}

export function downloadRelease(release: Release, fetcher: typeof fetch = fetch) {
  VersionSchema.parse(release.version)
  IntegritySchema.parse(release.integrity)
  if (release.url !== `${REGISTRY}/@tempad-dev/mcp/-/mcp-${release.version}.tgz`)
    throw new Error('Runtime download must use the official npm artifact URL.')
  return bytes(release.url, MAX_ARCHIVE_BYTES, 120_000, fetcher)
}
