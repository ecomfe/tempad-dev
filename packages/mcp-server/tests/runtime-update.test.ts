import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

import { readArchive, verifyIntegrity } from '../src/runtime-update/archive'
import { retainBundledPackage, verifyReleaseArtifact } from '../src/runtime-update/artifact'
import {
  cacheDirectory,
  installArchive,
  pruneCache,
  verifyCached
} from '../src/runtime-update/cache'
import {
  automaticCompatibilityReasons,
  compatibilityReasons,
  supportsNode,
  validatePolicyBaseline,
  type RuntimeManifest
} from '../src/runtime-update/manifest'
import { sha256, verifyPackage } from '../src/runtime-update/package'
import { downloadRelease, releaseCatalog, resolveRelease } from '../src/runtime-update/registry'

function tar(entries: { path: string; data?: string; type?: string }[]) {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    const data = Buffer.from(entry.data ?? '')
    header.write(entry.path)
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('        ', 148)
    header.write(entry.type ?? '0', 156)
    const checksum = header.reduce((sum, value) => sum + value, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
const integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const baselineIntegrity = integrity(Buffer.from('baseline'))
function fixture() {
  const files = new Map(
    Object.entries({
      'package.json': JSON.stringify({
        name: '@tempad-dev/mcp',
        version: '0.12.0',
        bin: 'dist/cli.mjs',
        engines: { node: '^22 || ^24 || >=26' },
        dependencies: { test: '1.0.0' },
        bundleDependencies: ['test']
      }),
      'dist/cli.mjs': '',
      'dist/managed-runtime.mjs': '',
      'dist/log-transport.mjs': '',
      'node_modules/test/package.json': JSON.stringify({ name: 'test', version: '1.0.0' })
    }).map(([key, value]) => [key, Buffer.from(value)])
  )
  const manifest: RuntimeManifest = {
    version: 1,
    name: '@tempad-dev/mcp',
    packageVersion: '0.12.0',
    entry: 'dist/managed-runtime.mjs',
    node: '^22 || ^24 || >=26',
    platforms: ['darwin', 'linux'],
    guidanceEpoch: 1,
    guidanceReview: {
      version: '0.12.0',
      sourceHash: 'a'.repeat(64),
      decision: 'initial',
      baseline: { version: '0.11.0', integrity: baselineIntegrity },
      rationale: 'First release with reviewed runtime guidance.'
    },
    wireHash: 'b'.repeat(64),
    presentationHash: 'c'.repeat(64),
    lockHash: 'd'.repeat(64),
    controlProtocols: [1],
    state: { family: 'tempad', reads: [1], writes: 1 },
    extension: { protocols: [1], legacy: true },
    hookProtocol: 2,
    files: Object.fromEntries([...files].map(([key, value]) => [key, sha256(value)]))
  }
  files.set('dist/runtime-manifest.json', Buffer.from(JSON.stringify(manifest)))
  return { files, manifest }
}

describe('release archives', () => {
  it('checks integrity before accepting regular package files', () => {
    const bytes = tar([{ path: 'package/dist/cli.mjs', data: 'ok' }])
    verifyIntegrity(bytes, integrity(bytes))
    expect(readArchive(bytes).get('dist/cli.mjs')?.toString()).toBe('ok')
    expect(() => verifyIntegrity(bytes, baselineIntegrity)).toThrow('integrity')
    expect(() => readArchive(bytes.subarray(0, bytes.length - 6))).toThrow()
  })
  it.each(['../escape', 'a/../../escape', '/absolute', 'a\\b', 'C:/outside', 'a//b', 'a/./b'])(
    'rejects path %s',
    (path) => {
      expect(() => readArchive(tar([{ path: `package/${path}`, data: 'x' }]))).toThrow()
    }
  )
  it.each(['1', '2', '3', '4', '6', 'g'])('rejects non-file tar type %s', (type) => {
    expect(() => readArchive(tar([{ path: 'package/link', type }]))).toThrow()
  })
  it('rejects duplicates and file ancestors', () => {
    expect(() => readArchive(tar([{ path: 'package/a' }, { path: 'package/a' }]))).toThrow()
    expect(() => readArchive(tar([{ path: 'package/a/b' }, { path: 'package/a' }]))).toThrow()
  })
  it('checks checksums and empty packages', () => {
    expect(() => readArchive(tar([]))).toThrow()
    const bytes = Buffer.alloc(1024, 1)
    expect(() => readArchive(gzipSync(bytes))).toThrow()
  })
})

describe('release manifest and dependency closure', () => {
  it.each([
    ['0.12.0', '0.12.9', false],
    ['0.12.0', '0.13.0', true],
    ['0.12.0', '1.0.0', true],
    ['1.0.0', '1.8.0', false],
    ['1.8.0', '2.0.0', true]
  ])('checks automatic release boundaries %s → %s', (active, next, blocked) => {
    const { manifest } = fixture()
    const before = { ...manifest, packageVersion: active }
    const after = { ...manifest, packageVersion: next }
    expect(compatibilityReasons(before, after)).toEqual([])
    expect(automaticCompatibilityReasons(before, after)).toEqual(
      blocked ? ['Breaking release boundary; explicit update required'] : []
    )
    expect(automaticCompatibilityReasons(before, { ...after, guidanceEpoch: 2 })).toContain(
      'Guidance epoch changed; restart MCP'
    )
  })
  it('accepts the exact inventoried package', () => {
    const { files, manifest } = fixture()
    expect(verifyPackage(files, '0.12.0')).toEqual(manifest)
    validatePolicyBaseline(manifest)
  })
  it('rejects modified, missing, extra and misidentified files', () => {
    const { files } = fixture()
    expect(() => verifyPackage(files, '0.12.1')).toThrow('identity')
    files.set('dist/cli.mjs', Buffer.from('modified'))
    expect(() => verifyPackage(files, '0.12.0')).toThrow('hash')
    files.delete('dist/cli.mjs')
    expect(() => verifyPackage(files, '0.12.0')).toThrow('inventory')
  })
  it('rejects incomplete bundled transitive dependencies', () => {
    const { files, manifest } = fixture()
    const path = 'node_modules/test/package.json'
    files.set(path, Buffer.from(JSON.stringify({ dependencies: { absent: '1.0.0' } })))
    manifest.files[path] = sha256(files.get(path)!)
    files.set('dist/runtime-manifest.json', Buffer.from(JSON.stringify(manifest)))
    expect(() => verifyPackage(files, '0.12.0')).toThrow('Unbundled runtime dependency absent')
  })
  it('allows a presentation correction but blocks reverted text across epochs', () => {
    const { manifest: first } = fixture()
    const third = {
      ...first,
      packageVersion: '0.12.2',
      presentationHash: first.presentationHash,
      guidanceEpoch: 2
    }
    expect(compatibilityReasons(first, { ...first, presentationHash: 'e'.repeat(64) })).toEqual([])
    expect(compatibilityReasons(first, third)).toContain('Guidance epoch changed; restart MCP')
  })
  it('requires state rollback, control, extension and wire compatibility', () => {
    const { manifest } = fixture()
    expect(
      compatibilityReasons(manifest, {
        ...manifest,
        wireHash: 'e'.repeat(64),
        controlProtocols: [2],
        state: { ...manifest.state, reads: [2] },
        extension: { protocols: [2], legacy: false }
      })
    ).toHaveLength(4)
  })
  it('requires fresh monotonic guidance decisions', () => {
    const { manifest: prior } = fixture()
    const next = {
      ...prior,
      packageVersion: '0.12.1',
      guidanceReview: {
        ...prior.guidanceReview,
        version: '0.12.1',
        decision: 'compatible' as const,
        baseline: { version: prior.packageVersion, integrity: baselineIntegrity }
      }
    }
    validatePolicyBaseline(next, prior)
    expect(() => validatePolicyBaseline(next)).toThrow('Missing historical')
    expect(() => validatePolicyBaseline({ ...next, guidanceEpoch: 2 }, prior)).toThrow('disagree')
    expect(() => validatePolicyBaseline({ ...next, guidanceEpoch: 0 }, prior)).toThrow('decrease')
  })
  it('only interprets explicitly supported Node engine policies', () => {
    expect(supportsNode('^22 || ^24 || >=26', '24.1.0')).toBe(true)
    expect(supportsNode('^22 || ^24 || >=26', '23.1.0')).toBe(false)
    expect(() => supportsNode('>=22.0.0')).toThrow('Unsupported')
  })
})

describe('private release cache', () => {
  it('retains an immutable bootstrap closure independently of npm cache cleanup', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-cache-')))
    try {
      const source = join(root, 'source')
      const { files } = fixture()
      for (const [path, bytes] of files) {
        const target = join(source, path)
        mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true, mode: 0o700 })
        writeFileSync(target, bytes)
      }
      const cache = join(root, 'cache')
      const artifact = await retainBundledPackage(source, cache)
      expect(await retainBundledPackage(source, cache)).toEqual(artifact)
      rmSync(source, { recursive: true })
      expect(verifyReleaseArtifact(artifact).packageVersion).toBe('0.12.0')
      const unused = join(cache, 'b'.repeat(64))
      mkdirSync(unused)
      symlinkSync(root, join(cache, 'c'.repeat(64)))
      pruneCache(cache, [artifact])
      expect(existsSync(unused)).toBe(false)
      expect(existsSync(artifact.entry)).toBe(true)
      expect(existsSync(join(cache, 'c'.repeat(64)))).toBe(true)
      writeFileSync(artifact.entry, 'modified')
      expect(() => verifyReleaseArtifact(artifact)).toThrow('hash mismatch')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('publishes a complete package and rechecks corrupted cache bytes', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-cache-')))
    try {
      const { files } = fixture()
      const archive = tar(
        [...files].map(([path, data]) => ({ path: `package/${path}`, data: data.toString() }))
      )
      const sri = integrity(archive)
      const installed = await installArchive(root, '0.12.0', sri, archive)
      expect(
        readFileSync(join(installed.directory, 'node_modules/test/package.json'), 'utf8')
      ).toContain('1.0.0')
      expect(await installArchive(root, '0.12.0', sri, archive)).toEqual(installed)
      writeFileSync(join(installed.directory, 'dist/cli.mjs'), 'tampered')
      expect(() => verifyCached(root, '0.12.0', sri)).toThrow('hash mismatch')
      await expect(installArchive(root, '0.12.0', sri, archive)).rejects.toThrow('hash mismatch')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('never follows a cached package symlink', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-cache-')))
    try {
      symlinkSync(root, cacheDirectory(root, baselineIntegrity))
      expect(() => verifyCached(root, '0.12.0', baselineIntegrity)).toThrow('canonical private')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('official release acquisition', () => {
  const metadata = {
    name: '@tempad-dev/mcp',
    version: '0.12.0',
    dist: {
      integrity: baselineIntegrity,
      tarball: 'https://registry.npmjs.org/@tempad-dev/mcp/-/mcp-0.12.0.tgz'
    }
  }
  it('orders stable history below the current latest tag and fingerprints deprecation', async () => {
    const version = (value: string, extra = {}) => ({
      ...metadata,
      version: value,
      dist: {
        ...metadata.dist,
        tarball: `https://registry.npmjs.org/@tempad-dev/mcp/-/mcp-${value}.tgz`
      },
      ...extra
    })
    const payload = {
      name: metadata.name,
      'dist-tags': { latest: '0.12.3' },
      versions: {
        '0.12.0': metadata,
        '0.12.1': version('0.12.1'),
        '0.12.2': version('0.12.2', { deprecated: 'Withdrawn' }),
        '0.12.3': version('0.12.3'),
        '0.12.4': { untrusted: 'above stable ceiling' },
        '0.13.0-alpha': { untrusted: 'prerelease' }
      }
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    const first = await releaseCatalog('0.12.0', fetcher)
    expect(first.releases.map((release) => release.version)).toEqual(['0.12.3', '0.12.2', '0.12.1'])
    expect(first.releases[1]?.deprecated).toBe('Withdrawn')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/@tempad-dev%2fmcp')
    payload.versions['0.12.2'] = version('0.12.2')
    fetcher.mockResolvedValue(Response.json(payload))
    expect((await releaseCatalog('0.12.0', fetcher)).fingerprint).not.toBe(first.fingerprint)
    payload['dist-tags'].latest = '0.12.0'
    fetcher.mockResolvedValue(Response.json(payload))
    expect((await releaseCatalog('0.12.2', fetcher)).releases).toEqual([])
  })
  it('rejects oversized, mismatched, or missing stable history metadata', async () => {
    const payload = {
      name: metadata.name,
      'dist-tags': { latest: '0.12.1' },
      versions: { '0.12.1': metadata }
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    await expect(releaseCatalog('0.12.0', fetcher)).rejects.toThrow('requested official release')
    fetcher.mockResolvedValueOnce(Response.json({ ...payload, versions: {} }))
    await expect(releaseCatalog('0.12.0', fetcher)).rejects.toThrow()
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(8 * 1024 * 1024 + 1)))
    await expect(releaseCatalog('0.12.0', fetcher)).rejects.toThrow('byte limit')
  })
  it('pins exact metadata and refuses redirects or alternate tarball hosts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata))
    expect(await resolveRelease('latest', fetcher)).toEqual({
      version: '0.12.0',
      integrity: baselineIntegrity,
      url: metadata.dist.tarball
    })
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error', credentials: 'omit' })
    fetcher.mockResolvedValueOnce(
      Response.json({ ...metadata, dist: { ...metadata.dist, tarball: 'https://evil.test/a.tgz' } })
    )
    await expect(resolveRelease('0.12.0', fetcher)).rejects.toThrow('official release')
    expect(() =>
      downloadRelease(
        { version: '0.12.0', integrity: baselineIntegrity, url: 'http://localhost/a' },
        fetcher
      )
    ).toThrow('official npm')
  })
  it('rejects prereleases, wrong versions, errors and oversized metadata', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(resolveRelease('0.12.0-alpha', fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(Response.json(metadata))
    await expect(resolveRelease('0.12.1', fetcher)).rejects.toThrow('requested')
    fetcher.mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(resolveRelease('latest', fetcher)).rejects.toThrow('HTTP 503')
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    await expect(resolveRelease('latest', fetcher)).rejects.toThrow('byte limit')
  })
})
