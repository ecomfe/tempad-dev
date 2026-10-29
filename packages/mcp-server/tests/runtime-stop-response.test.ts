import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { connect, createServer, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'

import { captureHostContext } from '../src/agent-clients/host-context'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import { ControlPeer, SocketTransport } from '../src/runtime-prototype/protocol'

const cleanup: (() => Promise<unknown>)[] = []
const stopRequest = { method: 'tempad/runtime-stop', params: { pausedSessions: [] } }
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

async function fixture() {
  const stop = vi.fn(async () => {})
  const control = new HubControl('secret', undefined, {
    inspect: () => ({ drained: true, deadline: Date.now(), blockers: [], version: '1' }),
    flush: () => {},
    stop,
    hook: () => ({})
  })
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    void control.attach(socket)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  async function attach(gate = true) {
    const accepted = once(server, 'connection')
    const socket = connect((server.address() as { port: number }).port, '127.0.0.1')
    const peer = new ControlPeer()
    peer.onerror = () => {}
    await peer.connect(new SocketTransport(socket))
    cleanup.push(() => peer.close())
    await peer.request(
      { method: 'tempad/runtime-acquire', params: { secret: 'secret', versions: [2] } },
      LeaseSchema
    )
    if (gate)
      await peer.request({ method: 'tempad/runtime-gate', params: { closed: true } }, ResultSchema)
    return { peer, socket: (await accepted)[0] as Socket }
  }
  return { control, stop, attach, ...(await attach()) }
}

function holdStopReply(socket: Socket) {
  const write = socket.write.bind(socket)
  let release: (() => void) | undefined
  let fail: (() => void) | undefined
  vi.spyOn(socket, 'write').mockImplementation((chunk, ...args) => {
    if (String(chunk).includes('"stopping":')) {
      release = () => Reflect.apply(write, socket, [chunk, ...args])
      fail = () => {
        const callback = args.find((value) => typeof value === 'function')
        callback?.(new Error('Reply write failed'))
      }
      return true
    }
    return Reflect.apply(write, socket, [chunk, ...args])
  })
  return {
    held: () => !!release,
    release: () => release!(),
    fail: () => fail!()
  }
}

it('requires a pause for every attached data session and releases detached sessions', async () => {
  const f = await fixture()
  const registration = {
    sessionId: randomUUID(),
    token: randomUUID(),
    versions: [2],
    context: captureHostContext(process.env)
  }
  await f.peer.request({ method: 'tempad/runtime-register', params: registration }, ResultSchema)
  f.control.claimSession(registration.sessionId, registration.token)
  expect(await f.peer.request({ method: 'tempad/runtime-inspect' }, ResultSchema)).toHaveProperty(
    'attachedSessions',
    [registration.sessionId]
  )
  await expect(f.peer.request(stopRequest, ResultSchema)).rejects.toThrow(
    'no acknowledged admission barrier'
  )
  expect(f.stop).not.toHaveBeenCalled()
  f.control.forget(registration.sessionId)
  await f.peer.request(stopRequest, ResultSchema)
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
})

it('admits paused sessions but prevents a data connection racing acknowledged shutdown', async () => {
  const f = await fixture()
  const registration = {
    sessionId: randomUUID(),
    token: randomUUID(),
    versions: [2],
    context: captureHostContext(process.env)
  }
  const late = { ...registration, sessionId: randomUUID(), token: randomUUID() }
  for (const params of [registration, late])
    await f.peer.request({ method: 'tempad/runtime-register', params }, ResultSchema)
  f.control.claimSession(registration.sessionId, registration.token)
  const held = holdStopReply(f.socket)
  const stopping = f.peer.request(
    {
      method: 'tempad/runtime-stop',
      params: { pausedSessions: [registration.sessionId] }
    },
    ResultSchema
  )
  await vi.waitFor(() => expect(held.held()).toBe(true))
  expect(() => f.control.claimSession(late.sessionId, late.token)).toThrow()
  held.release()
  await stopping
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
})

it('waits for the actual stop reply and graceful socket finish before shutdown', async () => {
  const f = await fixture()
  const held = holdStopReply(f.socket)
  f.stop.mockImplementation(async () => {
    expect(f.socket.writableFinished).toBe(true)
  })
  const reply = f.peer.request(stopRequest, ResultSchema)
  await vi.waitFor(() => expect(held.held()).toBe(true))
  await delay(60)
  expect(f.stop).not.toHaveBeenCalled()
  await expect(f.peer.request(stopRequest, ResultSchema)).rejects.toThrow('already been admitted')
  held.release()
  await expect(reply).resolves.toEqual({ stopping: f.control.hubId })
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
})

it('does not stop after a failed reply and releases the reservation for a successor controller', async () => {
  const f = await fixture()
  const held = holdStopReply(f.socket)
  let finishClose!: () => void
  const closing = new Promise<void>((resolve) => {
    finishClose = resolve
  })
  cleanup.push(async () => finishClose())
  const close = ControlPeer.prototype.close
  const delayedClose = vi
    .spyOn(ControlPeer.prototype, 'close')
    .mockImplementationOnce(async function (this: ControlPeer) {
      await closing
      await close.call(this)
    })
  const reply = expect(f.peer.request(stopRequest, ResultSchema)).rejects.toThrow(
    'Connection closed'
  )
  await vi.waitFor(() => expect(held.held()).toBe(true))
  held.fail()
  await vi.waitFor(() => expect(delayedClose).toHaveBeenCalled())
  // The SDK has finished the failed send, but closure has not aborted the handler.
  // The error itself must release the reservation so controlled recovery can proceed.
  await f.peer.request({ method: 'tempad/runtime-gate', params: { closed: false } }, ResultSchema)
  await f.peer.request({ method: 'tempad/runtime-gate', params: { closed: true } }, ResultSchema)
  finishClose()
  await reply
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.control.admitting()).toBe(false)
  const next = await f.attach()
  await next.peer.request(stopRequest, ResultSchema)
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
})

