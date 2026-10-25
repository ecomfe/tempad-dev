import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ retain: vi.fn(), verify: vi.fn(), connect: vi.fn() }))
vi.mock('../src/runtime-update/artifact', async (original) => ({
  ...(await original<typeof import('../src/runtime-update/artifact')>()),
  retainBundledPackage: fake.retain,
  verifyReleaseArtifact: fake.verify
}))
vi.mock('../src/runtime-prototype/processes', async (original) => ({
  ...(await original<typeof import('../src/runtime-prototype/processes')>()),
  connectSocket: fake.connect
}))

import { writeDurableJson } from '../src/durable-json'
import { createPrivateTempDirectory } from '../src/runtime-platform'
import { fingerprintBundle, withStartupLock } from '../src/runtime-prototype/processes'
import {
  ConfigSchema,
  readJournal,
  readPrivateJson,
  writeJournal,
  type Artifact,
  type Journal,
  type PrototypeConfig
} from '../src/runtime-prototype/state'
import { privateDirectory } from '../src/runtime-update/cache'
import { prepareManagedEdge, resumeColdStart } from '../src/runtime-update/cold-start'
import { type RuntimeManifest } from '../src/runtime-update/manifest'
import { sha256 } from '../src/runtime-update/package'

let root: string
let config: PrototypeConfig
let journal: Journal
let candidate: ReturnType<typeof release>
const cleanup: (() => unknown | Promise<unknown>)[] = []

function release(version: string, name: string, overrides: Partial<RuntimeManifest> = {}) {
  const directory = join(root, 'packages', name)
  privateDirectory(join(directory, 'dist'))
  const manifest: RuntimeManifest = {
    version: 1,
    name: '@tempad-dev/mcp',
    packageVersion: version,
    entry: 'dist/managed-runtime.mjs',
    guidanceEpoch: 1,
    guidanceReview: {
      version,
      sourceHash: 'a'.repeat(64),
      decision: 'compatible',
      baseline: { version: '0.11.0', integrity: `sha512-${'a'.repeat(86)}==` },
      rationale: 'A locally prepared release fixture for cold runtime admission.'
    },
    controlProtocols: [1, 2],
    state: { family: 'tempad', reads: [1], writes: 1 },
    extension: { protocols: [13, 15], legacy: true },
    hookProtocol: 2,
    node: '^22 || ^24 || >=26',
    platforms: ['darwin', 'linux', 'win32'],
    wireHash: 'b'.repeat(64),
    presentationHash: 'c'.repeat(64),
    lockHash: 'd'.repeat(64),
    files: {},
    ...overrides
  }
  const entry = join(directory, manifest.entry)
  writeFileSync(entry, `// release ${name}\n`)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }))
  const bytes = JSON.stringify(manifest)
  writeFileSync(join(directory, 'dist/runtime-manifest.json'), bytes)
  const artifact: Artifact = {
    entry,
    bundle: fingerprintBundle(entry),
    version,
    release: { directory, manifestHash: sha256(Buffer.from(bytes)) }
  }
  return { directory, manifest, artifact }
}

function saveConfig(value: PrototypeConfig) {
  const { root: _root, ...saved } = value
  writeDurableJson(join(root, 'prototype.json'), saved)
  return saved
}

async function prepare(value = candidate) {
  const edge = await prepareManagedEdge(config, value.directory, value.manifest)
  cleanup.push(edge.close)
  return edge
}

function intent() {
  const { root: _root, ...saved } = config
  const value = {
    before: { config: saved, journal },
    config: {
      ...saved,
      entry: candidate.artifact.entry,
      bundle: candidate.artifact.bundle,
      release: candidate.artifact.release
    },
    journal: {
      ...journal,
      revision: journal.revision + 1,
      phase: 'old-stopped' as const,
      candidate: candidate.artifact,
      coldStart: true as const
    }
  }
  writeDurableJson(join(root, 'cold-start.json'), value)
  return value
}

