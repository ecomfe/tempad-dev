import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  CLIENT_HOOK_RETENTION_MS,
  ClientHookParamsSchema,
  type ClientHook
} from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { RuntimeManifest } from '../src/runtime-update/manifest'

const fake = vi.hoisted(() => ({ launch: vi.fn(), probe: vi.fn() }))
vi.mock('../src/runtime-prototype/probe', () => ({ probeArtifact: fake.probe }))
vi.mock('../src/runtime-prototype/processes', async (load) => ({
  ...(await load<typeof import('../src/runtime-prototype/processes')>()),
  launch: fake.launch
}))
import { captureHostContext } from '../src/agent-clients/host-context'
import { AgentClients } from '../src/agent-clients/registry'
import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { writeDurableJson } from '../src/durable-json'
import { HOOK_RECEIPT_LIMIT } from '../src/hook-receipts'
import { createHubRuntimeIdentity, writeHubRuntimeIdentity } from '../src/runtime-identity'
import { cleanupEndpoint, runtimeEndpoint } from '../src/runtime-platform'
import * as processes from '../src/runtime-prototype/processes'
import {
  connectSocket,
  fingerprintBundle,
  hubSocketPath,
  listenPrivate,
  prototypeConfig,
  supervisorSocketPath
} from '../src/runtime-prototype/processes'
import {
  ControlPeer,
  GrantSchema,
  RECOVER_MS,
  SocketTransport,
  unavailable
} from '../src/runtime-prototype/protocol'
import { readJournal, type Artifact } from '../src/runtime-prototype/state'
import * as journalState from '../src/runtime-prototype/state'
import { startSupervisor } from '../src/runtime-prototype/supervisor'
import * as releaseArtifacts from '../src/runtime-update/artifact'
import * as releaseAcquisition from '../src/runtime-update/manager'
import { PACKAGE_VERSION } from '../src/shared'

const platformModule = '../scripts/runtime-test-platform.mjs'
const { fixtureRoot } = await import(platformModule)
// Real Windows pipe/ACL helpers run throughout each handoff. Unlike the former
// synchronous helpers, they let SDK timers fire, so observe the runtime's recovery
// budget rather than the short Unix fixture budget. Product drain limits stay intact.
const transitionTimeout = process.platform === 'win32' ? RECOVER_MS : 10_000
const recoveryWait = process.platform === 'win32' ? RECOVER_MS : 5000
if (process.platform === 'win32') vi.setConfig({ testTimeout: 2 * RECOVER_MS })

it.each(['EPIPEUNPROTECTED', 'ETIMEDOUT', 'EBUSY', 'ENOENT'])(
  'waits for an existing Hub after %s instead of launching a replacement',
  async (code) => {
    vi.spyOn(processes, 'connectSocket').mockRejectedValueOnce(
      Object.assign(new Error('Endpoint not ready'), { code })
    )
    await fixture()
    expect(fake.launch).not.toHaveBeenCalled()
  }
)

function endpointClosed(path: string) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = connect(path)
    let closed = false
    let failure: Error | undefined
    socket.once('connect', () => socket.destroy())
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '')) closed = true
      else if (error.code !== 'EBUSY') failure = error
    })
    socket.once('close', () => (failure ? reject(failure) : resolve(closed)))
  })
}

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  vi.restoreAllMocks()
  vi.clearAllMocks()
  if (failures.length) throw new AggregateError(failures, 'Runtime fixture cleanup failed.')
})

