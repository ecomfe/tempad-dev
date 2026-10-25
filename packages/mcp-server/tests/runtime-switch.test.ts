import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  CLIENT_HOOK_RETENTION_MS,
  ClientHookParamsSchema,
  type ClientHook
} from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
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
import { createHubRuntimeIdentity } from '../src/runtime-identity'
import {
  connectSocket,
  fingerprintBundle,
  hubSocketPath,
  listenPrivate,
  prototypeConfig
} from '../src/runtime-prototype/processes'
import {
  ControlPeer,
  GrantSchema,
  SocketTransport,
  unavailable
} from '../src/runtime-prototype/protocol'
import { readJournal, type Artifact } from '../src/runtime-prototype/state'
import * as journalState from '../src/runtime-prototype/state'
import { startSupervisor } from '../src/runtime-prototype/supervisor'
import * as releaseArtifacts from '../src/runtime-update/artifact'
import * as releaseAcquisition from '../src/runtime-update/manager'
import { PACKAGE_VERSION } from '../src/shared'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function fixture(
  hook?: (input: ClientHook, fresh: boolean) => Record<string, unknown>,
  automatic = false
) {
  const root = await realpath(await mkdtemp('/tmp/tp-switch-test-'))
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
          platforms: ['darwin', 'linux'],
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
  let waitForRuntime = true
  const hubs: { pid: number; stop: (exiting?: boolean) => Promise<void>; artifact: Artifact }[] = []
  async function start(artifact: Artifact) {
    const pid = nextPid++
    const id = randomUUID()
    let gated = false
    live.add(pid)
    await rm(hubSocketPath(root), { force: true })
    await writeFile(
      join(root, 'run/hub-runtime.json'),
      JSON.stringify(createHubRuntimeIdentity(artifact.entry, artifact.version, { processId: pid }))
    )
    const sockets = new Set<Socket>()
    const stop = async (socketClosesFirst = false) => {
      live.delete(pid)
      if (socketClosesFirst) exiting.add(pid)
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    const server = createServer((socket) => {
      sockets.add(socket)
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
          gated = params.closed
          if (gated && busyOnGate) drained = false
          return status()
        }
      )
      peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-stop') }), () => {
        if (refuseStop) throw unavailable('Late activity; shutdown was not admitted.')
        setTimeout(() => void stop(), 5)
        return {}
      })
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
    await listenPrivate(server, hubSocketPath(root))
    hubs.push({ pid, stop, artifact })
    cleanups.push(async () => {
      if (live.has(pid)) await stop()
    })
  }
  fake.launch.mockImplementation((_config, role, value) => {
    if (role !== 'hub') throw new Error('Unexpected supervisor spawn')
    void start(value)
    return Object.assign(new EventEmitter(), { unref: () => {} })
  })
  fake.probe.mockImplementation(async (entry) => ({
    artifact: entry === a.entry ? a : b,
    contract: 'identical'
  }))
  await start(a)
  const stops = new Set(process.listeners('SIGTERM'))
  await startSupervisor(config)
  const shutdown = process.listeners('SIGTERM').find((listener) => !stops.has(listener))!
  const control = new ControlPeer()
  await control.connect(new SocketTransport(await connectSocket(join(root, 'supervisor.sock'))))
  cleanups.push(async () => {
    await control.close()
    await new Promise((resolve) => setTimeout(resolve, 10))
    for (const hub of hubs) if (live.has(hub.pid)) await hub.stop()
    await vi.waitFor(async () => {
      expect(
        await import('node:fs').then((fs) => fs.existsSync(join(root, 'supervisor.sock')))
      ).toBe(false)
    })
  })
  const edge = new ControlPeer()
  await edge.connect(new SocketTransport(await connectSocket(join(root, 'supervisor.sock'))))
  cleanups.push(() => edge.close())
  const ready = (hubId: string) =>
    edge.request(
      {
        method: 'tempad/runtime-ready',
        params: {
          hubId,
          ...(waitForRuntime ? { waitForRuntime: true } : {}),
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
  const grant = await edge.request(
    {
      method: 'tempad/runtime-hello',
      params: {
        sessionId: randomUUID(),
        token: randomUUID(),
        context: captureHostContext({ HOME: root, TMPDIR: root }),
        updates: { policy: 'stable', version: a.version, manifestHash: 'a'.repeat(64) },
        versions: [2]
      }
    },
    GrantSchema
  )
  await ready(grant.hubId)
  return {
    root,
    config,
    shutdown: () => shutdown('SIGTERM'),
    a,
    b,
    hubs,
    control,
    update: () =>
      control.request(
        { method: 'tempad/runtime-update', params: { entry: b.entry } },
        ResultSchema,
        { timeout: 10000 }
      ),
    status: () => control.request({ method: 'tempad/runtime-status' }, ResultSchema),
    defer: (reason = 'work') => {
      drained = false
      blocker = reason
    },
    rejectCandidate: () => {
      peerFailure = true
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
      oldEdge: async () => {
        waitForRuntime = false
        await ready(grant.hubId)
      },
      unready: async () => {
        peerFailure = true
        await ready(grant.hubId)
      }
    }
  }
}

it.skipIf(process.platform === 'win32')(
  'automatically replaces a compatible idle runtime once',
  async () => {
    const f = await fixture(undefined, true)
    f.auto.allow()
    await vi.waitFor(
      async () => expect(await f.status()).toMatchObject({ active: f.b, gated: false }),
      { timeout: 5000 }
    )
    expect(f.hubs.map((hub) => hub.artifact)).toEqual([f.a, f.b])
    expect(readJournal(f.root)).toMatchObject({ phase: 'committed', previous: f.a })
  }
)

it
  .skipIf(process.platform === 'win32')
  .each(['oldEdge', 'unready', 'legacyHub', 'recentWork'] as const)(
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

it.skipIf(process.platform === 'win32').each(['raceGate', 'refuseStop'] as const)(
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
      { timeout: 5000 }
    )
    expect(f.hubs).toHaveLength(1)
    expect(readJournal(f.root)?.failedBundles).toEqual([])
  }
)

it.skipIf(process.platform === 'win32')(
  'isolates and backs off automatic verification failures',
  async () => {
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
  }
)

it.skipIf(process.platform === 'win32')(
  'recovers a supervisor with an expired admitted hook without replay or loss of Stop',
  async () => {
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
      const socket = await connectSocket(join(f.root, 'run/mcp.sock'))
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
      expect(
        await import('node:fs').then((fs) => fs.existsSync(join(f.root, 'supervisor.sock')))
      ).toBe(false)
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
        expect(
          await import('node:fs').then((fs) => fs.existsSync(join(f.root, 'supervisor.sock')))
        ).toBe(false)
      )
    })
    const control = new ControlPeer()
    await control.connect(new SocketTransport(await connectSocket(join(f.root, 'supervisor.sock'))))
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
  }
)