beforeEach(() => {
  vi.clearAllMocks()
  root = createPrivateTempDirectory('tp-cold-')
  const control = release('0.12.0', 'a')
  const active = release('0.12.1', 'b')
  candidate = release('0.12.2', 'c', {
    wireHash: 'e'.repeat(64),
    guidanceEpoch: 2,
    controlProtocols: [2]
  })
  config = {
    root,
    version: 1,
    entry: control.artifact.entry,
    bundle: control.artifact.bundle,
    release: control.artifact.release,
    secret: randomUUID(),
    directories: {
      runtime: join(root, 'run'),
      state: join(root, 'state'),
      assets: join(root, 'assets'),
      log: join(root, 'log')
    }
  }
  for (const directory of Object.values(config.directories!)) privateDirectory(directory)
  journal = {
    version: 1,
    revision: 4,
    phase: 'committed',
    active: active.artifact,
    previous: control.artifact,
    failedBundles: ['f'.repeat(64)]
  }
  saveConfig(config)
  writeJournal(root, journal)
  fake.connect.mockRejectedValue(Object.assign(new Error('absent'), { code: 'ENOENT' }))
  fake.retain.mockImplementation(async () => ({ ...candidate.artifact }))
  fake.verify.mockImplementation(() => {})
})

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('admits an installed newer contract only on cold startup and preserves prior state', async () => {
  const snapshot = join(config.directories!.state, 'tasks.json')
  const data = { stopped: ['task'], executionBlocks: ['file'], needsRead: ['file'] }
  writeDurableJson(snapshot, data)
  const edge = await prepare()
  expect(edge.config).toMatchObject({
    entry: candidate.artifact.entry,
    bundle: candidate.artifact.bundle,
    secret: config.secret,
    directories: config.directories
  })
  expect(readJournal(root)).toEqual({
    ...journal,
    revision: 5,
    phase: 'old-stopped',
    coldStart: true,
    candidate: candidate.artifact
  })
  expect(JSON.parse(readFileSync(snapshot, 'utf8'))).toEqual(data)
  expect(fake.verify).toHaveBeenCalledWith(candidate.artifact)
  expect(existsSync(join(root, 'cold-start.json'))).toBe(false)
  expect(readdirSync(join(root, 'edges'))).toHaveLength(1)
  edge.close()
  expect(readdirSync(join(root, 'edges'))).toEqual([])
})

it.each(['edge', 'supervisor', 'hub', 'socket', 'unprotected-pipe'] as const)(
  'retains the running generation when a %s survives',
  async (owner) => {
    if (owner === 'edge') {
      privateDirectory(join(root, 'edges'))
      writeDurableJson(join(root, 'edges/prior.json'), { pid: process.pid })
    } else if (owner === 'supervisor') {
      writeDurableJson(join(root, 'supervisor.json'), { pid: process.pid })
    } else if (owner === 'hub') {
      writeDurableJson(join(config.directories!.runtime, 'hub-runtime.json'), {
        schemaVersion: 1,
        packageVersion: journal.active.version,
        runtimeFingerprint: journal.active.bundle,
        entryPath: journal.active.entry,
        startedAt: new Date().toISOString(),
        processId: process.pid,
        activeExtension: null
      })
    } else if (owner === 'unprotected-pipe') {
      fake.connect.mockRejectedValue(
        Object.assign(new Error('ACL protection pending'), { code: 'EPIPEUNPROTECTED' })
      )
    } else {
      fake.connect.mockResolvedValue({ destroy: vi.fn() })
    }
    expect((await prepare()).config).toEqual(config)
    expect(readJournal(root)).toEqual(journal)
    expect(fake.retain).not.toHaveBeenCalled()
  }
)

it('waits for the real state writer lease instead of treating its lock directory as a file', async () => {
  const state = config.directories!.state
  const unlock = await lockfile.lock(state, {
    lockfilePath: join(state, '.tempad-hub-writer.lock')
  })
  let locked = true
  cleanup.push(async () => {
    if (locked) await unlock()
  })
  const result = prepare()
  await vi.waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(2))
  expect(fake.retain).not.toHaveBeenCalled()
  await unlock()
  locked = false
  expect((await result).config.entry).toBe(candidate.artifact.entry)
})

it('removes only dead edge records before admitting a cold upgrade', async () => {
  privateDirectory(join(root, 'edges'))
  const stale = join(root, 'edges/dead.json')
  writeDurableJson(stale, { pid: 123456789 })
  const original = process.kill.bind(process)
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === 123456789) throw Object.assign(new Error('dead'), { code: 'ESRCH' })
    return original(pid, signal)
  })
  expect((await prepare()).config.entry).toBe(candidate.artifact.entry)
  expect(existsSync(stale)).toBe(false)
})