async function fixture(
  hook?: (input: ClientHook, fresh: boolean) => Record<string, unknown>,
  automatic = false,
  initial?: { phase: 'committed' | 'preparing'; staged?: boolean },
  beforeStart?: (root: string) => void
) {
  const root = await fixtureRoot('tp-switch-test-')
  await mkdir(join(root, 'run'), { mode: 0o700 })
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const artifact = async (version: string): Promise<Artifact> => {
    const directory = join(root, version)
    await mkdir(directory)
    const entry = join(directory, 'runtime.mjs')
    await writeFile(entry, `export const version = '${version}'`)
    return { version, entry, bundle: fingerprintBundle(entry) }
  }
  const a = await artifact(PACKAGE_VERSION)
  const [major, minor, patch] = PACKAGE_VERSION.split('.').map(Number)
  const b = await artifact(`${major}.${minor}.${patch! + 1}`)
  const config = prototypeConfig(root, a.entry)
  if (automatic) {
    a.release = { directory: root, manifestHash: 'a'.repeat(64) }
    b.release = { directory: root, manifestHash: 'b'.repeat(64), integrity: 'verified' }
    config.release = a.release
    vi.spyOn(releaseAcquisition, 'acquireRelease').mockResolvedValue({ candidate: b })
    vi.spyOn(releaseArtifacts, 'verifyReleaseArtifact').mockImplementation((artifact) =>
      releaseArtifacts.releaseManifest(artifact)
    )
    vi.spyOn(releaseArtifacts, 'releaseManifest').mockImplementation(
      (artifact) =>
        ({
          packageVersion: artifact.version,
          wireHash: 'a'.repeat(64),
          guidanceEpoch: 1,
          node: '>=22',
          platforms: ['darwin', 'linux', 'win32'],
          controlProtocols: [2],
          state: { family: 'test', reads: [1], writes: 1 },
          extension: { legacy: true, protocols: [1] }
        }) as RuntimeManifest
    )
  }
  const live = new Set<number>()
  const exiting = new Set<number>()
  const originalKill = process.kill.bind(process)
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid >= 900001 && pid <= 900100) {
      if (exiting.delete(pid)) return true
      if (live.has(pid)) return true
      throw Object.assign(new Error('exited'), { code: 'ESRCH' })
    }
    return originalKill(pid, signal)
  })
  let nextPid = 900001
  let drained = true
  let blocker = 'work'
  let peerFailure = false
  let autoBlockers: string[] | undefined = ['Acceptance not ready']
  let idleForMs = 5000
  let busyOnGate = false
  let refuseStop = false
  let beforeStop: (() => Promise<void>) | undefined
  let attachedSessions: string[] = []
  let refuseCandidateOpen = false
  let onPause: ((signal: AbortSignal) => Promise<void>) | undefined
  const admissions: boolean[] = []
  const retireLegacy = vi.fn(() => ({}))
  const hubs: { pid: number; stop: (exiting?: boolean) => Promise<void>; artifact: Artifact }[] = []
  const launches = new Set<Promise<void>>()
  const launchFailures: unknown[] = []
  let shutdown: (signal: NodeJS.Signals) => void = () => {}
  cleanups.push(async () => {
    shutdown('SIGTERM')
    while (launches.size) await Promise.all(launches)
    await Promise.all(hubs.map((hub) => hub.stop()))
    expect(launchFailures).toEqual([])
  })
  async function start(artifact: Artifact) {
    const pid = nextPid++
    const id = randomUUID()
    let gated = false
    live.add(pid)
    cleanupEndpoint(hubSocketPath(root))
    writeHubRuntimeIdentity(
      join(root, 'run/hub-runtime.json'),
      createHubRuntimeIdentity(artifact.entry, artifact.version, { processId: pid })
    )
    const sockets = new Set<Socket>()
    let stopping: Promise<void> | undefined
    const stop = (socketClosesFirst = false) =>
      (stopping ??= (async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        // A real exited process cannot still own its listening pipe.
        live.delete(pid)
        if (socketClosesFirst) exiting.add(pid)
      })())
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      const peer = new ControlPeer()
      peer.onerror = () => {}
      peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-acquire') }), () => ({
        version: 2,
        generation: 1,
        hubId: id,
        hubPid: pid
      }))
      const status = () => ({
        drained,
        deadline: Date.now() + (drained ? 10000 : -1),
        blockers: drained ? [] : [blocker],
        version: artifact.version,
        gated,
        handoffVersion: 1,
        attachedSessions,
        ...(automatic ? { autoBlockers, idleForMs } : {})
      })
      peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-inspect') }), () => {
        return status()
      })
      peer.setRequestHandler(
        z.object({
          method: z.literal('tempad/runtime-gate'),
          params: z.object({ closed: z.boolean() })
        }),
        ({ params }) => {
          if (!params.closed && refuseCandidateOpen && artifact.bundle === b.bundle)
            throw unavailable('Candidate could not reopen after commit.')
          gated = params.closed
          if (gated && busyOnGate) drained = false
          return status()
        }
      )
      peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-stop') }), async () => {
        await beforeStop?.()
        if (refuseStop) throw unavailable('Late activity; shutdown was not admitted.')
        setTimeout(() => void stop(), 5)
        return {}
      })
      peer.setRequestHandler(
        z.object({ method: z.literal('tempad/runtime-retire-legacy-hooks') }),
        retireLegacy
      )
      if (hook)
        peer.setRequestHandler(
          z.object({
            method: z.literal('tempad/runtime-hook'),
            params: z.object({ input: ClientHookParamsSchema, admittedHubId: z.uuid().optional() })
          }),
          ({ params }) => hook(params.input, params.admittedHubId === id)
        )
      peer.fallbackRequestHandler = async () => ({})
      void peer.connect(new SocketTransport(socket))
    })
    try {
      await listenPrivate(server, hubSocketPath(root))
    } catch (error) {
      await stop()
      throw error
    }
    hubs.push({ pid, stop, artifact })
  }
  fake.launch.mockImplementation((_config, role, value) => {
    if (role !== 'hub') throw new Error('Unexpected supervisor spawn')
    const pending = start(value)
      .catch((error: unknown) => {
        launchFailures.push(error)
      })
      .finally(() => launches.delete(pending))
    launches.add(pending)
    return Object.assign(new EventEmitter(), { unref: () => {} })
  })
  fake.probe.mockImplementation(async (entry) => ({
    artifact: entry === a.entry ? a : b,
    contract: 'identical'
  }))
  await start(a)
  if (initial) {
    journalState.writeJournal(root, {
      version: 1,
      revision: 1,
      phase: initial.phase,
      active: a,
      candidate: initial.phase === 'preparing' || !automatic ? b : undefined,
      failedBundles: []
    })
    if (automatic)
      writeDurableJson(join(root, 'updates.json'), {
        version: 2,
        nextCheck: Date.now() + 60_000,
        failures: 0,
        ...(initial.staged ? { candidate: b } : {})
      })
  }
  beforeStart?.(root)
  const stops = new Set(process.listeners('SIGTERM'))
  await startSupervisor(config)
  shutdown = process.listeners('SIGTERM').find((listener) => !stops.has(listener))!
  const control = new ControlPeer()
  const supervisorPath = supervisorSocketPath(config)
  await control.connect(new SocketTransport(await connectSocket(supervisorPath)))
  cleanups.push(async () => {
    shutdown('SIGTERM')
    await control.close()
    await vi.waitFor(async () => expect(await endpointClosed(supervisorPath)).toBe(true), {
      timeout: 5000
    })
  })
  const edge = new ControlPeer()
  await edge.connect(new SocketTransport(await connectSocket(supervisorPath)))
  cleanups.push(() => edge.close())
  const ready = (hubId: string) =>
    edge.request(
      {
        method: 'tempad/runtime-ready',
        params: {
          hubId,
          ...(peerFailure ? { error: 'Frozen contract mismatch' } : {})
        }
      },
      ResultSchema
    )
  edge.setNotificationHandler(
    z.object({ method: z.literal('notifications/tempad/runtime-replaced'), params: GrantSchema }),
    async ({ params }) => {
      await ready(params.hubId)
      peerFailure = false
    }
  )
  edge.setRequestHandler(
    z.object({
      method: z.literal('tempad/runtime-admission'),
      params: z.object({ paused: z.boolean() })
    }),
    async ({ params }, extra) => {
      admissions.push(params.paused)
      if (params.paused) await onPause?.(extra.signal)
      return {}
    }
  )
  const sessionId = randomUUID()
  const grant = await edge.request(
    {
      method: 'tempad/runtime-hello',
      params: {
        sessionId,
        token: randomUUID(),
        context: captureHostContext({ HOME: root, TMPDIR: root }),
        updates: { policy: 'stable', version: a.version, manifestHash: 'a'.repeat(64) },
        versions: [2]
      }
    },
    GrantSchema
  )
  await ready(grant.hubId)
  if (automatic && !initial)
    await vi.waitFor(
      async () => {
        const state = await control.request({ method: 'tempad/runtime-status' }, ResultSchema)
        expect(state.updates).toMatchObject({ lastAttempt: expect.any(Number), checking: false })
      },
      { timeout: recoveryWait }
    )
  return {
    root,
    config,
    shutdown: () => shutdown('SIGTERM'),
    a,
    b,
    hubs,
    control,
    admissions,
    retireLegacy,
    disconnectBeforeStop: () => {
      beforeStop = async () => {
        // The data connection survived while the paused control peer left during drain.
        attachedSessions = [sessionId]
        await edge.close()
        await control.request({ method: 'tempad/runtime-status' }, ResultSchema)
        refuseStop = true
      }
    },
    pauseWith: (handler: (signal: AbortSignal) => Promise<void>) => {
      onPause = handler
    },
    update: () =>
      control.request(
        { method: 'tempad/runtime-update', params: { entry: b.entry } },
        ResultSchema,
        { timeout: transitionTimeout }
      ),
    status: () => control.request({ method: 'tempad/runtime-status' }, ResultSchema),
    defer: (reason = 'work') => {
      drained = false
      blocker = reason
    },
    rejectCandidate: () => {
      peerFailure = true
    },
    rejectCandidateOpen: () => {
      refuseCandidateOpen = true
    },
    auto: {
      allow: () => {
        autoBlockers = []
      },
      legacyHub: () => {
        autoBlockers = undefined
      },
      recentWork: () => {
        idleForMs = 0
      },
      raceGate: () => {
        busyOnGate = true
      },
      refuseStop: () => {
        refuseStop = true
      },
      unready: async () => {
        peerFailure = true
        await ready(grant.hubId)
      }
    }
  }
}

