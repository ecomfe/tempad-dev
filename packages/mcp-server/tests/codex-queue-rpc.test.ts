import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }))
vi.mock('node:child_process', () => mocks)

import { CodexQueueRpc, codexQueueExecutable } from '../src/agent-clients/codex-queue-rpc'

type Request = { id?: number; method: string; params?: Record<string, unknown> }
const clients: CodexQueueRpc[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  vi.useRealTimers()
  vi.resetAllMocks()
})

function peer(handle: (request: Request) => unknown = () => ({ data: [], nextCursor: null })) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new Writable({
      write(chunk, _encoding, done) {
        const request = JSON.parse(chunk.toString()) as Request
        requests.push(request)
        if (request.id !== undefined) {
          const result = request.method === 'initialize' ? {} : handle(request)
          if (result !== undefined) queueMicrotask(() => reply({ id: request.id, result }))
        }
        done()
      }
    }),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close'))
      return true
    })
  })
  const requests: Request[] = []
  const reply = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`)
  mocks.spawn.mockReturnValueOnce(child)
  return { child, requests, reply }
}

function client(executable = vi.fn(async () => '/host/resources/codex')) {
  const rpc = new CodexQueueRpc(executable)
  clients.push(rpc)
  return rpc
}

describe('queue-only native RPC', () => {
  it('initializes once, reads every page and exposes only queue operations', async () => {
    const message = { id: 'native-a', clientUserMessageId: 'feedback-a', input: [] }
    const f = peer(({ method, params }) => {
      if (method === 'thread/queue/list')
        return params?.cursor
          ? { data: [], nextCursor: null }
          : { data: [message], nextCursor: 'page-2' }
      if (method === 'thread/queue/add') return { queuedSubmission: message }
      return { deleted: true }
    })
    const rpc = client()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(await rpc.list('thread-a')).toEqual([message])
    await rpc.add('thread-a', 'feedback-a', 'Comment', new AbortController().signal)
    await rpc.remove('thread-a', 'native-a', new AbortController().signal)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(f.requests.map(({ method }) => method)).toEqual([
      'initialize',
      'initialized',
      'thread/queue/list',
      'thread/queue/list',
      'thread/queue/add',
      'thread/queue/delete'
    ])
    expect(f.requests[4]?.params).toMatchObject({
      threadId: 'thread-a',
      clientUserMessageId: 'feedback-a',
      input: [{ type: 'text', text: 'Comment', text_elements: [] }]
    })
  })

  it('shares initialization across concurrent callers', async () => {
    peer()
    const rpc = client()
    await Promise.all([rpc.list('one'), rpc.list('two')])
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('does not replay a write after disconnection and reconnects for a later read', async () => {
    const f = peer(() => undefined)
    const rpc = client()
    const adding = rpc.add('thread-a', 'feedback-a', 'Comment', new AbortController().signal)
    const rejected = expect(adding).rejects.toMatchObject({ uncertain: true })
    await vi.waitFor(() => expect(f.requests.at(-1)?.method).toBe('thread/queue/add'))
    f.child.emit('exit', 1)
    await rejected
    const next = peer()
    expect(await rpc.list('thread-a')).toEqual([])
    expect(next.requests.map(({ method }) => method)).toEqual([
      'initialize',
      'initialized',
      'thread/queue/list'
    ])
  })

  it('retains uncertainty on abort after dispatch', async () => {
    const f = peer(() => undefined)
    const rpc = client()
    const controller = new AbortController()
    const rejected = expect(
      rpc.add('thread-a', 'feedback-a', 'Comment', controller.signal)
    ).rejects.toMatchObject({ uncertain: true })
    await vi.waitFor(() => expect(f.requests.at(-1)?.method).toBe('thread/queue/add'))
    controller.abort()
    await rejected
    expect(f.requests.filter(({ method }) => method === 'thread/queue/add')).toHaveLength(1)
  })

  it('bounds a missing response without automatically retrying', async () => {
    vi.useFakeTimers()
    const f = peer(() => undefined)
    const rejected = expect(client().list('thread-a')).rejects.toMatchObject({ uncertain: true })
    await vi.advanceTimersByTimeAsync(10001)
    await rejected
    expect(f.requests.filter(({ method }) => method === 'thread/queue/list')).toHaveLength(1)
  })

  it('preserves a native rejection as a definite result', async () => {
    const f = peer(() => undefined)
    const rejected = expect(client().list('thread-a')).rejects.toMatchObject({
      message: 'Thread unavailable',
      uncertain: false
    })
    await vi.waitFor(() => expect(f.requests.at(-1)?.method).toBe('thread/queue/list'))
    f.reply({ id: f.requests.at(-1)!.id, error: { code: -32603, message: 'Thread unavailable' } })
    await rejected
  })

  it('rejects an incompatible admission acknowledgement', async () => {
    peer(() => ({ queuedSubmission: { id: 'one', clientUserMessageId: 'other' } }))
    await expect(
      client().add('thread-a', 'feedback-a', 'Comment', new AbortController().signal)
    ).rejects.toMatchObject({ uncertain: true })
  })

  it('rejects malformed queue data instead of treating it as empty', async () => {
    peer(() => ({ data: [{ id: 5 }], nextCursor: null }))
    await expect(client().list('thread-a')).rejects.toThrow('incompatible server queue')
  })

  it('does not spawn after shutdown during executable discovery', async () => {
    let finish!: (path: string) => void
    const rpc = client(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve
          })
      )
    )
    const rejected = expect(rpc.list('thread-a')).rejects.toThrow('closed')
    rpc.close()
    finish('/host/resources/codex')
    await rejected
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})

describe('desktop executable discovery', () => {
  function processes(stdout: string) {
    mocks.execFile.mockImplementation((_file, _args, _options, callback) =>
      callback(null, { stdout, stderr: '' })
    )
  }

  it('selects the unique running desktop binary instead of PATH executables', async () => {
    processes(
      '/usr/local/bin/codex\n/Applications/Codex.app/Contents/Resources/codex\n/Applications/Codex.app/Contents/Resources/codex\n'
    )
    expect(await codexQueueExecutable()).toBe('/Applications/Codex.app/Contents/Resources/codex')
  })

  it('does not guess between different running desktop installations', async () => {
    processes(
      '/Applications/Codex.app/Contents/Resources/codex\n/Applications/ChatGPT.app/Contents/Resources/codex\n'
    )
    await expect(codexQueueExecutable()).rejects.toThrow('could not be identified')
  })
})