it('serializes competing cold launches before either edge can initialize', async () => {
  const [first, second] = await Promise.all([prepare(), prepare()])
  expect(first.config.entry).toBe(candidate.artifact.entry)
  expect(second.config).toEqual(first.config)
  expect(fake.retain).toHaveBeenCalledOnce()
  expect(readJournal(root)?.revision).toBe(5)
  expect(readdirSync(join(root, 'edges'))).toHaveLength(2)
})

it.each(['0.11.0', '0.12.0'])('does not downgrade the active runtime from %s', async (version) => {
  const older = release(version, 'older')
  expect((await prepare(older)).config).toEqual(config)
  expect(fake.retain).not.toHaveBeenCalled()
  expect(readJournal(root)).toEqual(journal)
})

it('rejects different bytes with the same active release version', async () => {
  candidate = release(journal.active.version, 'different-bytes', { guidanceEpoch: 2 })
  await expect(prepare()).rejects.toThrow('different bytes of the same release')
  expect(readJournal(root)).toEqual(journal)
})

it.each<[string, Partial<RuntimeManifest>, string]>([
  ['state', { state: { family: 'other', reads: [1], writes: 1 } }, 'State rollback'],
  ['extension', { extension: { protocols: [15], legacy: true } }, 'Released extension'],
  ['control', { controlProtocols: [3] }, 'No common control']
])('keeps the %s compatibility boundary on cold startup', async (_name, overrides, reason) => {
  candidate = release('0.12.2', 'c', overrides)
  await expect(prepare()).rejects.toThrow(reason)
  expect(fake.retain).not.toHaveBeenCalled()
  expect(readJournal(root)).toEqual(journal)
})

it('preserves quarantined bundles and unfinished handoffs', async () => {
  journal.failedBundles.push(candidate.artifact.bundle)
  writeJournal(root, journal)
  await expect(prepare()).rejects.toThrow('quarantined')
  expect(readJournal(root)).toEqual(journal)
  journal.phase = 'preparing'
  writeJournal(root, journal)
  fake.retain.mockClear()
  expect((await prepare()).config).toEqual(config)
  expect(fake.retain).not.toHaveBeenCalled()
})

it.each(['neither', 'journal', 'both'] as const)(
  'resumes the exact durable decision after %s metadata writes',
  async (written) => {
    const pending = intent()
    if (written !== 'neither') writeJournal(root, pending.journal)
    if (written === 'both') writeDurableJson(join(root, 'prototype.json'), pending.config)
    const next = await withStartupLock(root, () => resumeColdStart(config))
    expect(next).toEqual({ ...pending.config, root })
    expect(readJournal(root)).toEqual(pending.journal)
    expect(readPrivateJson(join(root, 'prototype.json'), ConfigSchema)).toEqual(pending.config)
    expect(existsSync(join(root, 'cold-start.json'))).toBe(false)
    expect(fake.verify).toHaveBeenCalledOnce()
  }
)

it('does not replay an old intent over a newer journal revision', async () => {
  intent()
  writeJournal(root, { ...journal, revision: 10 })
  await expect(withStartupLock(root, () => resumeColdStart(config))).rejects.toThrow(
    'does not match'
  )
  expect(readJournal(root)?.revision).toBe(10)
  expect(existsSync(join(root, 'cold-start.json'))).toBe(true)
  expect(fake.verify).not.toHaveBeenCalled()
})

it('does not finish a pending intent while an earlier edge still lives', async () => {
  intent()
  privateDirectory(join(root, 'edges'))
  writeDurableJson(join(root, 'edges/prior.json'), { pid: process.pid })
  await expect(withStartupLock(root, () => resumeColdStart(config))).rejects.toThrow(
    'prior owner is still alive'
  )
  expect(readJournal(root)).toEqual(journal)
  expect(fake.verify).not.toHaveBeenCalled()
})

it('revalidates retained bytes before finishing an interrupted upgrade', async () => {
  intent()
  fake.verify.mockImplementation(() => {
    throw new Error('retained bytes changed')
  })
  await expect(withStartupLock(root, () => resumeColdStart(config))).rejects.toThrow(
    'retained bytes changed'
  )
  expect(readJournal(root)).toEqual(journal)
  expect(readPrivateJson(join(root, 'prototype.json'), ConfigSchema)?.entry).toBe(config.entry)
})