it('waits for every edge admission barrier before gating or retiring the old Hub', async () => {
  const f = await fixture()
  const barrier = Promise.withResolvers<void>()
  f.pauseWith(() => barrier.promise)
  const update = f.update()
  await vi.waitFor(() => expect(f.admissions).toEqual([true]))
  expect(await f.status()).toMatchObject({ phase: 'committed', active: f.a, gated: false })
  expect(f.hubs).toHaveLength(1)
  barrier.resolve()
  expect(await update).toMatchObject({ status: 'activated', version: f.b.version })
})

it('releases paused edges and keeps the old writer when admission fails', async () => {
  const f = await fixture()
  f.pauseWith(async () => {
    throw new Error('Pause could not be established')
  })
  expect(await f.update()).toMatchObject({ status: 'staged' })
  expect(f.admissions).toEqual([true, false])
  expect(f.hubs).toHaveLength(1)
  expect(await f.status()).toMatchObject({ active: f.a, gated: false })
})

it('does not restart the drain budget after an admission barrier uses it up', async () => {
  const f = await fixture()
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  f.pauseWith(async () => {
    clock.mockReturnValue(now + 10_001)
  })
  expect(await f.update()).toMatchObject({
    status: 'staged',
    reason: expect.stringContaining('drain deadline expired')
  })
  clock.mockRestore()
  expect(f.admissions).toEqual([true, false])
  expect(f.hubs).toHaveLength(1)
  expect(await f.status()).toMatchObject({ active: f.a, gated: false })
})

