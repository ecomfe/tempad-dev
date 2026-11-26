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
  hubSocketPath,
  isSocketPending,
  runtimeProcessStatus,
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
  type Artifact,
  type Journal,
  type PrototypeConfig
} from '../runtime-prototype/state'
import { HUB_LOCK_STALE_MS, RUNTIME_PROFILE } from '../shared'
import { releaseManifest, retainBundledPackage, verifyReleaseArtifact } from './artifact'
import { privateDirectory } from './cache'
import {
  coldCompatibilityReasons,
  compareVersions,
  isBridgeMigration,
  type RuntimeManifest
} from './manifest'

const SnapshotSchema = z.object({ config: ConfigSchema, journal: JournalSchema }).strict()
const IntentSchema = SnapshotSchema.extend({ before: SnapshotSchema }).strict()
const EdgeSchema = z.object({ pid: z.number().int().positive() }).strict()

function controlManifest(config: PrototypeConfig) {
  return releaseManifest({
    entry: config.entry,
    bundle: config.bundle,
    version: JSON.parse(readFileSync(join(config.release!.directory, 'package.json'), 'utf8'))
      .version,
    release: config.release
  })
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
    if (runtimeProcessStatus(edge.pid) !== 'exited') live = true
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
    if (!identity || runtimeProcessStatus(identity.processId) !== 'exited') return true
  }
  const supervisor = readPrivateJson(
    join(config.root, 'supervisor.json'),
    z.object({ pid: z.number().int().positive() }).passthrough()
  )
  if (supervisor && runtimeProcessStatus(supervisor.pid) !== 'exited') return true
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

/** Record only ownership metadata. The next owner opens the original task and asset stores. */
async function selectColdRuntime(config: PrototypeConfig, journal: Journal, candidate: Artifact) {
  if (
    candidate.version === journal.active.version &&
    candidate.release?.manifestHash !== journal.active.release?.manifestHash
  )
    throw new Error('An installed version cannot replace different bytes of the same release.')
  if (journal.failedBundles.includes(candidate.bundle))
    throw new Error('The installed runtime was quarantined after an earlier failure.')
  const { root, ...saved } = config
  // A historical supervisor makes the former active Hub its automatic crash fallback.
  // When restoring 1.x, never let a subsequent 1.x crash silently reactivate 2.x.
  const restoring = compareVersions(candidate.version, journal.active.version) < 0
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
      ...(restoring ? { active: candidate, previous: undefined } : {}),
      revision: journal.revision + 1,
      phase: 'old-stopped',
      candidate,
      coldStart: true,
      oldHub: undefined,
      failure: undefined
    }
  })
  return resumeColdStart(config)
}

function sameRelease(
  a: Pick<Artifact, 'bundle' | 'release'>,
  b: Pick<Artifact, 'bundle' | 'release'>
) {
  return a.bundle === b.bundle && !!a.release && a.release.manifestHash === b.release?.manifestHash
}

async function stoppedMigrationState(original: PrototypeConfig) {
  const config = await resumeColdStart(original)
  const journal = readJournal(config.root)
  if (!journal || (journal.phase !== 'committed' && !journal.coldStart))
    throw new Error('Finish the current runtime handoff before migrating.')
  if (hasLiveEdges(config.root) || (await hasOwner(config)))
    throw new Error(
      'Close all TemPad MCP connections and wait for the Hub to exit before migrating.'
    )
  return { config, journal }
}

/** Both directions use the new CLI, including rollback to a historical launcher. */
export async function migrateRuntime(
  original: PrototypeConfig,
  packageDir: string,
  installed: RuntimeManifest,
  version: string,
  confirm: (version: string, hash: string) => Promise<void>
) {
  const selection = await withStartupLock(
    original.root,
    async () => {
      const state = await stoppedMigrationState(original)
      const { config, journal } = state
      const candidate: Artifact | undefined =
        version === installed.packageVersion
          ? await retainBundledPackage(packageDir, join(config.root, 'cache'))
          : [journal.active, journal.previous].find((item) => item?.version === version)
      if (!candidate?.release)
        throw new Error('The requested release is neither installed nor retained for rollback.')
      const active = verifyReleaseArtifact(journal.active)
      const target = verifyReleaseArtifact(candidate)
      const control = controlManifest(config)
      const selected = journal.phase === 'committed' ? journal.active : journal.candidate
      // An interrupted cold bridge transaction still names its verified participant.
      // A restored 1.x is its own candidate because it may never fall forward on crash.
      if (
        journal.phase !== 'committed' &&
        (!selected ||
          !sameRelease(config, selected) ||
          !(
            isBridgeMigration(active, control) ||
            (!journal.previous &&
              sameRelease(journal.active, selected) &&
              isBridgeMigration(active, installed))
          ))
      )
        throw new Error('Finish the current runtime handoff before migrating.')
      if (
        (control.packageVersion === version && !sameRelease(config, candidate)) ||
        (selected?.version === version && !sameRelease(selected, candidate))
      )
        throw new Error('An installed version cannot replace different bytes of the same release.')
      if (selected && sameRelease(config, candidate) && sameRelease(selected, candidate))
        return { state }
      // A failed new Hub can already have rolled back while its new supervisor is still configured.
      if (!isBridgeMigration(active, target) && !isBridgeMigration(control, target))
        throw new Error('This migration is only for the reviewed 1.x/2.x extension bridge change.')
      const reasons = coldCompatibilityReasons(active, target, true)
      if (reasons.length) throw new Error(`Cold runtime migration refused: ${reasons.join('; ')}.`)
      return {
        state,
        candidate,
        identity: candidate.release.integrity ?? `manifest sha256-${candidate.release.manifestHash}`
      }
    },
    true
  )
  const { state, candidate, identity } = selection
  if (!candidate) return state.config
  await confirm(version, identity)
  return withStartupLock(
    original.root,
    async () => {
      const next = await stoppedMigrationState(original)
      if (JSON.stringify(next) !== JSON.stringify(state))
        throw new Error(
          'Runtime ownership or selection changed since confirmation. Retry the migration.'
        )
      verifyReleaseArtifact(next.journal.active)
      verifyReleaseArtifact(candidate)
      await refreshEndpoints(next.config.root)
      return selectColdRuntime(next.config, next.journal, candidate)
    },
    true
  )
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
        journal?.phase === 'committed' &&
        journal.active.version.startsWith('1.') &&
        installed.packageVersion.startsWith('2.')
      ) {
        process.stderr.write(
          `TemPad: keeping MCP ${journal.active.version}. Update the extension, close all TemPad MCP connections, then run npx -y @tempad-dev/mcp@${installed.packageVersion} --migrate-runtime ${installed.packageVersion}.\n`
        )
      } else if (
        cold &&
        journal.phase === 'committed' &&
        compareVersions(installed.packageVersion, controlManifest(config).packageVersion) > 0 &&
        compareVersions(installed.packageVersion, journal.active.version) >= 0
      ) {
        const reasons = coldCompatibilityReasons(releaseManifest(journal.active), installed)
        if (reasons.length) throw new Error(`Cold runtime upgrade refused: ${reasons.join('; ')}.`)
        const candidate = await retainBundledPackage(packageDir, join(config.root, 'cache'))
        config = await selectColdRuntime(config, journal, candidate)
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