it('cancels an unflushed stop without letting its eventual reply shut down the Hub', async () => {
  const f = await fixture()
  const held = holdStopReply(f.socket)
  const abort = new AbortController()
  const reply = expect(
    f.peer.request(stopRequest, ResultSchema, { signal: abort.signal })
  ).rejects.toThrow()
  await vi.waitFor(() => expect(held.held()).toBe(true))
  abort.abort()
  await reply
  await f.peer.request({ method: 'tempad/runtime-gate', params: { closed: false } }, ResultSchema)
  held.release()
  await delay(60)
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.control.admitting()).toBe(true)
})

it('commits shutdown if the control pipe fails after the reply was flushed', async () => {
  const f = await fixture()
  vi.spyOn(f.socket, 'end').mockImplementation(() => {
    f.socket.destroy(new Error('Pipe finish failed'))
    return f.socket
  })
  await f.peer.request(stopRequest, ResultSchema).catch(() => {})
  await vi.waitFor(() => expect(f.socket.destroyed).toBe(true))
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
  const next = await f.attach(false)
  await expect(
    next.peer.request({ method: 'tempad/runtime-gate', params: { closed: false } }, ResultSchema)
  ).rejects.toThrow('cannot change')
  expect(f.control.admitting()).toBe(false)
})

it.each(['tempad/runtime-renew', 'tempad/runtime-inspect'])(
  'finishes an acknowledged shutdown when %s arrives while the pipe ends',
  async (method) => {
    const f = await fixture()
    const final = f.socket._final.bind(f.socket)
    let finish: (() => void) | undefined
    const release = () => {
      const complete = finish
      finish = undefined
      complete?.()
    }
    vi.spyOn(f.socket, '_final').mockImplementation((callback) => {
      finish = () => final(callback)
    })
    await f.peer.request(stopRequest, ResultSchema)
    expect(f.socket.writableEnded).toBe(true)
    try {
      // The rejected response proves the late write reached the ending socket;
      // releasing _final earlier would merely test ordinary graceful shutdown.
      await expect(f.peer.request({ method }, ResultSchema, { timeout: 1000 })).rejects.toThrow(
        'Connection closed'
      )
      release()
      await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
    } finally {
      release()
    }
  }
)

it('keeps admission fenced if shutdown fails after the acknowledgement', async () => {
  const f = await fixture()
  f.stop.mockRejectedValueOnce(new Error('Partial shutdown failed'))
  await f.peer.request(stopRequest, ResultSchema)
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
  const next = await f.attach(false)
  await expect(
    next.peer.request({ method: 'tempad/runtime-gate', params: { closed: false } }, ResultSchema)
  ).rejects.toThrow('cannot change')
  expect(f.control.admitting()).toBe(false)
})