it('requires successful initialization before switching an attached edge', async () => {
  const f = await fixture()
  await f.auto.unready()
  await expect(f.update()).rejects.toThrow('not finished initialization')
  expect(f.admissions).toEqual([])
  expect(f.hubs).toHaveLength(1)
  expect(fake.probe).not.toHaveBeenCalled()
})

it('reopens an explicitly drained Hub if its data session outlives the paused control peer', async () => {
  const f = await fixture()
  f.disconnectBeforeStop()
  await expect(f.update()).resolves.toMatchObject({
    status: 'staged',
    reason: expect.stringContaining('shutdown was not admitted')
  })
  expect(await f.status()).toMatchObject({ active: f.a, phase: 'committed', gated: false })
  expect(f.hubs).toHaveLength(1)
  expect(fake.launch).not.toHaveBeenCalled()
  expect(readJournal(f.root)).toMatchObject({ phase: 'committed', failedBundles: [] })
})

it('retires exhausted legacy lifecycle evidence before reopening admission and reports the upgrade boundary', async () => {
  const f = await fixture(undefined, false, undefined, (root) => {
    writeDurableJson(join(root, 'hooks.json'), {
      version: 2,
      cutoff: 0,
      entries: Array.from({ length: HOOK_RECEIPT_LIMIT }, () => ({
        input: {
          version: 1,
          invocationId: randomUUID(),
          kind: 'claude',
          sessionId: 'legacy',
          event: 'UserPromptSubmit'
        },
        result: {}
      }))
    })
  })
  expect(f.retireLegacy).toHaveBeenCalledOnce()
  expect(await f.status()).toMatchObject({
    gated: false,
    legacyHookWarning: expect.stringContaining('Update the TemPad Dev plugin')
  })
  expect(await f.status()).not.toHaveProperty('hookFault')
})

