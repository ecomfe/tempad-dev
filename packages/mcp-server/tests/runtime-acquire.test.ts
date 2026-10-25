import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Artifact } from '../src/runtime-prototype/state'
import type { AcquisitionContext } from '../src/runtime-update/acquire'
import type { RuntimeManifest } from '../src/runtime-update/manifest'

const fake = vi.hoisted(() => ({
  resolve: vi.fn(),
  catalog: vi.fn(),
  download: vi.fn(),
  cached: vi.fn(),
  install: vi.fn(),
  probe: vi.fn(),
  manifest: vi.fn(),
  fingerprint: vi.fn(),
  integrity: vi.fn(),
  archive: vi.fn()
}))
vi.mock('../src/runtime-update/registry', () => ({
  resolveRelease: fake.resolve,
  releaseCatalog: fake.catalog,
  downloadRelease: fake.download
}))
vi.mock('../src/runtime-update/cache', () => ({
  verifyCached: fake.cached,
  installArchive: fake.install
}))
vi.mock('../src/runtime-update/archive', () => ({
  verifyIntegrity: fake.integrity,
  readArchive: fake.archive
}))
vi.mock('../src/runtime-update/artifact', () => ({ releaseManifest: fake.manifest }))
vi.mock('../src/runtime-prototype/probe', () => ({ probeArtifact: fake.probe }))
vi.mock('../src/runtime-prototype/processes', () => ({ fingerprintBundle: fake.fingerprint }))
import { stageRelease } from '../src/runtime-update/acquire'
import { sha256 } from '../src/runtime-update/package'

