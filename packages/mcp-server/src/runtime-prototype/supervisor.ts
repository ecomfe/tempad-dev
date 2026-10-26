import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'
import { z } from 'zod'

import { parseHubRuntimeIdentity } from '../runtime-identity'
import { cleanupEndpoint, runtimeEndpoint } from '../runtime-platform'
import { releaseManifest, verifyReleaseArtifact } from '../runtime-update/artifact'
import { pruneCache } from '../runtime-update/cache'
import { acquireRelease, ReleaseUpdates } from '../runtime-update/manager'
import {
  automaticCompatibilityReasons,
  coldCompatibilityReasons,
  compatibilityReasons
} from '../runtime-update/manifest'
import { ensureDir, ensureFile, HUB_LOCK_STALE_MS, PACKAGE_VERSION, SOCK_PATH } from '../shared'
import { startHookGateway } from './hooks'
import { AUTOMATIC_IDLE_MS, LeaseSchema } from './hub-control'
import { probeArtifact } from './probe'
import {
  connectSocket,
  fingerprintBundle,
  hubSocketPath,
  isSocketPending,
  runtimePaths,
  supervisorSocketPath,
  launch,
  listenPrivate,
  waitForLaunchedSocket,
  waitForSocket,
  unavailableSocket,
  type PrototypeConfig
} from './processes'
import {
  ControlPeer,
  CONTROL_VERSIONS,
  isRuntimeUnavailable,
  negotiate,
  RECOVER_MS,
  RegistrationSchema,
  RENEW_MS,
  SocketTransport,
  unavailable,
  type Registration
} from './protocol'
import {
  newerVersion,
  readJournal,
  readJournalAsync,
  writeJournal,
  type Artifact,
  type Journal
} from './state'
import { controlComponentStatus } from './status'