it('automatically replaces a compatible idle runtime once', async () => {
  const f = await fixture(undefined, true)
  const writes = vi.spyOn(journalState, 'writeJournal')
  f.auto.allow()
  await vi.waitFor(
    async () => expect(await f.status()).toMatchObject({ active: f.b, gated: false }),
    { timeout: recoveryWait }
  )
  expect(f.hubs.map((hub) => hub.artifact)).toEqual([f.a, f.b])
  expect(readJournal(f.root)).toMatchObject({ phase: 'committed', previous: f.a })
  expect(
    writes.mock.calls.every(([, journal]) => journal.phase !== 'committed' || !journal.candidate)
  ).toBe(true)
})

it('keeps an exact download manual until that artifact is explicitly activated', async () => {
  const f = await fixture(undefined, true, { phase: 'committed' })
  await f.control.request(
    { method: 'tempad/runtime-check', params: { version: f.b.version } },
    ResultSchema
  )
  f.auto.allow()
  await new Promise((resolve) => setTimeout(resolve, 2200))
  expect(await f.status()).toMatchObject({ active: f.a, updates: { manualCandidate: f.b } })
  expect((await f.status()).updates).not.toHaveProperty('candidate')
  expect(
    await f.control.request(
      {
        method: 'tempad/runtime-activate',
        params: { version: f.b.version, integrity: f.b.release!.integrity }
      },
      ResultSchema,
      { timeout: transitionTimeout }
    )
  ).toMatchObject({ status: 'activated', version: f.b.version })
})

it('keeps managed staging out of the switch journal until the old Hub drains', async () => {
  const f = await fixture(undefined, true)
  await f.control.request(
    { method: 'tempad/runtime-check', params: { version: f.b.version } },
    ResultSchema
  )
  const writes = vi.spyOn(journalState, 'writeJournal')
  f.defer()
  expect(
    await f.control.request(
      {
        method: 'tempad/runtime-activate',
        params: { version: f.b.version, integrity: f.b.release!.integrity }
      },
      ResultSchema,
      { timeout: transitionTimeout }
    )
  ).toMatchObject({ status: 'staged' })
  expect(await f.status()).toMatchObject({
    active: f.a,
    gated: false,
    updates: { manualCandidate: f.b }
  })
  expect(readJournal(f.root)?.candidate).toBeUndefined()
  expect(writes.mock.calls.every(([, journal]) => !journal.candidate)).toBe(true)
  expect(f.hubs).toHaveLength(1)
})

it('abandons a prepared managed switch if the original Hub is still running', async () => {
  const f = await fixture(undefined, true, { phase: 'preparing' })
  expect(readJournal(f.root)).toMatchObject({ phase: 'committed', active: f.a })
  expect(readJournal(f.root)?.candidate).toBeUndefined()
  expect(await f.status()).toMatchObject({ active: f.a, gated: false })
  expect((await f.status()).updates).not.toHaveProperty('candidate')
  expect(f.hubs).toHaveLength(1)
  expect(releaseAcquisition.acquireRelease).not.toHaveBeenCalled()
})

it.each([
  { phase: 'committed' as const, managed: false },
  { phase: 'preparing' as const, managed: false },
  { phase: 'committed' as const, managed: true },
  { phase: 'preparing' as const, managed: true }
])(
  'recovers $phase staging in its owning store (managed: $managed)',
  async ({ phase, managed }) => {
    const f = await fixture(undefined, managed, { phase, staged: true })
    expect(readJournal(f.root)).toMatchObject({ phase: 'committed', active: f.a })
    expect(readJournal(f.root)?.candidate).toEqual(managed ? undefined : f.b)
    expect(await f.status()).toMatchObject({
      active: f.a,
      gated: false,
      ...(managed ? { updates: { candidate: f.b } } : { candidate: f.b })
    })
    expect(f.hubs).toHaveLength(1)
  }
)

it('retains a living unverified candidate for explicit recovery instead of launching fallback', async () => {
  const f = await fixture()
  vi.spyOn(processes, 'waitForLaunchedSocket').mockRejectedValueOnce(
    unavailable('Runtime process has not published its endpoint yet.')
  )
  await expect(f.update()).rejects.toThrow('interrupted handoff remains gated')
  expect(fake.launch).toHaveBeenCalledOnce()
  expect(readJournal(f.root)).toMatchObject({
    phase: 'old-stopped',
    active: f.a,
    candidate: f.b,
    failedBundles: []
  })
  await vi.waitFor(() => expect(f.hubs).toHaveLength(2), { timeout: recoveryWait })
  await expect(
    f.control.request({ method: 'tempad/runtime-recover' }, ResultSchema, {
      timeout: transitionTimeout
    })
  ).resolves.toMatchObject({
    status: 'recovered',
    version: f.b.version
  })
  expect(fake.launch).toHaveBeenCalledOnce()
  expect(await f.status()).toMatchObject({ phase: 'committed', active: f.b, gated: false })
})