let root: string
let context: AcquisitionContext
const manifests = new Map<string, RuntimeManifest>()
function artifact(version: string): Artifact {
  return {
    version,
    entry: join(root, version, 'dist/managed-runtime.mjs'),
    bundle: sha256(version),
    release: { directory: join(root, version), manifestHash: sha256(version) }
  }
}
function manifest(version: string, overrides: Partial<RuntimeManifest> = {}) {
  const value: RuntimeManifest = {
    version: 1,
    name: '@tempad-dev/mcp',
    packageVersion: version,
    entry: 'dist/managed-runtime.mjs',
    node: '>=22',
    platforms: ['darwin', 'linux'],
    guidanceEpoch: 1,
    guidanceReview: {
      version,
      sourceHash: 'a'.repeat(64),
      decision: 'compatible',
      baseline: { version: '0.11.0', integrity: 'sha512-' + 'a'.repeat(86) + '==' },
      rationale: 'Compatible runtime for isolated selection tests.'
    },
    controlProtocols: [2],
    state: { family: 'tempad', reads: [1], writes: 1 },
    extension: { protocols: [1], legacy: true },
    hookProtocol: 2,
    wireHash: 'b'.repeat(64),
    presentationHash: 'c'.repeat(64),
    lockHash: 'd'.repeat(64),
    files: {},
    ...overrides
  }
  manifests.set(version, value)
  mkdirSync(join(root, version, 'dist'), { recursive: true })
  writeFileSync(join(root, version, 'dist/runtime-manifest.json'), JSON.stringify(value))
  return value
}
function catalog(versions: string[], latest = versions[0]!) {
  const releases = versions.map((version) => ({ version, integrity: 'sri', url: 'official' }))
  fake.catalog.mockResolvedValue({
    latest,
    releases,
    fingerprint: sha256(JSON.stringify({ latest, releases }))
  })
}
const absent = () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' })
}
beforeEach(() => {
  vi.resetAllMocks()
  manifests.clear()
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-acquire-')))
  manifest('0.12.0')
  manifest('0.12.1')
  context = { active: artifact('0.12.0'), control: artifact('0.12.0') }
  fake.manifest.mockImplementation((value: Artifact) => manifests.get(value.version))
  fake.cached.mockImplementation((_cache, version) => ({
    directory: join(root, version),
    manifest: manifests.get(version)
  }))
  fake.install.mockImplementation((_cache, version) => ({
    directory: join(root, version),
    manifest: manifests.get(version)
  }))
  fake.resolve.mockResolvedValue({ version: '0.12.1', integrity: 'sri', url: 'official' })
  catalog(['0.12.1'])
  fake.download.mockImplementation(async (release) => Buffer.from(release.version))
  fake.archive.mockImplementation(
    (bytes: Buffer) =>
      new Map([
        ['dist/runtime-manifest.json', Buffer.from(JSON.stringify(manifests.get(bytes.toString())))]
      ])
  )
  const entryVersion = (entry: string) => dirname(dirname(entry)).split('/').at(-1)!
  fake.fingerprint.mockImplementation((entry) => sha256(entryVersion(entry)))
  fake.probe.mockImplementation(async (entry) => {
    const version = entryVersion(entry)
    const value = manifests.get(version)!
    return {
      artifact: artifact(version),
      wireHash: value.wireHash,
      presentationHash: value.presentationHash
    }
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('does not fetch archives for current/older tags, or query at all for a checkout', async () => {
  catalog([], '0.12.0')
  expect(await stageRelease(root, 'latest', context)).toMatchObject({
    selection: { inspected: 0, remaining: 0 }
  })
  expect(fake.download).not.toHaveBeenCalled()
  fake.catalog.mockClear()
  vi.stubEnv('TEMPAD_MCP_DEV_CHECKOUT', '/missing')
  await expect(stageRelease(root, 'latest', context)).rejects.toThrow('Checkout')
  expect(fake.catalog).not.toHaveBeenCalled()
})

it('keeps exact-version staging unchanged and only downloads absent caches', async () => {
  manifest('0.12.1', { guidanceEpoch: 2 })
  const result = await stageRelease(root, '0.12.1', context)
  expect(result.candidate?.version).toBe('0.12.1')
  expect(result.selection).toBeUndefined()
  expect(fake.catalog).not.toHaveBeenCalled()
  expect(fake.download).not.toHaveBeenCalled()
  fake.cached.mockImplementation(absent)
  await stageRelease(root, '0.12.1', context)
  expect(fake.download).toHaveBeenCalledOnce()
  expect(fake.install).toHaveBeenCalledOnce()
})

it('selects the newest compatible release without probing incompatible candidates', async () => {
  manifest('0.12.3', { guidanceEpoch: 2 })
  manifest('0.12.2')
  catalog(['0.12.3', '0.12.2', '0.12.1'])
  expect(await stageRelease(root, 'latest', context)).toMatchObject({
    candidate: { version: '0.12.2' },
    selection: {
      latest: '0.12.3',
      latestReasons: ['Guidance epoch changed; restart MCP'],
      inspected: 2,
      remaining: 0
    }
  })
  expect(fake.probe).toHaveBeenCalledExactlyOnceWith(artifact('0.12.2').entry)
})

it('continues below a future Node engine policy without executing that package', async () => {
  manifest('0.12.2', { node: '^26.1' })
  catalog(['0.12.2', '0.12.1'])
  expect(await stageRelease(root, 'latest', context)).toMatchObject({
    candidate: { version: '0.12.1' },
    selection: { latestReasons: ['Node engine policy requires a newer runtime checker'] }
  })
  expect(fake.probe).toHaveBeenCalledExactlyOnceWith(artifact('0.12.1').entry)
})

it('preserves frozen control compatibility and skips known failed bundles', async () => {
  manifest('0.12.0', { state: { family: 'tempad', reads: [1], writes: 1 } })
  manifest('0.12.1', { state: { family: 'tempad', reads: [1, 2], writes: 1 } })
  context.active = artifact('0.12.1')
  manifest('0.12.4', { state: { family: 'tempad', reads: [1, 2], writes: 2 } })
  manifest('0.12.3')
  manifest('0.12.2')
  context.excludedBundles = [artifact('0.12.3').bundle]
  catalog(['0.12.4', '0.12.3', '0.12.2'])
  expect(await stageRelease(root, 'latest', context)).toMatchObject({
    candidate: { version: '0.12.2' },
    selection: { latestReasons: ['State rollback compatibility is missing'] }
  })
  expect(fake.probe).toHaveBeenCalledExactlyOnceWith(artifact('0.12.2').entry)
})

it('skips breaking branches and deprecated releases without downloading them', async () => {
  manifest('0.13.0')
  manifest('0.12.2')
  const releases = [
    { version: '0.13.0', integrity: 'sri', url: 'official' },
    { version: '0.12.2', integrity: 'sri', url: 'official', deprecated: 'bad release' },
    { version: '0.12.1', integrity: 'sri', url: 'official' }
  ]
  fake.catalog.mockResolvedValue({ latest: '0.13.0', fingerprint: 'catalog', releases })
  expect(await stageRelease(root, 'latest', context)).toMatchObject({
    candidate: { version: '0.12.1' },
    selection: { latestReasons: ['Breaking release boundary; explicit update required'] }
  })
  expect(fake.cached).toHaveBeenCalledExactlyOnceWith(root, '0.12.1', 'sri')
})

it('resumes bounded search beyond sixteen rejected releases and resets changed evidence', async () => {
  const versions = Array.from({ length: 18 }, (_, index) => `0.12.${18 - index}`)
  for (const version of versions)
    manifest(version, version === '0.12.1' ? {} : { guidanceEpoch: 2 })
  catalog(versions)
  const first = await stageRelease(root, 'latest', context)
  expect(first.selection).toMatchObject({
    inspected: 16,
    remaining: 2,
    cursor: { before: '0.12.3' }
  })
  const second = await stageRelease(root, 'latest', context, first.selection?.cursor)
  expect(second).toMatchObject({
    candidate: { version: '0.12.1' },
    selection: { inspected: 2, remaining: 0 }
  })
  fake.cached.mockClear()
  await stageRelease(
    root,
    'latest',
    {
      ...context,
      control: {
        ...context.control,
        release: { ...context.control.release!, manifestHash: 'f'.repeat(64) }
      }
    },
    first.selection?.cursor
  )
  expect(fake.cached.mock.calls[0]?.[1]).toBe('0.12.18')
  fake.cached.mockClear()
  catalog(versions.slice(1))
  await stageRelease(root, 'latest', context, first.selection?.cursor)
  expect(fake.cached.mock.calls[0]?.[1]).toBe('0.12.17')
})

it('checkpoints slow cached inspections before the worker deadline', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  manifest('0.12.2', { guidanceEpoch: 2 })
  catalog(['0.12.2', '0.12.1'])
  fake.cached.mockImplementation((_cache, version) => {
    now += 31000
    return { directory: join(root, version), manifest: manifests.get(version) }
  })
  const first = await stageRelease(root, 'latest', context)
  expect(first.selection).toMatchObject({ inspected: 1, remaining: 1 })
  expect(await stageRelease(root, 'latest', context, first.selection?.cursor)).toMatchObject({
    candidate: { version: '0.12.1' }
  })
})

it('checkpoints before a network archive and after one download without caching incompatible bytes', async () => {
  manifest('0.12.3', { guidanceEpoch: 2 })
  manifest('0.12.2', { guidanceEpoch: 2 })
  catalog(['0.12.3', '0.12.2', '0.12.1'])
  fake.cached.mockImplementation((_cache, version) => {
    if (version !== '0.12.3') absent()
    return { directory: join(root, version), manifest: manifests.get(version) }
  })
  const first = await stageRelease(root, 'latest', context)
  expect(first.selection).toMatchObject({ inspected: 1, remaining: 2 })
  expect(fake.download).not.toHaveBeenCalled()
  const second = await stageRelease(root, 'latest', context, first.selection?.cursor)
  expect(second.selection).toMatchObject({ inspected: 1, remaining: 1 })
  expect(fake.download).toHaveBeenCalledOnce()
  expect(fake.integrity).toHaveBeenCalledOnce()
  expect(fake.install).not.toHaveBeenCalled()
  expect(await stageRelease(root, 'latest', context, second.selection?.cursor)).toMatchObject({
    candidate: { version: '0.12.1' }
  })
  expect(fake.download).toHaveBeenCalledTimes(2)
  expect(fake.install).toHaveBeenCalledOnce()
})

it('skips an integrity-verified future manifest without executing it', async () => {
  manifest('0.12.2')
  catalog(['0.12.2', '0.12.1'])
  fake.cached.mockImplementation(absent)
  fake.archive.mockReturnValueOnce(
    new Map([
      [
        'dist/runtime-manifest.json',
        Buffer.from(JSON.stringify({ ...manifests.get('0.12.2'), version: 2 }))
      ]
    ])
  )
  const first = await stageRelease(root, 'latest', context)
  expect(first.selection?.latestReasons).toEqual([
    'Release uses an unsupported runtime manifest version'
  ])
  expect(fake.probe).not.toHaveBeenCalled()
  expect(await stageRelease(root, 'latest', context, first.selection?.cursor)).toMatchObject({
    candidate: { version: '0.12.1' }
  })
})

it('never replaces corrupted evidence or accepts a false contract declaration', async () => {
  fake.cached.mockImplementationOnce(() => {
    throw new Error('hash mismatch')
  })
  await expect(stageRelease(root, 'latest', context)).rejects.toThrow('hash mismatch')
  expect(fake.download).not.toHaveBeenCalled()
  fake.probe.mockResolvedValue({
    artifact: artifact('0.12.1'),
    wireHash: 'different',
    presentationHash: 'text'
  })
  await expect(stageRelease(root, 'latest', context)).rejects.toThrow('declared contract')
})
