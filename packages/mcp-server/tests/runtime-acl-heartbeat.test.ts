import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { execFile, execFileSync, type ChildProcess, type ExecFileOptions } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('node:child_process', async (original) => {
  const childProcess = await original<typeof import('node:child_process')>()
  return {
    ...childProcess,
    // Let shared.ts create real private directories before beforeEach installs serving-only fakes.
    execFile: vi.fn(childProcess.execFile),
    execFileSync: vi.fn(childProcess.execFileSync)
  }
})
vi.mock('node:net', async (original) => ({
  ...(await original<typeof import('node:net')>()),
  connect: vi.fn()
}))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    lstatSync: vi.fn(fs.lstatSync),
    readFileSync: vi.fn(fs.readFileSync),
    realpathSync: vi.fn(fs.realpathSync)
  }
})

import { assertPrivatePathAsync } from '../src/runtime-platform'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import {
  connectSocket,
  listenPrivate,
  unavailableSocket,
  waitForSocket
} from '../src/runtime-prototype/processes'
import { ControlPeer, LEASE_MS, RENEW_MS, SocketTransport } from '../src/runtime-prototype/protocol'
import { readPrivateJsonAsync } from '../src/runtime-prototype/state'

const actualNet = await vi.importActual<typeof import('node:net')>('node:net')
const cleanup: (() => Promise<unknown>)[] = []
let finishHelper: (error?: Error, stderr?: string) => void
let helperSignal: AbortSignal | undefined
let revision = 0n
let inode = 1n
beforeEach(() => {
  vi.resetAllMocks()
  revision++
  inode = 1n
  const env = { ...process.env, SystemRoot: resolve('Windows') }
  vi.stubGlobal(
    'process',
    new Proxy(process, {
      get(target, key, receiver) {
        if (key === 'platform') return 'win32'
        if (key === 'env') return env
        return Reflect.get(target, key, receiver)
      }
    })
  )
  vi.mocked(connect).mockImplementation(actualNet.connect)
  vi.mocked(realpathSync).mockImplementation((path) => resolve(String(path)))
  vi.mocked(lstatSync).mockImplementation(
    () =>
      ({
        dev: 1n,
        ino: inode,
        birthtimeNs: 1n,
        ctimeNs: revision,
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false
      }) as ReturnType<typeof lstatSync>
  )
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error('Serving code used a blocking ACL helper')
  })
  vi.mocked(execFile).mockImplementation((...args) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    helperSignal = (args[2] as ExecFileOptions).signal
    finishHelper = (error, stderr = '') => callback(error ?? null, '', stderr)
    helperSignal?.addEventListener(
      'abort',
      () => callback(new Error('ACL helper cancelled'), '', ''),
      { once: true }
    )
    return { stdin: { end: vi.fn() } } as unknown as ChildProcess
  })
})
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function controlLease() {
  const control = new HubControl('secret', () => Date.now())
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    void control.attach(socket)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => {
    await control.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const peer = new ControlPeer()
  await peer.connect(
    new SocketTransport(connect((server.address() as { port: number }).port, '127.0.0.1'))
  )
  cleanup.push(() => peer.close())
  await peer.request(
    { method: 'tempad/runtime-acquire', params: { secret: 'secret', versions: [2] } },
    LeaseSchema
  )
  return { control, peer }
}

function pipeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    destroyed: false,
    write: vi.fn(),
    destroy: vi.fn(() => {
      socket.destroyed = true
      return socket
    })
  })
  return socket as unknown as Socket
}

function pipeListener() {
  const admitted = vi.fn()
  const server = Object.assign(new EventEmitter(), {
    listen: vi.fn((_path, ready: () => void) => {
      ready()
      return server
    }),
    close: vi.fn(() => {
      server.emit('close')
      return server
    })
  }) as unknown as Server
  server.on('connection', admitted)
  return { server, admitted }
}

it('does not cache an asynchronous ACL denial as trusted', async () => {
  const path = resolve('private-denied-fixture.json')
  const rejected = expect(assertPrivatePathAsync(path, 'file')).rejects.toThrow('foreign account')
  finishHelper(new Error('Access denied'), JSON.stringify({ code: 5, message: 'foreign account' }))
  await rejected
  const recheck = assertPrivatePathAsync(path, 'file')
  expect(execFile).toHaveBeenCalledTimes(2)
  finishHelper()
  await recheck
  await assertPrivatePathAsync(path, 'file')
  expect(execFile).toHaveBeenCalledTimes(2)
  expect(readFileSync).not.toHaveBeenCalled()
})

it('reads an atomically replaced snapshot only after its asynchronous ACL recheck succeeds', async () => {
  vi.mocked(readFileSync).mockReturnValue('{"revision":2}')
  const reading = readPrivateJsonAsync(
    resolve('private-snapshot-fixture.json'),
    z.object({ revision: z.number() })
  )
  inode++
  finishHelper()
  await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2))
  expect(readFileSync).not.toHaveBeenCalled()
  finishHelper()
  expect(await reading).toEqual({ revision: 2 })
  expect(readFileSync).toHaveBeenCalledOnce()
  expect(execFile).toHaveBeenCalledTimes(2)
})

