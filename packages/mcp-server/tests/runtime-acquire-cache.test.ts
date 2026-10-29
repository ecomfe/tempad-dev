import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Artifact } from '../src/runtime-prototype/state'
import type { RuntimeManifest } from '../src/runtime-update/manifest'

const fake = vi.hoisted(() => ({
  catalog: vi.fn(),
  resolve: vi.fn(),
  download: vi.fn(),
  probe: vi.fn()
}))
vi.mock('../src/runtime-update/registry', () => ({
  releaseCatalog: fake.catalog,
  resolveRelease: fake.resolve,
  downloadRelease: fake.download
}))
vi.mock('../src/runtime-prototype/probe', () => ({ probeArtifact: fake.probe }))

import { createPrivateTempDirectory } from '../src/runtime-platform'
import { fingerprintBundle } from '../src/runtime-prototype/processes'
import { stageRelease } from '../src/runtime-update/acquire'
import { verifyReleaseArtifact } from '../src/runtime-update/artifact'
import { installArchive, verifyCached } from '../src/runtime-update/cache'
import { sha256 } from '../src/runtime-update/package'

function archive(version: string, node: string) {
  const files = new Map([
    [
      'package.json',
      JSON.stringify({
        name: '@tempad-dev/mcp',
        version,
        bin: 'dist/cli.mjs',
        engines: { node },
        dependencies: {},
        bundleDependencies: []
      })
    ],
    ['dist/cli.mjs', ''],
    ['dist/log-transport.mjs', ''],
    ['dist/managed-runtime.mjs', `// ${version}`]
  ])
  const manifest: RuntimeManifest = {
    version: 1,
    name: '@tempad-dev/mcp',
    packageVersion: version,
    entry: 'dist/managed-runtime.mjs',
    node,
    platforms: ['darwin', 'linux', 'win32'],
    guidanceEpoch: 1,
    guidanceReview: {
      version,
      sourceHash: 'a'.repeat(64),
      decision: 'compatible',
      baseline: { version: '0.11.0', integrity: `sha512-${'a'.repeat(86)}==` },
      rationale: 'Compatible runtime for isolated cache selection tests.'
    },
    controlProtocols: [2],
    state: { family: 'tempad', reads: [1], writes: 1 },
    extension: { protocols: [1], legacy: true },
    hookProtocol: 2,
    wireHash: 'b'.repeat(64),
    presentationHash: 'c'.repeat(64),
    lockHash: 'd'.repeat(64),
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)]))
  }
  files.set('dist/runtime-manifest.json', JSON.stringify(manifest))
  const blocks: Buffer[] = []
  for (const [path, value] of files) {
    const data = Buffer.from(value)
    const header = Buffer.alloc(512)
    header.write(`package/${path}`)
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('        ', 148)
    header.write('0', 156)
    header.write(
      header
        .reduce((sum, value) => sum + value, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148
    )
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  const bytes = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
  return {
    bytes,
    version,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    url: `https://registry.npmjs.org/@tempad-dev/mcp/-/mcp-${version}.tgz`
  }
}

let root: string
const nodeVersion = Object.getOwnPropertyDescriptor(process.versions, 'node')!
const node = (version: string) =>
  Object.defineProperty(process.versions, 'node', { value: version, configurable: true })
const releases = [archive('0.12.0', '>=22'), archive('0.12.1', '>=22'), archive('0.12.2', '^24')]
function artifact(version: string): Artifact {
  const release = releases.find((release) => release.version === version)!
  const installed = verifyCached(root, version, release.integrity)
  const entry = join(installed.directory, installed.manifest.entry)
  return {
    version,
    entry,
    bundle: fingerprintBundle(entry),
    release: {
      directory: installed.directory,
      integrity: release.integrity,
      manifestHash: sha256(readFileSync(join(installed.directory, 'dist/runtime-manifest.json')))
    }
  }
}
beforeEach(async () => {
  vi.resetAllMocks()
  root = createPrivateTempDirectory('tp-cache-selection-')
  node('24.0.0')
  for (const release of releases)
    await installArchive(root, release.version, release.integrity, release.bytes)
  fake.catalog.mockResolvedValue({
    latest: '0.12.2',
    releases: releases.slice(1).reverse(),
    fingerprint: sha256('catalog')
  })
  fake.resolve.mockResolvedValue(releases[2])
  fake.download.mockImplementation(async (release) => release.bytes)
  fake.probe.mockImplementation(async (entry: string) => {
    const manifest: RuntimeManifest = JSON.parse(
      readFileSync(join(dirname(entry), 'runtime-manifest.json'), 'utf8')
    )
    return {
      artifact: artifact(manifest.packageVersion),
      wireHash: manifest.wireHash,
      presentationHash: manifest.presentationHash
    }
  })
})
afterEach(() => {
  Object.defineProperty(process.versions, 'node', nodeVersion)
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

it('selects a compatible verified cache after the launcher changes from Node 24 to 22', async () => {
  const current = artifact('0.12.0')
  node('22.0.0')
  expect(await stageRelease(root, 'latest', { active: current, control: current })).toMatchObject({
    candidate: { version: '0.12.1' },
    selection: { inspected: 2, latestReasons: ['Node restart/upgrade required'] }
  })
  expect(fake.probe).toHaveBeenCalledExactlyOnceWith(artifact('0.12.1').entry)
  expect(fake.download).not.toHaveBeenCalled()
})

it('still refuses to execute an incompatible cached runtime through an exact request or activation', async () => {
  const current = artifact('0.12.0')
  const next = artifact('0.12.2')
  node('22.0.0')
  await expect(stageRelease(root, '0.12.2', { active: current, control: current })).rejects.toThrow(
    /Node/
  )
  expect(() => verifyReleaseArtifact(next)).toThrow(/Node/)
  expect(fake.probe).not.toHaveBeenCalled()
})

it('discards an unused corrupt cache and continues compatible selection without executing it', async () => {
  const current = artifact('0.12.0')
  const next = artifact('0.12.2')
  writeFileSync(next.entry, 'tampered')
  node('22.0.0')
  const context = { active: current, control: current }
  const first = await stageRelease(root, 'latest', context)
  expect(first).toMatchObject({
    cacheWarning: expect.stringContaining('hash mismatch'),
    selection: { inspected: 1, remaining: 1 }
  })
  expect(existsSync(next.entry)).toBe(false)
  expect(fake.probe).not.toHaveBeenCalled()
  expect(fake.download).toHaveBeenCalledOnce()
  expect(await stageRelease(root, 'latest', context, first.selection?.cursor)).toMatchObject({
    candidate: { version: '0.12.1' }
  })
  expect(fake.probe).toHaveBeenCalledExactlyOnceWith(artifact('0.12.1').entry)
})

it('repairs an unused compatible cache before probing its installed bytes', async () => {
  const current = artifact('0.12.0')
  const next = artifact('0.12.1')
  writeFileSync(next.entry, 'tampered')
  fake.resolve.mockResolvedValue(releases[1])
  const result = await stageRelease(root, '0.12.1', { active: current, control: current })
  expect(result).toMatchObject({
    candidate: next,
    cacheWarning: expect.stringContaining('hash mismatch')
  })
  expect(readFileSync(next.entry, 'utf8')).toBe('// 0.12.1')
  expect(() => verifyReleaseArtifact(result.candidate!)).not.toThrow()
})

it.each(['control', 'previous'] as const)(
  'retains a damaged %s cache for explicit recovery',
  async (role) => {
    const current = artifact('0.12.0')
    const next = artifact('0.12.2')
    writeFileSync(next.entry, 'tampered')
    await expect(
      stageRelease(root, 'latest', { active: current, control: current, [role]: next })
    ).rejects.toThrow('retained runtime cache')
    expect(readFileSync(next.entry, 'utf8')).toBe('tampered')
    expect(fake.probe).not.toHaveBeenCalled()
    expect(fake.download).not.toHaveBeenCalled()
  }
)