it('rolls back promptly after its candidate process exits before publishing', async () => {
  const f = await fixture()
  fake.launch.mockImplementationOnce(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('exit', 1, null))
    return child
  })
  expect(await f.update()).toMatchObject({
    status: 'rolled-back',
    reason: expect.stringContaining('exited')
  })
  expect(fake.launch).toHaveBeenCalledTimes(2)
  expect(await f.status()).toMatchObject({ phase: 'committed', active: f.a, gated: false })
  expect(readJournal(f.root)?.failedBundles).toEqual([f.b.bundle])
})

it.each(['event', 'exitCode'] as const)(
  'waits for its failed startup to exit after pipe closure (%s) before rolling back',
  async (evidence) => {
    const f = await fixture()
    const launch = fake.launch.getMockImplementation()!
    let child!: EventEmitter & { exitCode?: number }
    fake.launch.mockImplementationOnce((...args) => (child = launch(...args)))
    const wait = processes.waitForLaunchedSocket
    vi.spyOn(processes, 'waitForLaunchedSocket').mockImplementationOnce(async (...args) => {
      const socket = await wait(...args)
      socket.destroy()
      setTimeout(() => {
        void f.hubs[1]!.stop().then(() => {
          expect(fake.launch).toHaveBeenCalledOnce()
          if (evidence === 'event') child.emit('exit', 1, null)
          else child.exitCode = 1
        })
      }, 50)
      return socket
    })
    expect(await f.update()).toMatchObject({
      status: 'rolled-back',
      reason: expect.stringContaining('Runtime socket is closed')
    })
    expect(fake.launch).toHaveBeenCalledTimes(2)
    expect(await f.status()).toMatchObject({ phase: 'committed', active: f.a, gated: false })
    expect(readJournal(f.root)?.failedBundles).toEqual([f.b.bundle])
  }
)

it.each(['unready', 'legacyHub', 'recentWork'] as const)(
  'keeps serving when automatic readiness is missing: %s',
  async (scenario) => {
    const f = await fixture(undefined, true)
    f.auto.allow()
    await f.auto[scenario]()
    await new Promise((resolve) => setTimeout(resolve, 2200))
    expect(await f.status()).toMatchObject({ active: f.a, gated: false })
    expect(f.hubs).toHaveLength(1)
  }
)

it.each(['raceGate', 'refuseStop'] as const)(
  'reopens the original Hub when work races automatic shutdown: %s',
  async (scenario) => {
    const f = await fixture(undefined, true)
    f.auto.allow()
    f.auto[scenario]()
    await vi.waitFor(
      async () =>
        expect(await f.status()).toMatchObject({
          active: f.a,
          gated: false,
          phase: 'committed',
          failure: expect.any(String)
        }),
      { timeout: recoveryWait }
    )
    expect(f.hubs).toHaveLength(1)
    expect(readJournal(f.root)?.failedBundles).toEqual([])
    expect(readJournal(f.root)?.candidate).toBeUndefined()
    expect(await f.status()).toHaveProperty('updates.candidate', f.b)
  }
)

it('isolates and backs off automatic verification failures', async () => {
  const f = await fixture(undefined, true)
  const verify = vi.spyOn(releaseArtifacts, 'verifyReleaseArtifact').mockImplementation(() => {
    throw new Error('damaged archive')
  })
  f.auto.allow()
  await vi.waitFor(
    async () =>
      expect(await f.status()).toMatchObject({
        active: f.a,
        gated: false,
        updates: { automaticError: expect.stringContaining('damaged archive') }
      }),
    { timeout: 5000 }
  )
  await new Promise((resolve) => setTimeout(resolve, 2200))
  expect(verify).toHaveBeenCalledOnce()
  expect(f.hubs).toHaveLength(1)
})

