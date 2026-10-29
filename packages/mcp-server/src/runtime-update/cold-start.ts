import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'
import { z } from 'zod'

import { getMcpServerConfig } from '../config'
import { writeDurableJson } from '../durable-json'
import { readHubRuntimeIdentity } from '../runtime-identity'
import {
  connectSocket,
  fingerprintBundle,
  hubSocketPath,
  isSocketPending,
  runtimePaths,
  supervisorSocketPath,
  unavailableSocket,
  withStartupLock
} from '../runtime-prototype/processes'
import {
  ConfigSchema,
  JournalSchema,
  readEndpoints,
  readJournal,
  readPrivateJson,
  writeJournal,
  writeEndpoints,
  type PrototypeConfig
} from '../runtime-prototype/state'
import { HUB_LOCK_STALE_MS, RUNTIME_PROFILE } from '../shared'
import { releaseManifest, retainBundledPackage, verifyReleaseArtifact } from './artifact'
import { privateDirectory } from './cache'
import { coldCompatibilityReasons, compareVersions, type RuntimeManifest } from './manifest'

const SnapshotSchema = z.object({ config: ConfigSchema, journal: JournalSchema }).strict()
const IntentSchema = SnapshotSchema.extend({ before: SnapshotSchema }).strict()
const EdgeSchema = z.object({ pid: z.number().int().positive() }).strict()

function controlVersion(config: PrototypeConfig) {
  return releaseManifest({
    entry: config.entry,
    bundle: config.bundle,
    version: JSON.parse(readFileSync(join(config.release!.directory, 'package.json'), 'utf8'))
      .version,
    release: config.release
  }).packageVersion
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Called only with startup.lock held, before any control owner is launched. */
export async function resumeColdStart(config: PrototypeConfig): Promise<PrototypeConfig> {
  const path = join(config.root, 'cold-start.json')
  const intent = readPrivateJson(path, IntentSchema)
  if (intent) {
    const candidate = intent.journal.candidate
    const saved = readPrivateJson(join(config.root, 'prototype.json'), ConfigSchema)
    const journal = readJournal(config.root)
    const matches = (actual: unknown, before: unknown, after: unknown) =>
      [before, after].some((value) => JSON.stringify(actual) === JSON.stringify(value))
    if (
      intent.config.secret !== config.secret ||
      JSON.stringify(intent.config.directories) !== JSON.stringify(config.directories) ||
      !intent.journal.coldStart ||
      !candidate ||
      candidate.entry !== intent.config.entry ||
      candidate.bundle !== intent.config.bundle ||
      !matches(saved, intent.before.config, intent.config) ||
      !matches(journal, intent.before.journal, intent.journal)
    )
      throw new Error('Cold runtime upgrade intent does not match this namespace.')
    if (hasLiveEdges(config.root) || (await hasOwner(config)))
      throw new Error('Cold runtime upgrade cannot resume while a prior owner is still alive.')
    verifyReleaseArtifact(candidate)
    // The intent remains until both metadata files are durable. A crash between
    // writes resumes this same decision; task/receipt snapshots are never restored.
    writeJournal(config.root, intent.journal)
    writeDurableJson(join(config.root, 'prototype.json'), intent.config)
    rmSync(path)
  }
  return {
    ...ConfigSchema.parse(readPrivateJson(join(config.root, 'prototype.json'), ConfigSchema)),
    root: config.root
  }
}

function hasLiveEdges(root: string) {
  const directory = join(root, 'edges')
  privateDirectory(directory)
  let live = false
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const path = join(directory, name)
    const edge = readPrivateJson(path, EdgeSchema)
    if (!edge) continue
    // PID reuse conservatively postpones migration, never expires a living edge.
    if (alive(edge.pid)) live = true
    else rmSync(path, { force: true })
  }
  return live
}