it.each(['replacement', 'foreign ACL'] as const)(
  'does not read a snapshot after its second asynchronous check finds %s',
  async (failure) => {
    const reading = readPrivateJsonAsync(
      resolve('private-invalid-snapshot-fixture.json'),
      z.unknown()
    )
    const rejected = expect(reading).rejects.toThrow(
      failure === 'replacement' ? 'changed during its permission check' : 'foreign account'
    )
    inode++
    finishHelper()
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2))
    if (failure === 'replacement') {
      inode++
      finishHelper()
    } else
      finishHelper(
        new Error('Access denied'),
        JSON.stringify({ code: 5, message: 'foreign account' })
      )
    await rejected
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(readFileSync).not.toHaveBeenCalled()
  }
)

it('renews the actual control lease while a Windows ACL helper takes longer than that lease', async () => {
  const { control, peer } = await controlLease()
  vi.useFakeTimers()
  const renewed: Promise<unknown>[] = []
  const timer = setInterval(() => {
    renewed.push(peer.request({ method: 'tempad/runtime-renew' }, ResultSchema))
  }, RENEW_MS)
  let validated = false
  const validation = assertPrivatePathAsync(resolve('private-lease-fixture.json'), 'file').then(
    () => {
      validated = true
    }
  )
  setTimeout(() => finishHelper(), LEASE_MS + RENEW_MS)
  try {
    for (let elapsed = RENEW_MS; elapsed <= LEASE_MS + RENEW_MS; elapsed += RENEW_MS) {
      await vi.advanceTimersByTimeAsync(RENEW_MS)
      await Promise.all(renewed)
      expect(control.available()).toBe(true)
      if (elapsed <= LEASE_MS) expect(validated).toBe(false)
    }
    await validation
    expect(renewed).toHaveLength(6)
    expect(execFile).toHaveBeenCalledOnce()
    expect(execFileSync).not.toHaveBeenCalled()
  } finally {
    clearInterval(timer)
  }
})

it.each([false, true])(
  'never sends pipe capabilities before ACL verification (cancelled: %s)',
  async (cancelled) => {
    vi.useFakeTimers()
    const socket = pipeSocket()
    vi.mocked(connect).mockReturnValue(socket)
    const cancellation = new AbortController()
    const connected = connectSocket('\\\\.\\pipe\\acl-delay', cancellation.signal).then((value) => {
      value.write('private capability')
      return value
    })
    const rejected = cancelled ? expect(connected).rejects.toThrow('cancelled') : undefined
    socket.emit('connect')
    await vi.advanceTimersByTimeAsync(12_000)
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroyed).toBe(false)
    if (cancelled) {
      cancellation.abort()
      await rejected
      expect(helperSignal?.aborted).toBe(true)
      finishHelper()
      await Promise.resolve()
      expect(socket.destroyed).toBe(true)
      expect(socket.write).not.toHaveBeenCalled()
    } else {
      finishHelper()
      expect(await connected).toBe(socket)
      expect(socket.write).toHaveBeenCalledExactlyOnceWith('private capability')
      socket.destroy()
    }
  }
)

it('rejects incoming connections until delayed pipe protection completes', async () => {
  vi.useFakeTimers()
  const { server, admitted } = pipeListener()
  const listening = listenPrivate(server, '\\\\.\\pipe\\protect-delay')
  const early = pipeSocket()
  server.emit('connection', early)
  expect(early.destroyed).toBe(true)
  expect(admitted).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(12_000)
  finishHelper()
  await listening
  const trusted = pipeSocket()
  server.emit('connection', trusted)
  expect(trusted.destroyed).toBe(false)
  expect(admitted).toHaveBeenCalledExactlyOnceWith(trusted)
  expect(execFileSync).not.toHaveBeenCalled()
})

it('does not publish a listener for an owner that already closed', async () => {
  const { server } = pipeListener()
  const owner = new AbortController()
  owner.abort(new Error('Owner closed'))
  await expect(listenPrivate(server, '\\\\.\\pipe\\closed-owner', owner.signal)).rejects.toThrow()
  expect(server.listen).not.toHaveBeenCalled()
  expect(execFile).not.toHaveBeenCalled()
})

it('keeps a cancelled listener closed after delayed protection finishes', async () => {
  vi.useFakeTimers()
  const { server, admitted } = pipeListener()
  const owner = new AbortController()
  const rejected = expect(
    listenPrivate(server, '\\\\.\\pipe\\closing-owner', owner.signal)
  ).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(12_000)
  expect(admitted).not.toHaveBeenCalled()
  owner.abort(new Error('Owner closed'))
  await rejected
  expect(server.close).toHaveBeenCalledOnce()
  expect(helperSignal?.aborted).toBe(true)
  finishHelper()
  await Promise.resolve()
  server.emit('connection', pipeSocket())
  expect(admitted).not.toHaveBeenCalled()
  expect(server.rawListeners('connection')).not.toContain(admitted)
})

it('bounds pending ACL inspection by the enclosing endpoint deadline without treating it as absent', async () => {
  const socket = pipeSocket()
  vi.mocked(connect).mockReturnValue(socket)
  const waiting = waitForSocket('\\\\.\\pipe\\short-deadline', undefined, 100).then((value) => {
    value.write('private capability')
    return value
  })
  const failed = waiting.catch((error: unknown) => error)
  socket.emit('connect')
  const error = await failed
  expect(error).toMatchObject({ data: { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false } })
  expect(unavailableSocket(error)).toBe(false)
  expect(helperSignal?.aborted).toBe(true)
  expect(socket.destroyed).toBe(true)
  expect(connect).toHaveBeenCalledOnce()
  finishHelper()
  await Promise.resolve()
  expect(socket.write).not.toHaveBeenCalled()
})
