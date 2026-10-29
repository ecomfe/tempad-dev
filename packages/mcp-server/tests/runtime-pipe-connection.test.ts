import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('node:net', async (original) => ({
  ...(await original<typeof import('node:net')>()),
  connect: vi.fn()
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn()
}))
vi.mock('../src/runtime-platform', async (original) => ({
  ...(await original<typeof import('../src/runtime-platform')>()),
  assertPrivateEndpointAsync: vi.fn(),
  runtimeEndpoint: () => '\\\\.\\pipe\\test'
}))

import { assertPrivateEndpointAsync as assertPrivateEndpoint } from '../src/runtime-platform'
import {
  connectSocket,
  isSocketPending,
  supervisorConnection,
  unavailableSocket,
  waitForLaunchedSocket,
  waitForSocket,
  type PrototypeConfig
} from '../src/runtime-prototype/processes'
import { RECOVER_MS } from '../src/runtime-prototype/protocol'

function createSocket() {
  const value = Object.assign(new EventEmitter(), {
    destroyed: false,
    write: vi.fn(),
    destroy: vi.fn(() => {
      Object.assign(value, { destroyed: true })
      return value
    })
  }) as unknown as Socket
  return value
}

let socket: Socket
beforeEach(() => {
  vi.resetAllMocks()
  socket = createSocket()
  vi.mocked(connect).mockReturnValue(socket)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('waits past the endpoint probe window for its own living launch', async () => {
  const child = new EventEmitter() as ChildProcess
  const started = performance.now()
  vi.mocked(connect).mockImplementation(() => {
    const next = createSocket()
    queueMicrotask(() => {
      if (performance.now() - started < 5200)
        next.emit('error', Object.assign(new Error('starting'), { code: 'ENOENT' }))
      else next.emit('connect')
    })
    return next
  })
  const connected = await waitForLaunchedSocket(
    '\\\\.\\pipe\\test',
    child,
    new AbortController().signal
  )
  expect(connected.destroyed).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
  expect(child.listenerCount('error')).toBe(0)
  expect(child.listenerCount('exit')).toBe(0)
  connected.destroy()
}, 12000)

it.each(['exit', 'error'] as const)(
  'stops waiting promptly when its launch reports %s',
  async (event) => {
    const child = new EventEmitter() as ChildProcess
    const pending = waitForLaunchedSocket('\\\\.\\pipe\\test', child, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow(event === 'exit' ? 'exited' : 'spawn failed')
    if (event === 'exit') child.emit('exit', 1, null)
    else child.emit('error', new Error('spawn failed'))
    await rejected
    expect(socket.destroyed).toBe(true)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
  }
)

it('bounds an unresponsive launch without terminating it', async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }) as unknown as ChildProcess
  vi.spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValue(RECOVER_MS + 1)
  const rejected = expect(
    waitForLaunchedSocket('\\\\.\\pipe\\test', child, new AbortController().signal)
  ).rejects.toMatchObject({ data: { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false } })
  socket.emit('error', Object.assign(new Error('starting'), { code: 'ENOENT' }))
  await rejected
  expect(child.kill).not.toHaveBeenCalled()
})

it.each(['ESRCH', 'EPERM'])(
  'stops endpoint discovery when an existing owner reports %s',
  async (code) => {
    const failed = Object.assign(new Error('owner probe failed'), { code })
    const probe = vi
      .spyOn(process, 'kill')
      .mockReturnValueOnce(true)
      .mockImplementation(() => {
        throw failed
      })
    const pending = waitForSocket(
      '\\\\.\\pipe\\test',
      new AbortController().signal,
      RECOVER_MS,
      12345
    )
    const rejected = expect(pending).rejects.toThrow(
      code === 'ESRCH' ? 'process exited' : 'owner probe failed'
    )
    socket.emit('error', Object.assign(new Error('not ready'), { code: 'ENOENT' }))
    await rejected
    expect(probe).toHaveBeenCalledTimes(2)
    expect(probe).toHaveBeenCalledWith(12345, 0)
    expect(connect).toHaveBeenCalledOnce()
    expect(socket.write).not.toHaveBeenCalled()
  }
)