async function hasOwner(config: PrototypeConfig) {
  const paths = runtimePaths(config)
  for (const path of [supervisorSocketPath(config), hubSocketPath(config.root, paths.runtime)]) {
    try {
      const socket = await connectSocket(path)
      socket.destroy()
      return true
    } catch (error) {
      if (isSocketPending(error)) return true
      if (!unavailableSocket(error)) throw error
    }
  }
  const identityPath = join(paths.runtime, 'hub-runtime.json')
  if (existsSync(identityPath)) {
    const identity = readHubRuntimeIdentity(identityPath)
    if (!identity || alive(identity.processId)) return true
  }
  const supervisor = readPrivateJson(
    join(config.root, 'supervisor.json'),
    z.object({ pid: z.number().int().positive() }).passthrough()
  )
  if (supervisor && alive(supervisor.pid)) return true
  const deadline = performance.now() + HUB_LOCK_STALE_MS + 5000
  do {
    const locks = await Promise.all(
      (
        [
          [join(config.root, 'supervisor.lock'), undefined, 5000],
          [join(paths.runtime, 'hub.lock'), undefined, HUB_LOCK_STALE_MS],
          [paths.state, join(paths.state, '.tempad-hub-writer.lock'), HUB_LOCK_STALE_MS],
          [paths.assets, join(paths.assets, '.tempad-hub-writer.lock'), HUB_LOCK_STALE_MS]
        ] as const
      ).map(
        async ([path, lockfilePath, stale]) =>
          existsSync(path) &&
          lockfile.check(path, {
            stale,
            ...(lockfilePath ? { lockfilePath } : {})
          })
      )
    )
    if (locks.every((held) => !held)) return false
    await delay(100)
  } while (performance.now() < deadline)
  return true
}

async function reservePort(candidates: number[]) {
  const reservation = createServer((socket) => socket.destroy())
  let failure: unknown
  for (const port of new Set(candidates)) {
    try {
      await once(reservation.listen(port, '127.0.0.1'), 'listening')
      return reservation
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      failure = error
    }
  }
  throw failure ?? new Error('No runtime endpoint port candidates.')
}

/** Only called under startup.lock after all prior edges and writers have stopped. */
async function refreshEndpoints(root: string) {
  const endpoints = readEndpoints(root)
  if (!endpoints) return
  const candidates = getMcpServerConfig(RUNTIME_PROFILE).wsPortCandidates
  const wsCandidates =
    candidates.includes(endpoints.wsPort) || candidates.includes(0)
      ? [endpoints.wsPort, ...candidates]
      : candidates
  const reservations: Server[] = []
  try {
    const ws = await reservePort(wsCandidates)
    reservations.push(ws)
    const http = await reservePort([endpoints.httpPort, 0])
    reservations.push(http)
    const wsPort = (ws.address() as AddressInfo).port
    const httpPort = (http.address() as AddressInfo).port
    if (wsPort !== endpoints.wsPort || httpPort !== endpoints.httpPort)
      writeEndpoints(root, { ...endpoints, wsPort, httpPort })
  } finally {
    await Promise.all(
      reservations.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
  }
}

/** An installed CLI may advance a fully stopped runtime, never an attached session. */
export async function prepareManagedEdge(
  original: PrototypeConfig,
  packageDir: string,
  installed: RuntimeManifest
) {
  return withStartupLock(
    original.root,
    async () => {
      let config = await resumeColdStart(original)
      const journal = readJournal(config.root)
      const cold =
        journal &&
        (journal.phase === 'committed' || journal.coldStart) &&
        !hasLiveEdges(config.root) &&
        !(await hasOwner(config))
      if (cold) await refreshEndpoints(config.root)
      if (
        cold &&
        journal.phase === 'committed' &&
        compareVersions(installed.packageVersion, controlVersion(config)) > 0 &&
        compareVersions(installed.packageVersion, journal.active.version) >= 0
      ) {
        const reasons = coldCompatibilityReasons(releaseManifest(journal.active), installed)
        if (reasons.length) throw new Error(`Cold runtime upgrade refused: ${reasons.join('; ')}.`)
        const candidate = await retainBundledPackage(packageDir, join(config.root, 'cache'))
        candidate.bundle = fingerprintBundle(candidate.entry)
        if (
          candidate.version === journal.active.version &&
          candidate.release?.manifestHash !== journal.active.release?.manifestHash
        )
          throw new Error(
            'An installed version cannot replace different bytes of the same release.'
          )
        if (journal.failedBundles.includes(candidate.bundle))
          throw new Error('The installed runtime was quarantined after an earlier failure.')
        const { root, ...saved } = config
        writeDurableJson(join(root, 'cold-start.json'), {
          before: { config: saved, journal },
          config: {
            ...saved,
            entry: candidate.entry,
            bundle: candidate.bundle,
            release: candidate.release
          },
          journal: {
            ...journal,
            revision: journal.revision + 1,
            phase: 'old-stopped',
            candidate,
            coldStart: true,
            oldHub: undefined,
            failure: undefined
          }
        })
        config = await resumeColdStart(config)
      }
      const directory = join(config.root, 'edges')
      privateDirectory(directory)
      const path = join(directory, `${randomUUID()}.json`)
      writeDurableJson(path, { pid: process.pid })
      const close = () => rmSync(path, { force: true })
      process.once('exit', close)
      return {
        config,
        close: () => {
          process.off('exit', close)
          close()
        }
      }
    },
    true
  )
}