it('recovers a supervisor with an expired admitted hook without replay or loss of Stop', async () => {
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  let available = false
  let tasks!: DesignTasks
  const applied = vi.fn((input: ClientHook, fresh: boolean) => clients.clientHook(input, fresh))
  const f = await fixture((input, fresh) => {
    if (!available) throw new Error('Hub outcome unavailable after crash')
    return tasks.applyHook(
      input.invocationId,
      input,
      () => applied(input, fresh),
      () => clients.retireHook(input)
    )
  })
  const store = new DesignTaskStore(join(f.root, 'tasks.json'))
  tasks = new DesignTasks({ store, createId: randomUUID, now: () => now })
  const session = {
    sessionId: 'figma',
    fileKey: 'file',
    fileName: 'File',
    pageId: '0:1',
    busy: false
  }
  const task = tasks.begin('owner', 'extension', session, 'Work', 'begin', {
    kind: 'claude',
    name: 'Claude',
    sessionId: 'old-session'
  })
  tasks.stop(task.task.taskId, 'cancelled', { sessionId: 'old-session' })
  const input: ClientHook = {
    version: 2,
    kind: 'claude',
    sessionId: 'old-session',
    event: 'Stop',
    invocationId: randomUUID(),
    issuedAt: now,
    profile: { kind: 'release' }
  }
  const request = async (params: ClientHook) => {
    const socket = await connectSocket(runtimeEndpoint(join(f.root, 'run'), 'mcp.sock'))
    const reply = once(socket, 'data')
    socket.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params }) + '\n'
    )
    try {
      return JSON.parse(String((await reply)[0]))
    } finally {
      socket.destroy()
    }
  }
  expect((await request(input)).result.receipt.state).toBe('accepted')
  await vi.waitFor(async () =>
    expect(await f.status()).toMatchObject({
      gated: true,
      hookFault: expect.stringContaining('after crash')
    })
  )
  f.shutdown()
  await vi.waitFor(async () =>
    expect(await endpointClosed(supervisorSocketPath(f.config))).toBe(true)
  )

  now += CLIENT_HOOK_RETENTION_MS + 1
  tasks = new DesignTasks({ store, createId: randomUUID, now: () => now })
  tasks.restore()
  const clients = new AgentClients(tasks)
  available = true
  const stops = new Set(process.listeners('SIGTERM'))
  await startSupervisor(f.config)
  const stop = process.listeners('SIGTERM').find((listener) => !stops.has(listener))!
  cleanups.push(async () => {
    clients.close()
    stop('SIGTERM')
    await vi.waitFor(async () =>
      expect(await endpointClosed(supervisorSocketPath(f.config))).toBe(true)
    )
  })
  const control = new ControlPeer()
  await control.connect(new SocketTransport(await connectSocket(supervisorSocketPath(f.config))))
  cleanups.push(() => control.close())
  expect(await control.request({ method: 'tempad/runtime-status' }, ResultSchema)).toMatchObject({
    gated: false,
    phase: 'committed'
  })
  expect(applied).not.toHaveBeenCalled()
  const fresh = {
    ...input,
    sessionId: 'fresh-session',
    invocationId: randomUUID(),
    issuedAt: now,
    event: 'UserPromptSubmit' as const
  }
  expect((await request(fresh)).result.receipt.state).toBe('accepted')
  await vi.waitFor(() => expect(applied).toHaveBeenCalledExactlyOnceWith(fresh, true))
  expect(tasks.find(task.task.taskId)).toMatchObject({
    task: { status: 'cancelled' },
    claudeStopNotice: { sessionId: 'old-session' }
  })
})

it.each([false, true])(
  'rolls back an active failure using current data (socket closes before exit: %s)',
  async (socketClosesFirst) => {
    const f = await fixture()
    const currentControls = {
      supervisor: { version: f.a.version, pendingVersion: null, restartRequired: false },
      edges: [{ version: f.a.version, pendingVersion: null, restartRequired: false }],
      restartRequired: false
    }
    expect(await f.status()).toMatchObject({ controlComponents: currentControls })
    expect(await f.update()).toMatchObject({ status: 'activated', version: f.b.version })
    expect(await f.status()).toMatchObject({
      controlComponents: {
        supervisor: { version: f.a.version, pendingVersion: f.b.version, restartRequired: true },
        edges: [{ version: f.a.version, pendingVersion: f.b.version, restartRequired: true }],
        restartRequired: true
      }
    })
    expect(readJournal(f.root)).toMatchObject({ phase: 'committed', active: f.b, previous: f.a })
    await writeFile(join(f.root, 'state-evidence'), 'Stop written by B')
    await f.hubs.at(-1)!.stop(socketClosesFirst)
    await vi.waitFor(
      async () =>
        expect(await f.status()).toMatchObject({
          phase: 'committed',
          active: f.a,
          gated: false,
          controlComponents: currentControls
        }),
      { timeout: recoveryWait }
    )
    expect(readJournal(f.root)?.failedBundles).toContain(f.b.bundle)
    expect(f.hubs.map((hub) => hub.artifact)).toEqual([f.a, f.b, f.a])
    expect(
      await import('node:fs/promises').then((fs) =>
        fs.readFile(join(f.root, 'state-evidence'), 'utf8')
      )
    ).toBe('Stop written by B')
    await expect(f.update()).rejects.toThrow('quarantined')
  }
)