const InspectionSchema = ResultSchema.extend({
  drained: z.boolean(),
  deadline: z.number(),
  blockers: z.array(z.string()),
  version: z.string(),
  gated: z.boolean(),
  handoffVersion: z.literal(1),
  autoBlockers: z.array(z.string()).optional(),
  idleForMs: z.number().nonnegative().optional()
})
const AUTOMATIC_RETRY_MS = 60_000
type Lease = z.infer<typeof LeaseSchema>
type Edge = {
  registration: Registration
  ready: boolean
  supportsReplacement?: boolean
  waitForRuntime?: boolean
  admissionBarrier?: boolean
  error?: string
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

export async function startSupervisor(config: PrototypeConfig) {
  const lockPath = join(config.root, 'supervisor.lock')
  ensureFile(lockPath)
  const unlock = await lockfile.lock(lockPath, { retries: 0, stale: 5000, update: 1000 })
  const socketPath = supervisorSocketPath(config)
  const paths = runtimePaths(config)
  const control: Artifact = {
    entry: config.entry,
    bundle: config.bundle,
    version: PACKAGE_VERSION,
    release: config.release
  }
  const peers = new Set<ControlPeer>()
  const edges = new Map<ControlPeer, Edge>()
  const pausedEdges = new Map<ControlPeer, string>()
  let hub: ControlPeer | undefined
  let lease: Lease | undefined
  let pendingHub:
    | { artifact: Artifact; child: ReturnType<typeof launch>; exited: boolean }
    | undefined
  let hooks: Awaited<ReturnType<typeof startHookGateway>> | undefined
  let journal: Journal = readJournal(config.root) ?? {
    version: 1,
    revision: 0,
    phase: 'committed',
    active: control,
    failedBundles: []
  }
  let closing = false
  let transitioning = false
  let renewing = false
  let automaticChecking = false
  let automaticRetryAt = 0
  let automaticError: string | undefined
  let hookFault: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const lifetime = new AbortController()
  const pause = (milliseconds: number) =>
    delay(milliseconds, undefined, { signal: lifetime.signal })
  const stop = () => void close()
  const updates: ReleaseUpdates | undefined = config.release
    ? new ReleaseUpdates({
        root: config.root,
        enrolled: () =>
          !transitioning &&
          [...edges.values()].some((edge) => edge.registration.updates?.policy === 'stable'),
        acquire: async (version, signal, cursor) => {
          await requireHub().request(
            { method: 'tempad/runtime-retain', params: { retained: true } },
            ResultSchema
          )
          try {
            const result = await acquireRelease(
              join(dirname(config.entry), 'runtime-installer.mjs'),
              join(config.root, 'cache'),
              version,
              { active: journal.active, control, excludedBundles: journal.failedBundles },
              signal,
              cursor
            )
            await pruneCache(
              join(config.root, 'cache'),
              [
                control,
                journal.active,
                journal.previous,
                journal.candidate,
                result.candidate,
                updates?.status.candidate
              ],
              signal
            )
            return result
          } finally {
            await hub
              ?.request(
                { method: 'tempad/runtime-retain', params: { retained: false } },
                ResultSchema
              )
              .catch(() => {})
          }
        }
      })
    : undefined

  function activationBlockers(candidate: Artifact, automatic = false) {
    let reasons: string[]
    try {
      const compare = automatic ? automaticCompatibilityReasons : compatibilityReasons
      const next = releaseManifest(candidate)
      reasons = [
        ...new Set([
          ...compare(releaseManifest(journal.active), next),
          ...compatibilityReasons(releaseManifest(control), next)
        ])
      ]
    } catch (error) {
      return [`Retained release verification failed: ${String(error)}`]
    }
    if (!newerVersion(candidate.version, journal.active.version))
      reasons.push('Candidate is not newer than the active runtime')
    if (journal.failedBundles.includes(candidate.bundle))
      reasons.push('Candidate was quarantined after a failed activation')
    if ([...edges.values()].some((edge) => edge.registration.updates?.policy !== 'stable'))
      reasons.push(
        'An attached MCP client has not opted in; restart it with --runtime-updates=stable or close it'
      )
    if ([...edges.values()].some((edge) => !edge.supportsReplacement))
      reasons.push('An attached MCP client has not finished initialization')
    if ([...edges.values()].some((edge) => !edge.admissionBarrier))
      reasons.push('Restart an older MCP client to enable safe runtime handoff')
    return reasons
  }

  function automaticEnabled() {
    return (
      !!updates &&
      !updates.status.disabled &&
      edges.size > 0 &&
      [...edges.values()].every(
        (edge) =>
          edge.registration.updates?.policy === 'stable' &&
          edge.waitForRuntime &&
          edge.admissionBarrier &&
          edge.ready
      )
    )
  }

  function automaticBlockers(state: z.infer<typeof InspectionSchema>) {
    const reasons = [...state.blockers]
    if (!automaticEnabled())
      reasons.push('All connected clients must opt in and support waiting through runtime switches')
    if (hookFault || hooks?.pending) reasons.push('Lifecycle events are awaiting durable delivery')
    if (!state.autoBlockers) reasons.push('Hub cannot verify automatic switch readiness')
    else reasons.push(...state.autoBlockers)
    if (state.idleForMs === undefined || state.idleForMs < AUTOMATIC_IDLE_MS)
      reasons.push('Waiting for five seconds without active work')
    return reasons
  }

  // Reuse the existing lease heartbeat; do no artifact or readiness work without
  // a staged candidate. A busy Hub is never gated while waiting for an idle gap.
  async function maybeActivateAutomatically() {
    if (
      automaticChecking ||
      closing ||
      transitioning ||
      !automaticEnabled() ||
      updates?.status.checking ||
      journal.phase !== 'committed' ||
      performance.now() < automaticRetryAt
    )
      return
    const candidate = updates?.status.candidate
    if (
      !candidate ||
      !newerVersion(candidate.version, journal.active.version) ||
      journal.failedBundles.includes(candidate.bundle)
    )
      return
    automaticChecking = true
    try {
      if (activationBlockers(candidate, true).length) return
      const state = await inspect()
      if (state.gated || automaticBlockers(state).length) return
      automaticRetryAt = performance.now() + AUTOMATIC_RETRY_MS
      const result = await update(candidate.entry, candidate, true)
      automaticError = result.status === 'activated' ? undefined : result.reason
    } catch (error) {
      automaticRetryAt = performance.now() + AUTOMATIC_RETRY_MS
      automaticError = String(error).slice(0, 2000)
    } finally {
      automaticChecking = false
    }
  }

  function persist(next: Journal) {
    lifetime.signal.throwIfAborted()
    const value = { ...next, revision: journal.revision + 1 }
    writeJournal(config.root, value)
    journal = value
  }
  function requireHub() {
    if (closing || !hub || !lease)
      throw unavailable('The Hub is switching or recovering; no call was dispatched.')
    return hub
  }
  function inspect(timeout = 5000) {
    return requireHub().request({ method: 'tempad/runtime-inspect' }, InspectionSchema, {
      timeout
    })
  }
  async function gate(closed: boolean, timeout = 5000) {
    if (!closed && (hookFault || hooks?.pending))
      throw unavailable(
        `Lifecycle delivery remains uncertain: ${hookFault ?? 'hooks remain queued'}`
      )
    return requireHub().request(
      { method: 'tempad/runtime-gate', params: { closed } },
      InspectionSchema,
      { timeout }
    )
  }
  function publish() {
    writeFileSync(
      join(config.root, 'supervisor.json'),
      JSON.stringify({ pid: process.pid, entry: config.entry, bundle: config.bundle, ...lease }),
      { mode: 0o600 }
    )
  }
  async function ensureHooks() {
    hooks ??= await startHookGateway(
      config.root,
      (input, admittedHubId) =>
        requireHub().request(
          { method: 'tempad/runtime-hook', params: { input, admittedHubId } },
          ResultSchema,
          {
            timeout: 5000
          }
        ),
      (error) => {
        const recovering = !!hookFault
        hookFault = error === undefined ? undefined : String(error)
        if (hookFault || (recovering && !transitioning)) void gate(!!hookFault).catch(() => {})
      },
      config.directories ? SOCK_PATH : runtimeEndpoint(paths.runtime, 'mcp.sock'),
      async () => {
        await requireHub().request({ method: 'tempad/runtime-retire-legacy-hooks' }, ResultSchema, {
          timeout: 5000,
          signal: lifetime.signal
        })
      },
      lifetime.signal
    )
    hooks.setReceiver(lease!.hubId)
  }

  async function waitForExit(pid: number, timeout = 15_000) {
    const deadline = performance.now() + timeout
    while (alive(pid)) {
      if (performance.now() >= deadline)
        throw new Error('The old Hub is still alive. Its writer ownership will not be replaced.')
      await pause(50)
    }
  }
  async function waitForWriters() {
    const deadline = performance.now() + HUB_LOCK_STALE_MS + 5000
    const writerLocks = [
      [join(paths.runtime, 'hub.lock'), undefined],
      [paths.state, join(paths.state, '.tempad-hub-writer.lock')],
      [paths.assets, join(paths.assets, '.tempad-hub-writer.lock')]
    ] as const
    while (true) {
      let locked = false
      for (const [path, lockfilePath] of writerLocks) {
        if (
          existsSync(path) &&
          (await lockfile.check(path, {
            stale: HUB_LOCK_STALE_MS,
            ...(lockfilePath ? { lockfilePath } : {})
          }))
        )
          locked = true
      }
      if (!locked) return
      if (performance.now() >= deadline)
        throw new Error('Hub writer locks remain owned; runtime recovery is deferred.')
      await pause(200)
    }
  }

  async function connectHub(
    artifact: Artifact,
    allowLaunch = true,
    deadline = performance.now() + RECOVER_MS
  ) {
    if (closing) throw unavailable('Runtime supervisor is closing.')
    let socket
    try {
      socket = await connectSocket(hubSocketPath(config.root, paths.runtime), lifetime.signal)
    } catch (error) {
      if (!isSocketPending(error) && !unavailableSocket(error)) throw error
      const presentEndpoint =
        isSocketPending(error) || (error as NodeJS.ErrnoException).code === 'EBUSY'
      const identityPath = join(paths.runtime, 'hub-runtime.json')
      const identity = existsSync(identityPath)
        ? parseHubRuntimeIdentity(JSON.parse(readFileSync(identityPath, 'utf8')))
        : undefined
      const liveIdentity = identity && alive(identity.processId)
      if (
        identity === null ||
        (liveIdentity &&
          (identity.packageVersion !== artifact.version ||
            dirname(identity.entryPath) !== dirname(artifact.entry))) ||
        (pendingHub && !pendingHub.exited && pendingHub.artifact.bundle !== artifact.bundle)
      )
        throw new Error('Hub process ownership is uncertain; no replacement was started.', {
          cause: error
        })
      if (!liveIdentity && !presentEndpoint && (!pendingHub || pendingHub.exited)) {
        if (!allowLaunch) throw error
        await waitForWriters()
        lifetime.signal.throwIfAborted()
        const pending = { artifact, child: launch(config, 'hub', artifact), exited: false }
        pendingHub = pending
        const exited = () => {
          pending.exited = true
        }
        pending.child.once('exit', exited)
        pending.child.once('error', exited)
      }
      const path = hubSocketPath(config.root, paths.runtime)
      const remaining = deadline - performance.now()
      socket =
        pendingHub && !pendingHub.exited
          ? await waitForLaunchedSocket(path, pendingHub.child, lifetime.signal, remaining)
          : await waitForSocket(
              path,
              lifetime.signal,
              remaining,
              liveIdentity ? identity.processId : undefined
            )
    }
    const peer = new ControlPeer()
    peer.onerror = () => void peer.close()
    try {
      await peer.connect(new SocketTransport(socket))
      const acquired = await peer.request(
        {
          method: 'tempad/runtime-acquire',
          params: { secret: config.secret, versions: [...CONTROL_VERSIONS] }
        },
        LeaseSchema,
        { timeout: 5000 }
      )
      const observed = await peer.request({ method: 'tempad/runtime-inspect' }, InspectionSchema, {
        timeout: 5000
      })
      const identity = parseHubRuntimeIdentity(
        JSON.parse(readFileSync(join(paths.runtime, 'hub-runtime.json'), 'utf8'))
      )
      if (
        !identity ||
        identity.processId !== acquired.hubPid ||
        dirname(identity.entryPath) !== dirname(artifact.entry) ||
        observed.version !== artifact.version ||
        fingerprintBundle(artifact.entry) !== artifact.bundle
      )
        throw new Error('The running Hub does not match the verified local artifact.')
      lifetime.signal.throwIfAborted()
      pendingHub = undefined
      hub = peer
      lease = acquired
      startRenewal()
      await ensureHooks()
      publish()
      peer.onclose = () => {
        if (hub !== peer) return
        hub = undefined
        if (closing || transitioning) return
        if (!edges.size) void close()
        else
          void recover().catch((error) => {
            process.stderr.write(`Runtime recovery failed: ${String(error)}\n`)
            void close()
          })
      }
    } catch (error) {
      await peer.close()
      // A failed startup can close its control pipe before its process exits
      // (for example, after WebSocket binding fails). Keep ownership until the
      // launched child has exited, within the original startup recovery budget.
      const starting = pendingHub
      while (
        starting?.artifact.bundle === artifact.bundle &&
        !starting.exited &&
        performance.now() < deadline
      ) {
        if (starting.child.exitCode != null || starting.child.signalCode != null)
          starting.exited = true
        else await pause(50)
      }
      throw error
    }
  }

  function startRenewal() {
    if (timer) return
    timer = setInterval(() => {
      if (renewing || !hub) return
      renewing = true
      const connection = hub
      void connection
        .request({ method: 'tempad/runtime-renew' }, ResultSchema, { timeout: RENEW_MS })
        .catch(() => connection.close())
        .finally(() => {
          renewing = false
          void maybeActivateAutomatically()
        })
    }, RENEW_MS)
  }

  async function register(edge: Edge) {
    const connection = requireHub()
    const current = lease!
    await connection.request(
      { method: 'tempad/runtime-register', params: edge.registration },
      ResultSchema,
      { timeout: 5000 }
    )
    if (connection !== hub) throw unavailable()
    return {
      ...current,
      version: negotiate(edge.registration.versions),
      supervisorPid: process.pid
    }
  }
  async function reattach() {
    await Promise.all(
      [...edges].map(async ([peer, edge]) => {
        edge.ready = false
        edge.error = undefined
        try {
          const grant = await register(edge)
          await peer.notification({
            method: 'notifications/tempad/runtime-replaced',
            params: grant
          })
        } catch (error) {
          if (edges.has(peer)) throw error
        }
      })
    )
    const deadline = performance.now() + 15_000
    while ([...edges.values()].some((edge) => !edge.ready)) {
      if (closing) throw unavailable('Runtime supervisor is closing.')
      const failure = [...edges.values()].find((edge) => edge.error)?.error
      if (failure) throw new Error(failure)
      if (performance.now() >= deadline)
        throw new Error('An edge could not verify the replacement runtime.')
      await pause(25)
    }
  }
  async function drain(automatic = false) {
    const observed = await inspect()
    const deadline = Math.min(Date.now() + 330_000, observed.deadline)
    const remaining = () => {
      const value = deadline - Date.now()
      if (value <= 0) throw unavailable('Runtime drain deadline expired; switching is deferred.')
      return Math.min(5000, value)
    }
    await pauseEdges(deadline)
    const state = await gate(true, remaining())
    remaining()
    if (automatic) {
      const reasons = automaticBlockers(state)
      if (!state.drained || reasons.length)
        throw new Error(`Automatic runtime switch deferred: ${reasons.join(', ')}.`)
      return
    }
    let current = state
    while (!current.drained) {
      if (
        current.blockers.includes('Claude binding without receipt/retry hooks') ||
        Date.now() >= deadline
      )
        throw new Error(`Runtime switch deferred: ${current.blockers.join(', ')}.`)
      await pause(50)
      current = await inspect(remaining())
    }
    remaining()
  }

  async function pauseEdges(deadline: number) {
    if ([...edges.values()].some((edge) => !edge.admissionBarrier))
      throw new Error('Restart an older MCP client before switching its runtime safely.')
    const failed = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, failed.signal])
    await Promise.allSettled(
      [...edges.keys()].map(async (peer) => {
        const hubId = lease!.hubId
        pausedEdges.set(peer, hubId)
        try {
          const remaining = deadline - Date.now()
          if (remaining <= 0) throw unavailable('Runtime admission barrier deadline expired.')
          await peer.request(
            { method: 'tempad/runtime-admission', params: { hubId, paused: true } },
            ResultSchema,
            { timeout: remaining, signal }
          )
        } catch (error) {
          if (edges.has(peer)) failed.abort(error)
        }
      })
    )
    lifetime.signal.throwIfAborted()
    failed.signal.throwIfAborted()
  }

  async function resumeEdges() {
    const pending = [...pausedEdges]
    pausedEdges.clear()
    await Promise.all(
      pending.map(async ([peer, hubId]) => {
        // A verified replacement or a new control registration releases its own
        // pause. Only a still-connected old backend needs this abort-path resume.
        if (!edges.has(peer) || hubId !== lease?.hubId) return
        try {
          await peer.request(
            { method: 'tempad/runtime-admission', params: { hubId, paused: false } },
            ResultSchema,
            { timeout: 5000, signal: lifetime.signal }
          )
        } catch {
          // A lost resume reply must recover through a fresh verified registration.
          await peer.close()
        }
      })
    )
  }
  async function stopHub(automatic = false) {
    const current = lease!
    await requireHub().request(
      {
        method: 'tempad/runtime-stop',
        ...(automatic ? { params: { automatic: true } } : {})
      },
      ResultSchema,
      { timeout: 5000 }
    )
    await waitForExit(current.hubPid)
    hub = undefined
    await waitForWriters()
  }

  async function recoverHub(artifact: Artifact) {
    const deadline = performance.now() + RECOVER_MS
    while (true) {
      try {
        await connectHub(artifact, true, deadline)
        return
      } catch (error) {
        const identityPath = join(paths.runtime, 'hub-runtime.json')
        const identity = existsSync(identityPath)
          ? parseHubRuntimeIdentity(JSON.parse(readFileSync(identityPath, 'utf8')))
          : undefined
        // Retry a failed startup only after its process has exited. Never race
        // an unknown writer, change ports, or execute a changed local artifact.
        if (
          closing ||
          performance.now() >= deadline ||
          (existsSync(identityPath) && (!identity || alive(identity.processId))) ||
          fingerprintBundle(artifact.entry) !== artifact.bundle
        )
          throw error
        await pause(200)
      }
    }
  }

  async function activate(candidate: Artifact, automatic = false) {
    if (candidate.release) {
      const blockers = activationBlockers(candidate, automatic)
      if (blockers.length) throw new Error(blockers.join('; '))
    }
    await drain(automatic)
    persist({
      ...journal,
      phase: 'preparing',
      candidate,
      failure: undefined,
      oldHub: { id: lease!.hubId, pid: lease!.hubPid }
    })
    await stopHub(automatic)
    persist({ ...journal, phase: 'old-stopped' })
    await connectHub(candidate)
    persist({ ...journal, phase: 'candidate-ready' })
    await finishHandoff()
  }

  async function finishHandoff() {
    await reattach()
    await hooks?.flush()
    if (journal.candidate?.release && journal.phase !== 'committed') {
      const blockers = journal.coldStart
        ? coldCompatibilityReasons(
            releaseManifest(journal.active),
            releaseManifest(journal.candidate)
          )
        : activationBlockers(journal.candidate)
      if (blockers.length) throw new Error(blockers.join('; '))
    }
    if (journal.phase !== 'committed')
      persist({
        ...journal,
        phase: 'committed',
        coldStart: undefined,
        ...(journal.candidate
          ? {
              previous:
                journal.candidate.bundle === journal.active.bundle
                  ? journal.previous
                  : journal.active,
              active: journal.candidate,
              candidate: undefined,
              failure: undefined
            }
          : {}),
        oldHub: undefined
      })
    await gate(false)
    await resumeEdges()
  }

  async function rollback(error: unknown) {
    journal = (await readJournalAsync(config.root)) ?? journal
    const failed = journal.candidate ?? journal.active
    const fallback =
      journal.phase === 'committed' || journal.candidate?.bundle === journal.active.bundle
        ? journal.previous
        : journal.active
    if (!fallback) throw error
    if (hub && lease && alive(lease.hubPid)) {
      await drain()
      await stopHub()
    }
    const ownershipFailure = (cause = error) =>
      new Error('Hub process ownership is uncertain; the interrupted handoff remains gated.', {
        cause
      })
    if ((pendingHub && !pendingHub.exited) || (lease && alive(lease.hubPid)))
      throw ownershipFailure()
    const identityPath = join(paths.runtime, 'hub-runtime.json')
    const identity = existsSync(identityPath)
      ? parseHubRuntimeIdentity(JSON.parse(readFileSync(identityPath, 'utf8')))
      : undefined
    if (identity === null || (identity && alive(identity.processId))) throw ownershipFailure()
    let present
    try {
      present = await connectSocket(hubSocketPath(config.root, paths.runtime), lifetime.signal)
    } catch (cause) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((cause as NodeJS.ErrnoException).code ?? ''))
        throw ownershipFailure(cause)
    }
    if (present) {
      present.destroy()
      throw ownershipFailure()
    }
    persist({
      ...journal,
      phase: 'old-stopped',
      coldStart: undefined,
      active: fallback,
      candidate: undefined,
      previous: undefined,
      oldHub: undefined,
      failedBundles: [...new Set([...journal.failedBundles, failed.bundle])],
      failure: String(error)
    })
    await recoverHub(fallback)
    await finishHandoff()
  }

  async function recover() {
    if (transitioning) return
    transitioning = true
    let observedPid: number | undefined
    try {
      // Managed staging belongs to updates.json. Older supervisors also copied
      // it here before drain; that copy cannot authorize or preserve an offer.
      if (updates && journal.phase === 'committed' && journal.candidate)
        persist({ ...journal, candidate: undefined })
      const identityPath = join(paths.runtime, 'hub-runtime.json')
      const identity = existsSync(identityPath)
        ? parseHubRuntimeIdentity(JSON.parse(readFileSync(identityPath, 'utf8')))
        : undefined
      if (identity && alive(identity.processId)) {
        observedPid = identity.processId
        const candidates = [journal.active, journal.candidate, journal.previous].filter(
          (value): value is Artifact => !!value
        )
        const artifact = candidates.find(
          (value) =>
            value.version === identity.packageVersion &&
            dirname(value.entry) === dirname(identity.entryPath)
        )
        if (!artifact) throw new Error('An unknown Hub still owns this runtime.')
        // Socket closure can precede process exit. Reattaching must never
        // silently relaunch that artifact and bypass the crash rollback path.
        if (!hub?.transport || lease?.hubPid !== identity.processId)
          await connectHub(artifact, false)
        if (journal.phase === 'preparing' && artifact.bundle === journal.active.bundle) {
          persist({
            ...journal,
            phase: 'committed',
            candidate: updates ? undefined : journal.candidate,
            oldHub: undefined,
            failure:
              'The supervisor stopped before the old Hub exited; the active runtime was retained.'
          })
        } else if (artifact.bundle !== journal.active.bundle) {
          persist({ ...journal, phase: 'candidate-ready' })
        }
      } else {
        if (journal.phase === 'committed' && identity && journal.previous) {
          await rollback(new Error('The active Hub exited unexpectedly.'))
          return
        }
        const candidate =
          journal.candidate &&
          !journal.failedBundles.includes(journal.candidate.bundle) &&
          journal.phase !== 'committed'
            ? journal.candidate
            : journal.active
        if (journal.phase !== 'committed') persist({ ...journal, phase: 'old-stopped' })
        await recoverHub(candidate)
        if (journal.phase !== 'committed') persist({ ...journal, phase: 'candidate-ready' })
      }
      await finishHandoff()
    } catch (error) {
      if (journal.phase !== 'committed' && journal.candidate) await rollback(error)
      else if (observedPid && journal.previous) {
        await waitForExit(observedPid)
        await rollback(error)
      } else throw error
    } finally {
      await resumeEdges()
      transitioning = false
      updates?.schedule()
    }
  }

  async function update(entry: string, released?: Artifact, automatic = false) {
    if (transitioning) throw unavailable('Another runtime transition is in progress.')
    if (updates?.status.checking)
      throw unavailable('Wait for release acquisition to finish before activating.')
    if (journal.phase !== 'committed')
      throw unavailable(
        'An interrupted handoff must finish through --recover-runtime before offering another version.'
      )
    transitioning = true
    updates?.schedule()
    try {
      await requireHub().request(
        { method: 'tempad/runtime-retain', params: { retained: true } },
        ResultSchema
      )
      if ([...edges.values()].some((edge) => !edge.supportsReplacement || !edge.admissionBarrier))
        throw new Error(
          'An attached edge has not confirmed safe backend replacement support; wait for initialization or restart an older MCP client before switching.'
        )
      if (config.release && !released)
        throw new Error('Managed releases accept only a verified staged npm artifact.')
      if (released) verifyReleaseArtifact(released)
      const candidate = released
        ? { artifact: released, contract: undefined }
        : await probeArtifact(entry)
      if (!newerVersion(candidate.artifact.version, journal.active.version))
        throw new Error('Only a newer stable local runtime can be offered.')
      if (journal.failedBundles.includes(candidate.artifact.bundle))
        throw new Error('This runtime bundle is quarantined after a failed activation.')
      if (!released) {
        const active = await probeArtifact(journal.active.entry)
        if (candidate.contract !== active.contract)
          throw new Error(
            'The local candidate changes the frozen MCP contract; restart MCP instead.'
          )
      }
      if (!updates) persist({ ...journal, candidate: candidate.artifact, failure: undefined })
      try {
        await activate(candidate.artifact, automatic)
      } catch (error) {
        journal = (await readJournalAsync(config.root)) ?? journal
        // A definite pre-shutdown refusal leaves the original writer intact.
        // Reopen it instead of draining newly arrived work for a rollback.
        const originalRetained =
          automatic &&
          journal.phase === 'preparing' &&
          isRuntimeUnavailable(error) &&
          journal.oldHub?.id === lease?.hubId &&
          hub?.transport
        if (
          (journal.phase === 'committed' && journal.active.bundle !== candidate.artifact.bundle) ||
          originalRetained
        ) {
          persist({
            ...journal,
            phase: 'committed',
            candidate: updates ? undefined : journal.candidate,
            oldHub: undefined,
            failure: String(error)
          })
          await gate(false)
          return { status: 'staged', reason: String(error) }
        }
        await rollback(error)
        return { status: 'rolled-back', reason: String(error) }
      }
      return { status: 'activated', version: journal.active.version }
    } finally {
      await resumeEdges()
      transitioning = false
      await hub
        ?.request({ method: 'tempad/runtime-retain', params: { retained: false } }, ResultSchema)
        .catch(() => {})
      updates?.schedule()
    }
  }

  const server = createServer((socket) => {
    if (peers.size >= 128) {
      socket.destroy()
      return
    }
    const peer = new ControlPeer()
    peers.add(peer)
    const timeout = setTimeout(() => void peer.close(), 5000)
    peer.onerror = () => void peer.close()
    peer.onclose = () => {
      clearTimeout(timeout)
      peers.delete(peer)
      edges.delete(peer)
      updates?.schedule()
    }
    peer.setRequestHandler(
      z.object({ method: z.literal('tempad/runtime-hello'), params: RegistrationSchema }),
      async ({ params }) => {
        if (edges.has(peer)) throw new Error('A runtime connection can register only once.')
        if (transitioning) throw unavailable('Runtime handoff in progress; retry attachment.')
        if (
          config.release &&
          params.updates?.policy === 'pinned' &&
          (params.updates?.version !== journal.active.version ||
            params.updates?.manifestHash !== journal.active.release?.manifestHash)
        )
          throw new Error(
            'MCP_RUNTIME_RESTART_REQUIRED: this pinned client requests a different runtime; update/restart MCP or explicitly enroll it.'
          )
        const edge = { registration: params, ready: false }
        edges.set(peer, edge)
        const grant = await register(edge)
        clearTimeout(timeout)
        updates?.schedule()
        return grant
      }
    )
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-ready'),
        params: z.object({
          hubId: z.uuid(),
          error: z.string().optional(),
          waitForRuntime: z.literal(true).optional(),
          admissionBarrier: z.literal(true).optional()
        })
      }),
      ({ params }) => {
        const edge = edges.get(peer)
        if (!edge || params.hubId !== lease?.hubId)
          throw unavailable('Stale runtime readiness acknowledgment.')
        edge.error = params.error
        edge.ready = !params.error
        edge.supportsReplacement = true
        edge.waitForRuntime = params.waitForRuntime === true
        edge.admissionBarrier = params.admissionBarrier === true
        return {}
      }
    )
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-refresh') }), async () => {
      const edge = edges.get(peer)
      if (!edge) throw unavailable('Runtime session is not registered.')
      return register(edge)
    })
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-status') }), async () => {
      clearTimeout(timeout)
      const state = hub ? await inspect().catch(() => undefined) : undefined
      return {
        ...(state ?? { gated: true, unavailable: 'Hub recovery has not completed.' }),
        ...lease,
        supervisorPid: process.pid,
        phase: journal.phase,
        active: journal.active,
        candidate: journal.candidate,
        failure: journal.failure,
        hookFault,
        legacyHookWarning: hooks?.legacyExhausted
          ? 'Legacy lifecycle history is full. Update the TemPad Dev plugin to restore Claude lifecycle support.'
          : undefined,
        controlComponents: controlComponentStatus(
          PACKAGE_VERSION,
          [...edges.values()].map((edge) => edge.registration),
          [journal.active, journal.candidate, updates?.status.candidate]
            .filter(
              (artifact): artifact is Artifact =>
                !!artifact && !journal.failedBundles.includes(artifact.bundle)
            )
            .map((artifact) => artifact.version)
        ),
        updates: updates
          ? {
              ...updates.status,
              automaticActivation: automaticEnabled(),
              automaticError,
              automaticPendingReasons: updates.status.candidate
                ? [
                    ...activationBlockers(updates.status.candidate, true),
                    ...(state ? automaticBlockers(state) : ['Hub recovery has not completed.'])
                  ]
                : [],
              pendingReasons: updates.status.candidate
                ? activationBlockers(updates.status.candidate)
                : []
            }
          : undefined
      }
    })
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-check'),
        params: z.object({ version: z.string() }).strict()
      }),
      async ({ params }) => {
        if (!updates)
          throw new Error('Release acquisition is unavailable in isolated/local runtimes.')
        if (transitioning) throw unavailable('Runtime handoff in progress.')
        clearTimeout(timeout)
        const candidate = await updates.check(params.version, true)
        return {
          candidate,
          selection: updates.status.selection,
          automaticActivation: automaticEnabled(),
          pendingReasons: candidate ? activationBlockers(candidate) : []
        }
      }
    )
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-activate'),
        params: z.object({ version: z.string(), integrity: z.string() }).strict()
      }),
      async ({ params }) => {
        const candidate = updates?.status.candidate
        if (
          !candidate ||
          candidate.version !== params.version ||
          candidate.release?.integrity !== params.integrity
        )
          throw new Error(
            'The staged artifact changed; check and confirm its version and integrity again.'
          )
        clearTimeout(timeout)
        const blockers = activationBlockers(candidate)
        if (blockers.length) return { status: 'staged', reasons: blockers }
        return update(candidate.entry, candidate)
      }
    )
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-recover') }), async () => {
      if (transitioning) throw unavailable('Another runtime transition is in progress.')
      clearTimeout(timeout)
      await recover()
      return { status: 'recovered', version: journal.active.version }
    })
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-update'),
        params: z.object({ entry: z.string() }).strict()
      }),
      async ({ params }) => {
        clearTimeout(timeout)
        return update(params.entry)
      }
    )
    void peer.connect(new SocketTransport(socket)).catch(() => void peer.close())
  })
  async function close() {
    if (closing) return
    closing = true
    updates?.close()
    lifetime.abort()
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    clearInterval(timer)
    server.close()
    await Promise.allSettled([...peers].map((peer) => peer.close()))
    await hooks?.close()
    await hub?.close()
    cleanupEndpoint(socketPath)
    rmSync(join(config.root, 'supervisor.json'), { force: true })
    await unlock()
  }
  try {
    persist(journal)
    ensureDir(paths.runtime)
    await recover()
    cleanupEndpoint(socketPath)
    await listenPrivate(server, socketPath, lifetime.signal)
    publish()
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  } catch (error) {
    await close()
    throw error
  }
}