it.each(['EPIPEUNPROTECTED', 'EBUSY'])(
  'keeps the same connection while %s resolves, without sending control data',
  async (code) => {
    vi.mocked(assertPrivateEndpoint).mockImplementationOnce(() => {
      throw Object.assign(new Error('not ready yet'), { code })
    })
    const ready = vi.fn()
    const connection = connectSocket('\\\\.\\pipe\\test').then((connected) => {
      ready()
      connected.write('control secret')
      return connected
    })
    socket.emit('connect')
    expect(ready).not.toHaveBeenCalled()
    expect(socket.write).not.toHaveBeenCalled()
    await expect(connection).resolves.toBe(socket)
    expect(connect).toHaveBeenCalledOnce()
    expect(assertPrivateEndpoint).toHaveBeenCalledTimes(2)
    expect(socket.write).toHaveBeenCalledWith('control secret')
  }
)

it.each(['EPIPEUNPROTECTED', 'EBUSY'])(
  'preserves %s when inspection cannot finish within its bounded verification deadline',
  async (code) => {
    vi.useFakeTimers()
    const error = Object.assign(new Error('not ready yet'), { code })
    vi.mocked(assertPrivateEndpoint).mockImplementation(() => {
      throw error
    })
    const rejected = expect(connectSocket('\\\\.\\pipe\\test')).rejects.toBe(error)
    socket.emit('connect')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(assertPrivateEndpoint).toHaveBeenCalled()
    expect(socket.destroy).toHaveBeenCalled()
    expect(socket.write).not.toHaveBeenCalled()
  }
)

it('times out when no pipe connection was established', async () => {
  const rejected = expect(connectSocket('\\\\.\\pipe\\test')).rejects.toMatchObject({
    message: 'Runtime connection timed out.',
    code: 'ETIMEDOUT'
  })
  await rejected
  expect(assertPrivateEndpoint).not.toHaveBeenCalled()
  expect(socket.destroy).toHaveBeenCalled()
  expect(socket.write).not.toHaveBeenCalled()
})

it('preserves cancellation while waiting for pipe protection', async () => {
  vi.mocked(assertPrivateEndpoint).mockImplementation(() => {
    throw Object.assign(new Error('not protected yet'), { code: 'EPIPEUNPROTECTED' })
  })
  const controller = new AbortController()
  const rejected = expect(connectSocket('\\\\.\\pipe\\test', controller.signal)).rejects.toThrow(
    'cancelled'
  )
  socket.emit('connect')
  await delay(1)
  expect(assertPrivateEndpoint).toHaveBeenCalled()
  controller.abort()
  await rejected
  expect(socket.destroy).toHaveBeenCalled()
  expect(socket.write).not.toHaveBeenCalled()
})