it.skipIf(process.platform === 'win32').each([false, true])(
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
    await vi.waitFor(async () =>
      expect(await f.status()).toMatchObject({
        phase: 'committed',
        active: f.a,
        gated: false,
        controlComponents: currentControls
      })
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

it
  .skipIf(process.platform === 'win32')
  .each(['work', 'Claude binding without receipt/retry hooks'])(
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

it.skipIf(process.platform === 'win32')(
  'allows repeated operator recovery without reacquiring its own live lease',
  async () => {
    const f = await fixture()
    await f.update()
    const before = await f.status()
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        await f.control.request({ method: 'tempad/runtime-recover' }, ResultSchema)
      ).toMatchObject({ status: 'recovered', version: f.b.version })
    expect(await f.status()).toMatchObject({
      active: f.b,
      hubId: before.hubId,
      gated: false
    })
    expect(f.hubs.map((hub) => hub.artifact)).toEqual([f.a, f.b])
  }
)

it.skipIf(process.platform === 'win32')(
  'recovers a journal commit reported as failed after rename without restoring old data',
  async () => {
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
  }
)

it.skipIf(process.platform === 'win32')(
  'rolls back a candidate refused by an initialized edge',
  async () => {
    const f = await fixture()
    f.rejectCandidate()
    expect(await f.update()).toMatchObject({ status: 'rolled-back' })
    expect(await f.status()).toMatchObject({ active: f.a, gated: false })
    expect(readJournal(f.root)?.failedBundles).toContain(f.b.bundle)
  }
)

it.skipIf(process.platform === 'win32')(
  'cannot finish a pending update after releasing supervisor ownership',
  async () => {
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
  }
)
