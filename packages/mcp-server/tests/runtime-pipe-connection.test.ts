import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('node:net', async (original) => ({
  ...(await original<typeof import('node:net')>()),
  connect: vi.fn()
}))
vi.mock('../src/runtime-platform', async (original) => ({
  ...(await original<typeof import('../src/runtime-platform')>()),
  assertPrivateEndpoint: vi.fn()
}))

import { assertPrivateEndpoint } from '../src/runtime-platform'
import { connectSocket } from '../src/runtime-prototype/processes'

let socket: Socket
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  socket = Object.assign(new EventEmitter(), {
    destroyed: false,
    write: vi.fn(),
    destroy: vi.fn(() => {
      Object.assign(socket, { destroyed: true })
      return socket
    })
  }) as unknown as Socket
  vi.mocked(connect).mockReturnValue(socket)
})
afterEach(() => vi.useRealTimers())

it('waits for the same-owner default pipe ACL to become private before returning it', async () => {
  vi.mocked(assertPrivateEndpoint).mockImplementationOnce(() => {
    throw Object.assign(new Error('not protected yet'), { code: 'EPIPEUNPROTECTED' })
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
  await vi.advanceTimersByTimeAsync(25)
  await expect(connection).resolves.toBe(socket)
  expect(assertPrivateEndpoint).toHaveBeenCalledTimes(2)
  expect(socket.write).toHaveBeenCalledWith('control secret')
})

it('rejects a pipe that stays permissive within the existing connection deadline', async () => {
  vi.mocked(assertPrivateEndpoint).mockImplementation(() => {
    throw Object.assign(new Error('not protected yet'), { code: 'EPIPEUNPROTECTED' })
  })
  const rejected = expect(connectSocket('\\\\.\\pipe\\test')).rejects.toThrow('timed out')
  socket.emit('connect')
  await vi.advanceTimersByTimeAsync(1000)
  await rejected
  expect(socket.destroy).toHaveBeenCalled()
  expect(socket.write).not.toHaveBeenCalled()
})

it('does not retry foreign owners or unsupported security helpers', async () => {
  vi.mocked(assertPrivateEndpoint).mockImplementation(() => {
    throw new Error('Unexpected owner')
  })
  const rejected = expect(connectSocket('\\\\.\\pipe\\test')).rejects.toThrow('Unexpected owner')
  socket.emit('connect')
  await rejected
  expect(assertPrivateEndpoint).toHaveBeenCalledOnce()
  expect(socket.write).not.toHaveBeenCalled()
})
