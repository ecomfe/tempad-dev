import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn()
}))

import { captureHostContext } from '../src/agent-clients/host-context'
import { createHubRuntimeIdentity } from '../src/runtime-identity'
import { HubControl } from '../src/runtime-prototype/hub-control'
import {
  connectSocket,
  hubSocketPath,
  launch,
  listenPrivate,
  prototypeConfig,
  supervisorConnection,
  waitForSocket,
  type PrototypeConfig
} from '../src/runtime-prototype/processes'
import {
  ControlPeer,
  GrantSchema,
  RECOVER_MS,
  SocketTransport,
  unavailable
} from '../src/runtime-prototype/protocol'
import { startSupervisor } from '../src/runtime-prototype/supervisor'
import { PACKAGE_VERSION } from '../src/shared'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.mocked(spawn).mockReset()
})

async function fixture() {
  const root = await realpath(await mkdtemp('/tmp/tp-process-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const entry = join(root, 'runtime-prototype.mjs')
  await writeFile(entry, 'export const fixture = true')
  return prototypeConfig(root, entry)
}

async function listener(path: string, accept: (socket: Socket) => void = () => {}) {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    accept(socket)
  })
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  await listenPrivate(server, path)
  return server
}

describe.skipIf(process.platform === 'win32')('isolated prototype processes', () => {
  it('pins the complete local bundle and refuses mutations or an exposed configuration', async () => {
    const config = await fixture()
    expect(prototypeConfig(config.root, config.entry)).toEqual(config)
    await writeFile(join(config.root, 'imported.mjs'), 'export const value = 2')
    expect(() => prototypeConfig(config.root, config.entry)).toThrow('bundle changed')
    await rm(join(config.root, 'imported.mjs'))
    await chmod(join(config.root, 'prototype.json'), 0o644)
    expect(() => prototypeConfig(config.root, config.entry)).toThrow('untrusted')
  })

  it('starts only its pinned entry with a sanitized environment', async () => {
    const config = await fixture()
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ChildProcess
    vi.mocked(spawn).mockReturnValue(child)
    vi.stubEnv('CODEX_THREAD_ID', 'must-not-inherit')
    vi.stubEnv('NODE_OPTIONS', '--require=must-not-run')
    try {
      expect(launch(config, 'hub')).toBe(child)
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [config.entry, '--root', config.root, '--role', 'hub'],
        {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          env: expect.not.objectContaining({
            CODEX_THREAD_ID: expect.anything(),
            NODE_OPTIONS: expect.anything()
          })
        }
      )
      expect(child.unref).toHaveBeenCalledOnce()
      expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env).not.toHaveProperty('NODE_OPTIONS')
      expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env).not.toHaveProperty('CODEX_THREAD_ID')
      child.emit('error', new Error('Start failed'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('elects one startup owner and reuses an existing private endpoint', async () => {
    const config = await fixture()
    const path = join(config.root, 'supervisor.sock')
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ChildProcess
    let listening: Promise<unknown> | undefined
    vi.mocked(spawn).mockImplementation(() => {
      listening = listener(path)
      return child
    })
    const signal = new AbortController().signal
    const sockets = await Promise.all([
      supervisorConnection(config, signal),
      supervisorConnection(config, signal)
    ])
    await listening
    expect(spawn).toHaveBeenCalledOnce()
    sockets.push(await supervisorConnection(config, signal))
    sockets.push(await waitForSocket(path))
    expect(spawn).toHaveBeenCalledOnce()
    sockets.forEach((socket) => socket.destroy())
    const abort = new AbortController()
    abort.abort()
    await expect(connectSocket(path, abort.signal)).rejects.toThrow('cancelled')
    await expect(waitForSocket(join(config.root, 'absent'), abort.signal)).rejects.toThrow()
    await chmod(path, 0o666)
    expect(() => connectSocket(path)).toThrow('untrusted')
  })

  it('marks only endpoint availability exhaustion as retryable startup failure', async () => {
    const config = await fixture()
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(5001)
    await expect(waitForSocket(join(config.root, 'absent'))).rejects.toMatchObject({
      code: -32001,
      data: { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false }
    })
  })

  it('waits past one connection attempt for an existing owner without replaying a command', async () => {
    const config = await fixture()
    const owner = join(config.root, 'supervisor.lock')
    await writeFile(owner, '')
    const unlock = await lockfile.lock(owner, { stale: 5000, update: 1000 })
    cleanup.push(unlock)
    const execute = vi.fn(() => {
      throw unavailable('Command was not admitted.')
    })
    let published: Promise<unknown> | undefined
    const publication = setTimeout(() => {
      published = listener(join(config.root, 'supervisor.sock'), (socket) => {
        const peer = new ControlPeer()
        peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-recover') }), execute)
        void peer.connect(new SocketTransport(socket))
      })
    }, 6500)
    try {
      const peer = new ControlPeer()
      await peer.connect(
        new SocketTransport(await supervisorConnection(config, AbortSignal.timeout(9000)))
      )
      cleanup.push(() => peer.close())
      expect(spawn).not.toHaveBeenCalled()
      await expect(
        peer.request({ method: 'tempad/runtime-recover' }, ResultSchema)
      ).rejects.toThrow('not admitted')
      expect(execute).toHaveBeenCalledOnce()
    } finally {
      clearTimeout(publication)
      await published
    }
  }, 10000)

  it.each(['caller', 'recovery'] as const)(
    'bounds supervisor discovery by the %s deadline',
    async (source) => {
      const config = await fixture()
      const owner = join(config.root, 'supervisor.lock')
      await writeFile(owner, '')
      cleanup.push(await lockfile.lock(owner, { stale: 5000, update: 1000 }))
      const deadline = new AbortController()
      const error = new Error('Caller cancelled command')
      if (source === 'recovery') vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
      const connecting = supervisorConnection(
        config,
        source === 'caller' ? deadline.signal : new AbortController().signal
      )
      const rejected = expect(connecting).rejects.toThrow(
        source === 'caller' ? error.message : 'supervisor startup timed out'
      )
      deadline.abort(error)
      await rejected
      if (source === 'recovery') expect(AbortSignal.timeout).toHaveBeenCalledWith(RECOVER_MS)
      expect(spawn).not.toHaveBeenCalled()
    }
  )

  it('rejects untrusted supervisor endpoints without retry or replacement', async () => {
    const config = await fixture()
    const path = join(config.root, 'supervisor.sock')
    await listener(path)
    await chmod(path, 0o666)
    await expect(supervisorConnection(config, AbortSignal.timeout(500))).rejects.toThrow(
      'untrusted'
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['release', 'local'] as const)(
    'does not retry a missing %s artifact as a missing socket',
    async (kind) => {
      const config = await fixture()
      const directory = join(config.root, 'missing-artifact')
      config.entry = join(directory, 'managed-runtime.mjs')
      if (kind === 'release') {
        config.release = { directory, manifestHash: 'a'.repeat(64) }
        const { root, ...saved } = config
        await writeFile(join(root, 'prototype.json'), JSON.stringify(saved), { mode: 0o600 })
      }
      await expect(supervisorConnection(config, AbortSignal.timeout(500))).rejects.toMatchObject({
        code: 'ENOENT',
        path: kind === 'release' ? join(directory, 'package.json') : directory
      })
      expect(spawn).not.toHaveBeenCalled()
    }
  )

  it('renews one Hub lease, negotiates registrations and closes with its Hub', async () => {
    const config = await fixture()
    let now = 0
    const control = new HubControl(config.secret, () => now, {
      inspect: () => ({
        drained: true,
        deadline: Date.now() + 10000,
        blockers: [],
        version: PACKAGE_VERSION
      }),
      flush: () => {},
      stop: async () => {},
      hook: () => ({})
    })
    await mkdir(join(config.root, 'run'), { mode: 0o700 })
    await writeFile(
      join(config.root, 'run/hub-runtime.json'),
      JSON.stringify(createHubRuntimeIdentity(config.entry, PACKAGE_VERSION))
    )
    await listener(hubSocketPath(config.root), (socket) => {
      void control.attach(socket)
    })
    cleanup.push(async () => {
      await control.close()
    })
    await startSupervisor(config)
    const path = join(config.root, 'supervisor.sock')
    const peer = new ControlPeer()
    await peer.connect(new SocketTransport(await connectSocket(path)))
    cleanup.push(() => peer.close())
    const params = {
      sessionId: randomUUID(),
      token: randomUUID(),
      context: captureHostContext({ HOME: config.root, TMPDIR: config.root }),
      versions: [1, 2]
    }
    const first = peer.request({ method: 'tempad/runtime-hello', params }, GrantSchema)
    const duplicate = expect(
      peer.request({ method: 'tempad/runtime-hello', params }, GrantSchema)
    ).rejects.toThrow('only once')
    const grant = await first
    await duplicate
    expect(grant).toMatchObject({ generation: 1, hubId: control.hubId, version: 2 })
    const incompatible = new ControlPeer()
    await incompatible.connect(new SocketTransport(await connectSocket(path)))
    cleanup.push(() => incompatible.close())
    await expect(
      incompatible.request(
        { method: 'tempad/runtime-hello', params: { ...params, versions: [1] } },
        ResultSchema
      )
    ).rejects.toThrow('MCP_RUNTIME_RESTART_REQUIRED')
    // A real renewal crosses the interval; shutdown must also remove its endpoint and lock.
    now = 9000
    await new Promise((resolve) => setTimeout(resolve, 2200))
    now = 11000
    expect(control.available()).toBe(true)
    await peer.close()
    await incompatible.close()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await control.close()
    await vi.waitFor(async () =>
      expect(
        await readFile(join(config.root, 'supervisor.json')).catch(() => undefined)
      ).toBeUndefined()
    )
  })

  it('does not replace a Hub whose ownership record cannot be verified', async () => {
    const config: PrototypeConfig = await fixture()
    await mkdir(join(config.root, 'run'), { mode: 0o700 })
    await writeFile(join(config.root, 'run/hub-runtime.json'), '{}')
    await expect(startSupervisor(config)).rejects.toThrow('ownership is uncertain')
    expect(spawn).not.toHaveBeenCalled()
  })
})
