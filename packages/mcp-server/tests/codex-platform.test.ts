import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAppFeedback } from '../src/agent-clients/codex-feedback'
import { CodexIpc, CodexIpcError, codexSocketPaths } from '../src/agent-clients/codex-ipc'
import { CodexNativeQueue, CodexQueueUnavailable } from '../src/agent-clients/codex-queue'

vi.mock('node:net', async (original) => ({
  ...(await original<typeof import('node:net')>()),
  connect: vi.fn()
}))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, lstat: vi.fn(fs.lstat) }
})
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const getuid = process.getuid
const directories: string[] = []
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  process.getuid = getuid
  vi.resetAllMocks()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

function windows() {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  process.getuid = undefined as unknown as typeof process.getuid
}

describe('Codex Windows integration', () => {
  it('connects and initializes the fixed local pipe without Unix inode checks', async () => {
    windows()
    const messages: Record<string, unknown>[] = []
    class Pipe extends EventEmitter {
      destroyed = false
      write(bytes: Buffer) {
        const message = JSON.parse(bytes.subarray(4).toString())
        messages.push(message)
        const body = Buffer.from(
          JSON.stringify({
            type: 'response',
            requestId: message.requestId,
            method: message.method,
            resultType: 'success',
            handledByClientId: 'owner',
            result:
              message.method === 'initialize'
                ? { clientId: 'tempad-client' }
                : { supportsUntrustedAppInput: true }
          })
        )
        const header = Buffer.alloc(4)
        header.writeUInt32LE(body.length)
        queueMicrotask(() => this.emit('data', Buffer.concat([header, body])))
      }
      destroy() {
        this.destroyed = true
        this.emit('close')
      }
    }
    vi.mocked(connect).mockImplementation(() => {
      const pipe = new Pipe()
      queueMicrotask(() => pipe.emit('connect'))
      return pipe as unknown as ReturnType<typeof connect>
    })
    expect(codexSocketPaths()).toEqual([String.raw`\\.\pipe\codex-ipc`])
    const ipc = await CodexIpc.open()
    try {
      expect(await ipc.owner('thread-a')).toBe('owner')
      expect(connect).toHaveBeenCalledExactlyOnceWith(String.raw`\\.\pipe\codex-ipc`)
      expect(lstat).not.toHaveBeenCalled()
      expect(messages[0]).toMatchObject({
        method: 'initialize',
        params: { clientType: 'tempad-dev' }
      })
    } finally {
      ipc.close()
    }
  })

  it.each([String.raw`\\remote\pipe\codex-ipc`, String.raw`\\.\pipe\other`, 'C:\\ipc.sock'])(
    'rejects an unexpected Windows endpoint %s before connecting',
    async (path) => {
      windows()
      await expect(CodexIpc.open([path])).rejects.toThrow('IPC is unavailable')
      expect(connect).not.toHaveBeenCalled()
      expect(lstat).not.toHaveBeenCalled()
    }
  )

  it('opens only an explicitly submitted conversation with the registered Windows URL handler', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tempad-codex-windows-'))
    directories.push(directory)
    windows()
    const id = '00000000-0000-4000-8000-000000000001'
    const owner = vi.fn().mockRejectedValue(new CodexIpcError('no-client-found'))
    const request = vi.fn().mockResolvedValue({
      resultType: 'success',
      handledByClientId: 'owner',
      result: { result: { turn: { id: 'turn-a' } } }
    })
    const queue = new CodexNativeQueue(
      async () => [],
      async () => null
    )
    vi.spyOn(queue, 'admit').mockRejectedValue(new CodexQueueUnavailable('Queue unavailable'))
    const native = new CodexAppFeedback(
      directory,
      async () => ({
        owner,
        request,
        close: vi.fn(),
        broadcast: vi.fn(),
        onBroadcast: vi.fn(() => () => {}),
        onDisconnect: vi.fn(() => () => {})
      }),
      1,
      undefined,
      queue
    )
    const binding = { client: { kind: 'codex-app' as const, name: 'Codex', sessionId: id } }
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      owner.mockResolvedValue('owner')
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void
      callback(null, '', '')
    }) as typeof execFile)
    try {
      expect(await native.available(binding)).toBe(false)
      expect(execFile).not.toHaveBeenCalled()
      await native.enqueue(
        binding,
        'task-a',
        {
          id,
          mode: 'queue',
          fileKey: 'file-a',
          items: [],
          comment: 'Keep spacing',
          createdAt: 0
        },
        new AbortController().signal,
        () => {},
        () => {}
      )
      expect(execFile).toHaveBeenCalledExactlyOnceWith(
        'rundll32.exe',
        ['url.dll,FileProtocolHandler', `codex://threads/${id}`],
        expect.objectContaining({ timeout: 5000, signal: expect.any(AbortSignal) }),
        expect.any(Function)
      )
      expect(request).toHaveBeenCalledOnce()
    } finally {
      native.close()
    }
  })
})