it.each(['close', 'ECONNRESET', 'EPIPE'])(
  'settles a connection lost through %s during ACL inspection without waiting for its deadline',
  async (event) => {
    vi.useFakeTimers()
    const inspection = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    vi.mocked(assertPrivateEndpoint).mockImplementation((_path, value) => {
      signal = value
      return inspection.promise
    })
    const observed = vi.fn()
    const pending = connectSocket('\\\\.\\pipe\\test').then(
      (connected) => observed({ connected }),
      (error: unknown) => {
        observed(error)
        return error
      }
    )
    socket.emit('connect')
    if (event === 'close') {
      socket.destroy()
      socket.emit('close')
    } else socket.emit('error', Object.assign(new Error('Pipe was closed'), { code: event }))
    await vi.advanceTimersByTimeAsync(0)
    expect(observed).toHaveBeenCalledOnce()
    const error = await pending
    expect(isSocketPending(error)).toBe(true)
    expect(unavailableSocket(error)).toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(socket.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    inspection.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(observed).toHaveBeenCalledOnce()
    expect(socket.write).not.toHaveBeenCalled()
  }
)

it.each(['endpoint', 'supervisor'] as const)(
  'retries an early protected-listener close promptly through %s without launching an owner',
  async (kind) => {
    const sockets: Socket[] = []
    const inspection = Promise.withResolvers<void>()
    vi.mocked(connect).mockImplementation(() => {
      const next = createSocket()
      sockets.push(next)
      queueMicrotask(() => next.emit('connect'))
      return next
    })
    vi.mocked(assertPrivateEndpoint).mockImplementation(() => {
      if (sockets.length !== 1) return Promise.resolve()
      queueMicrotask(() => {
        sockets[0]!.destroy()
        sockets[0]!.emit('close')
      })
      return inspection.promise
    })
    const ready = vi.fn()
    const pending = (
      kind === 'endpoint'
        ? waitForSocket('\\\\.\\pipe\\test', undefined, RECOVER_MS)
        : supervisorConnection(
            { root: '/unused' } as PrototypeConfig,
            AbortSignal.timeout(RECOVER_MS)
          )
    ).then((connected) => {
      ready(connected)
      return connected
    })
    await vi.waitFor(() => expect(ready).toHaveBeenCalledExactlyOnceWith(sockets[1]))
    expect(await pending).toBe(sockets[1])
    expect(sockets).toHaveLength(2)
    expect(spawn).not.toHaveBeenCalled()
    for (const value of sockets) expect(value.write).not.toHaveBeenCalled()
    inspection.resolve()
    sockets[1]!.destroy()
  }
)

it.each([undefined, 'EPIPEUNTRUSTED'])(
  'does not retry foreign owners or unsupported security helpers (%s)',
  async (code) => {
    vi.mocked(assertPrivateEndpoint).mockImplementation(() => {
      throw Object.assign(new Error('Unexpected owner'), { code })
    })
    const rejected = expect(connectSocket('\\\\.\\pipe\\test')).rejects.toThrow('Unexpected owner')
    socket.emit('connect')
    await rejected
    expect(assertPrivateEndpoint).toHaveBeenCalledOnce()
    expect(socket.write).not.toHaveBeenCalled()
  }
)

it.each([
  ['endpoint', 'EPIPEUNPROTECTED'],
  ['endpoint', 'ETIMEDOUT'],
  ['supervisor', 'EPIPEUNPROTECTED'],
  ['supervisor', 'ETIMEDOUT']
] as const)(
  'waits for %s %s across connection attempts without launching another owner',
  async (kind, code) => {
    vi.useFakeTimers()
    const pending = Object.assign(new Error('Endpoint acquisition pending'), { code })
    expect(unavailableSocket(pending)).toBe(false)
    const sockets: Socket[] = []
    vi.mocked(connect).mockImplementation(() => {
      const next = createSocket()
      sockets.push(next)
      if (code !== 'ETIMEDOUT' || sockets.length > 1) queueMicrotask(() => next.emit('connect'))
      return next
    })
    vi.mocked(assertPrivateEndpoint).mockImplementation(async () => {
      if (sockets.length === 1) throw pending
    })
    const connection =
      kind === 'endpoint'
        ? waitForSocket('\\\\.\\pipe\\test', undefined, RECOVER_MS)
        : supervisorConnection(
            { root: '/unused' } as PrototypeConfig,
            AbortSignal.timeout(RECOVER_MS)
          )
    await vi.advanceTimersByTimeAsync(16_000)
    const connected = await connection
    expect(sockets).toHaveLength(2)
    expect(connected).toBe(sockets[1])
    expect(sockets[0]!.destroyed).toBe(true)
    expect(spawn).not.toHaveBeenCalled()
    for (const value of sockets) expect(value.write).not.toHaveBeenCalled()
    connected.destroy()
  }
)

it('keeps ownership uncertain when supervisor acquisition exhausts its recovery deadline', async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => timeout(ms === RECOVER_MS ? 30 : ms))
  await expect(
    supervisorConnection({ root: '/unused' } as PrototypeConfig, new AbortController().signal)
  ).rejects.toMatchObject({
    message: expect.stringContaining('Runtime supervisor startup timed out'),
    data: { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false }
  })
  expect(spawn).not.toHaveBeenCalled()
  expect(socket.destroyed).toBe(true)
  expect(socket.write).not.toHaveBeenCalled()
})