it.each(['work', 'Claude binding without receipt/retry hooks'])(
  'defers %s without killing the current runtime',
  async (reason) => {
    const f = await fixture()
    f.defer(reason)
    expect(await f.update()).toMatchObject({ status: 'staged' })
    expect(f.hubs).toHaveLength(1)
    expect(await f.status()).toMatchObject({
      active: f.a,
      candidate: f.b,
      gated: false,
      controlComponents: {
        supervisor: { version: f.a.version, pendingVersion: f.b.version, restartRequired: true },
        restartRequired: true
      }
    })
  }
)

it('allows repeated operator recovery without reacquiring its own live lease', async () => {
  const f = await fixture()
  await f.update()
  const before = await f.status()
  for (let attempt = 0; attempt < 2; attempt++)
    expect(
      await f.control.request({ method: 'tempad/runtime-recover' }, ResultSchema, {
        timeout: transitionTimeout
      })
    ).toMatchObject({ status: 'recovered', version: f.b.version })
  expect(await f.status()).toMatchObject({
    active: f.b,
    hubId: before.hubId,
    gated: false
  })
  expect(f.hubs.map((hub) => hub.artifact)).toEqual([f.a, f.b])
})

it('recovers a journal commit reported as failed after rename without restoring old data', async () => {
  const f = await fixture()
  const write = journalState.writeJournal
  let failed = false
  vi.spyOn(journalState, 'writeJournal').mockImplementation((root, journal) => {
    write(root, journal)
    if (!failed && journal.phase === 'preparing') {
      failed = true
      throw new Error('EIO after rename')
    }
  })
  expect(await f.update()).toMatchObject({ status: 'rolled-back' })
  expect(readJournal(f.root)).toMatchObject({
    active: f.a,
    phase: 'committed',
    failedBundles: [f.b.bundle]
  })
})

it('rolls back a candidate refused by an initialized edge', async () => {
  const f = await fixture()
  f.rejectCandidate()
  expect(await f.update()).toMatchObject({ status: 'rolled-back' })
  expect(await f.status()).toMatchObject({ active: f.a, gated: false })
  expect(readJournal(f.root)?.failedBundles).toContain(f.b.bundle)
})

it.each([false, true])(
  'rolls back when the committed Hub cannot reopen (managed: %s)',
  async (managed) => {
    const f = await fixture(undefined, managed)
    f.rejectCandidateOpen()
    if (managed)
      await f.control.request(
        { method: 'tempad/runtime-check', params: { version: f.b.version } },
        ResultSchema
      )
    const result = managed
      ? await f.control.request(
          {
            method: 'tempad/runtime-activate',
            params: { version: f.b.version, integrity: f.b.release!.integrity }
          },
          ResultSchema,
          { timeout: transitionTimeout }
        )
      : await f.update()
    expect(result).toMatchObject({ status: 'rolled-back' })
    expect(await f.status()).toMatchObject({ active: f.a, phase: 'committed', gated: false })
    expect(readJournal(f.root)?.failedBundles).toEqual([f.b.bundle])
    expect(f.hubs.map((hub) => hub.artifact)).toEqual([f.a, f.b, f.a])
  }
)

it('cannot finish a pending update after releasing supervisor ownership', async () => {
  const f = await fixture()
  const before = readJournal(f.root)
  let release!: () => void
  fake.probe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ artifact: f.b, contract: 'identical' })
      })
  )
  const update = f.update()
  const rejected = expect(update).rejects.toThrow('Connection closed')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.shutdown()
  await rejected
  release()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(readJournal(f.root)).toEqual(before)
  expect(fake.launch).not.toHaveBeenCalled()
})
