import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

const fake = vi.hoisted(() => ({
  retain: vi.fn(),
  verify: vi.fn(),
  connect: vi.fn(),
  ports: [0]
}))
vi.mock('../src/config', async (original) => {
  const config = await original<typeof import('../src/config')>()
  return {
    ...config,
    getMcpServerConfig: (...args: Parameters<typeof config.getMcpServerConfig>) => ({
      ...config.getMcpServerConfig(...args),
      wsPortCandidates: fake.ports
    })
  }
})
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
import * as durable from '../src/durable-json'
import { createPrivateTempDirectory } from '../src/runtime-platform'
import { fingerprintBundle, withStartupLock } from '../src/runtime-prototype/processes'
import * as state from '../src/runtime-prototype/state'
import {
  ConfigSchema,
  readEndpoints,
  readJournal,
  readPrivateJson,
  writeJournal,
  writeEndpoints,
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
const endpoints = {
  wsPort: 6220,
  httpPort: 12345,
  accessToken: 'a'.repeat(32),
  legacyAccessToken: 'b'.repeat(32)
}

async function httpListener(port = 0) {
  const server = createServer()
  await once(server.listen(port, '127.0.0.1'), 'listening')
  cleanup.push(async () => {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return server
}

async function saveHttpEndpoint(occupied = true) {
  const server = await httpListener()
  const saved = { ...endpoints, httpPort: (server.address() as { port: number }).port }
  writeEndpoints(root, saved)
  if (!occupied) await new Promise<void>((resolve) => server.close(() => resolve()))
  return saved
}

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

beforeEach(async () => {
  vi.clearAllMocks()
  fake.ports = [0]
  const ws = await httpListener()
  endpoints.wsPort = (ws.address() as { port: number }).port
  await new Promise<void>((resolve) => ws.close(() => resolve()))
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

it.each(['edge', 'supervisor', 'hub', 'socket', 'unprotected-pipe', 'timed-out-socket'] as const)(
  'retains the running generation when a %s survives',
  async (owner) => {
    writeEndpoints(root, endpoints)
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
    } else if (owner === 'unprotected-pipe' || owner === 'timed-out-socket') {
      fake.connect.mockRejectedValue(
        Object.assign(new Error('Endpoint acquisition pending'), {
          code: owner === 'unprotected-pipe' ? 'EPIPEUNPROTECTED' : 'ETIMEDOUT'
        })
      )
    } else {
      fake.connect.mockResolvedValue({ destroy: vi.fn() })
    }
    expect((await prepare()).config).toEqual(config)
    expect(readJournal(root)).toEqual(journal)
    expect(fake.retain).not.toHaveBeenCalled()
    expect(readEndpoints(root)).toEqual(endpoints)
  }
)

it.each([false, true])(
  'refreshes only an occupied cold HTTP port (occupied=%s), preserving the old metadata format',
  async (occupied) => {
    const saved = await saveHttpEndpoint(occupied)
    const installed = release('0.12.0', 'installed')
    expect((await prepare(installed)).config).toEqual(config)
    const next = readEndpoints(root)!
    if (occupied) expect(next.httpPort).not.toBe(saved.httpPort)
    else expect(next.httpPort).toBe(saved.httpPort)
    expect({ ...next, httpPort: saved.httpPort }).toEqual(saved)
    // Frozen pre-fix schema: rollback must remain readable by an older release.
    expect(
      z
        .object({
          wsPort: z.number().int().min(1).max(65535),
          httpPort: z.number().int().min(1).max(65535),
          accessToken: z.string().min(32),
          legacyAccessToken: z.string().min(32)
        })
        .strict()
        .parse(next)
    ).toEqual(next)
    expect(readJournal(root)).toEqual(journal)
  }
)

it.each(['preparing', 'old-stopped', 'candidate-ready'] as const)(
  'keeps endpoints fixed during an unfinished %s transaction',
  async (phase) => {
    writeEndpoints(root, endpoints)
    writeJournal(root, { ...journal, phase })
    await prepare()
    expect(readEndpoints(root)).toEqual(endpoints)
  }
)

it('reassigns an occupied cold WebSocket port only to another discovery candidate', async () => {
  const occupied = await httpListener()
  endpoints.wsPort = (occupied.address() as { port: number }).port
  const available = await httpListener()
  const replacement = (available.address() as { port: number }).port
  fake.ports = [endpoints.wsPort, replacement]
  const saved = await saveHttpEndpoint(false)
  await new Promise<void>((resolve) => available.close(() => resolve()))
  await prepare()
  expect(readEndpoints(root)).toEqual({ ...saved, wsPort: replacement })
})

it('does not keep a cold WebSocket port outside the current discovery candidates', async () => {
  const available = await httpListener()
  const replacement = (available.address() as { port: number }).port
  fake.ports = [replacement]
  const saved = await saveHttpEndpoint(false)
  await new Promise<void>((resolve) => available.close(() => resolve()))
  await prepare()
  expect(readEndpoints(root)).toEqual({ ...saved, wsPort: replacement })
})

it('does not use an arbitrary WebSocket port when every discovery candidate is occupied', async () => {
  const occupied = await Promise.all([httpListener(), httpListener()])
  fake.ports = occupied.map((server) => (server.address() as { port: number }).port)
  endpoints.wsPort = fake.ports[0]!
  const saved = await saveHttpEndpoint(false)
  await expect(prepare()).rejects.toMatchObject({ code: 'EADDRINUSE' })
  expect(readEndpoints(root)).toEqual(saved)
  expect(readdirSync(join(root, 'edges'))).toEqual([])
  expect(fake.retain).not.toHaveBeenCalled()
})

it('can reallocate HTTP after resuming an interrupted verified cold upgrade', async () => {
  const saved = await saveHttpEndpoint()
  const pending = intent()
  expect((await prepare()).config.entry).toBe(candidate.artifact.entry)
  expect(readEndpoints(root)?.httpPort).not.toBe(saved.httpPort)
  expect(readJournal(root)).toEqual(pending.journal)
  expect(fake.verify).toHaveBeenCalledOnce()
  expect(fake.retain).not.toHaveBeenCalled()
})

it('does not admit an edge when its cold HTTP allocation cannot be saved', async () => {
  const saved = await saveHttpEndpoint()
  let reservedPort: number | undefined
  const write = durable.writeDurableJson
  vi.spyOn(durable, 'writeDurableJson').mockImplementation((path, value) => {
    if (path === join(root, 'endpoints.json')) {
      reservedPort = (value as { httpPort: number }).httpPort
      throw new Error('Endpoint write failed')
    }
    return write(path, value)
  })
  await expect(prepare()).rejects.toThrow('Endpoint write failed')
  expect(readEndpoints(root)).toEqual(saved)
  expect(readdirSync(join(root, 'edges'))).toEqual([])
  expect(fake.retain).not.toHaveBeenCalled()
  expect(reservedPort).toBeTypeOf('number')
  await httpListener(reservedPort)
  await httpListener(saved.wsPort)
})

it('waits for the real state writer lease instead of treating its lock directory as a file', async () => {
  const saved = await saveHttpEndpoint()
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
  expect(readEndpoints(root)).toEqual(saved)
  await unlock()
  locked = false
  expect((await result).config.entry).toBe(candidate.artifact.entry)
  expect(readEndpoints(root)?.httpPort).not.toBe(saved.httpPort)
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

it('ignores a prior edge registration removed by its exiting CLI during the scan', async () => {
  privateDirectory(join(root, 'edges'))
  const path = join(root, 'edges/prior.json')
  writeDurableJson(path, { pid: process.pid })
  const read = state.readPrivateJson
  vi.spyOn(state, 'readPrivateJson').mockImplementation((file, schema) => {
    if (file === path) rmSync(path, { force: true })
    return read(file, schema)
  })
  expect((await prepare()).config.entry).toBe(candidate.artifact.entry)
  expect(readJournal(root)?.coldStart).toBe(true)
})

it('rejects an invalid prior edge registration instead of treating it as absent', async () => {
  privateDirectory(join(root, 'edges'))
  writeDurableJson(join(root, 'edges/prior.json'), { pid: 'invalid' })
  await expect(prepare()).rejects.toThrow('expected number')
  expect(fake.retain).not.toHaveBeenCalled()
  expect(readJournal(root)).toEqual(journal)
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
