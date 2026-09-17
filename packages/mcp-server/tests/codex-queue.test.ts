import type { DesignFeedback } from '@tempad-dev/shared'

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAppFeedback } from '../src/agent-clients/codex-feedback'
import { CodexIpcError } from '../src/agent-clients/codex-ipc'
import {
  CodexNativeQueue,
  CodexQueueUnavailable,
  codexFeedbackQueuedMessage,
  readCodexQueue,
  type CodexQueueConnection,
  type CodexQueuedMessage
} from '../src/agent-clients/codex-queue'
import { AgentClients } from '../src/agent-clients/registry'
import { DesignTasks } from '../src/design-tasks'

const feedback: DesignFeedback = {
  id: '00000000-0000-4000-8000-000000000001',
  mode: 'queue',
  fileKey: 'file-a',
  comment: 'Keep the user’s **Markdown**.',
  items: [],
  createdAt: 1000
}
const binding = { client: { kind: 'codex-app' as const, name: 'Codex', sessionId: 'thread-a' } }
const cleanups: (() => Promise<unknown> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
async function fixture(existing?: string) {
  const directory = existing ?? (await mkdtemp(join(tmpdir(), 'tempad-native-queue-')))
  if (!existing) cleanups.push(() => rm(directory, { recursive: true, force: true }))
  let messages: CodexQueuedMessage[] = []
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  const read = vi.fn(async () => structuredClone(messages))
  const request = vi.fn<CodexQueueConnection['request']>(async (_method, _version, params) => {
    messages = structuredClone((params.state as Record<string, CodexQueuedMessage[]>)['thread-a']!)
    return { resultType: 'success', handledByClientId: 'owner-a', result: { ok: true } }
  })
  const connection = {
    owner: vi.fn(async () => 'owner-a'),
    request,
    close: vi.fn(),
    broadcast: vi.fn((_method: string, _version: number, params: Record<string, unknown>) => {
      if (!params.following) return
      for (const listener of listeners)
        listener({
          method: 'thread-stream-state-changed',
          version: 11,
          sourceClientId: 'owner-a',
          params: {
            conversationId: 'thread-a',
            hostId: 'local',
            change: {
              type: 'snapshot',
              conversationState: { id: 'thread-a', cwd: '/original/project' }
            }
          }
        })
    }),
    onBroadcast: (listener: (message: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onDisconnect: () => () => {}
  }
  const native = new CodexAppFeedback(
    directory,
    async () => connection,
    1,
    vi.fn(),
    new CodexNativeQueue(read)
  )
  cleanups.push(() => native.close())
  const controller = new AbortController()
  const dispatched = vi.fn()
  const validate = vi.fn()
  const send = (value = feedback) =>
    native.enqueue(binding, 'task-a', value, controller.signal, validate, dispatched)
  return {
    directory,
    messages: () => messages,
    setMessages: (value: CodexQueuedMessage[]) => {
      messages = value
    },
    read,
    request,
    connection,
    native,
    controller,
    dispatched,
    validate,
    send
  }
}

describe('native Codex queue admission', () => {
  it('preserves the complete composer queue and acknowledges storage without starting a turn', async () => {
    const f = await fixture()
    const other = {
      id: 'composer-message',
      text: 'User draft',
      context: { futureField: ['keep'] },
      pausedReason: 'User paused',
      submissionOptions: { model: 'keep' }
    }
    f.setMessages([other])
    await f.send()
    expect(f.messages()).toEqual([
      other,
      codexFeedbackQueuedMessage('task-a', feedback, '/original/project')
    ])
    expect(f.request).toHaveBeenCalledExactlyOnceWith(
      'thread-follower-set-queued-follow-ups-state',
      1,
      { conversationId: 'thread-a', state: { 'thread-a': f.messages() } },
      'owner-a',
      expect.any(AbortSignal)
    )
    expect(f.dispatched).toHaveBeenCalledOnce()
    expect(f.connection.broadcast).toHaveBeenLastCalledWith(
      'thread-stream-following-changed',
      1,
      { conversationId: 'thread-a', hostId: 'local', following: false },
      ['owner-a']
    )
    const receipt = JSON.parse(
      await readFile(join(f.directory, (await readdir(f.directory))[0]!), 'utf8')
    )
    expect(receipt).toMatchObject({ status: 'delivered', delivery: 'queue', taskId: 'task-a' })
    expect(JSON.stringify(receipt)).not.toContain(feedback.comment)
  })

  it('keeps task context untrusted and lets the original host derive permissions', () => {
    const message = codexFeedbackQueuedMessage('task-a', feedback, '/original/project')
    expect(message.context).toEqual({
      prompt: feedback.comment,
      addedFiles: [],
      fileAttachments: [],
      imageAttachments: [],
      commentAttachments: [],
      ideContext: null
    })
    expect(message.writingBlockAdditionalContext).toEqual({
      'tempad-design-task': { kind: 'untrusted', value: 'Design task: "task-a"' }
    })
    expect(message).not.toHaveProperty('submissionOptions')
  })

  it('serializes batches and reads again for each append, including intervening composer edits', async () => {
    const f = await fixture()
    const read = f.read.getMockImplementation()!
    f.read.mockImplementationOnce(async () => {
      f.setMessages([{ id: 'composer-new', extra: true }])
      return read()
    })
    const second = {
      ...feedback,
      id: '00000000-0000-4000-8000-000000000002',
      comment: 'Second batch'
    }
    await Promise.all([f.send(), f.send(second)])
    expect(f.messages().map(({ id }) => id)).toEqual(['composer-new', feedback.id, second.id])
    expect(f.read).toHaveBeenCalledTimes(2)
  })

  it('deduplicates delivery across restarts without restoring a consumed item', async () => {
    const f = await fixture()
    await f.send()
    const restarted = await fixture(f.directory)
    await restarted.send()
    expect(restarted.request).not.toHaveBeenCalled()
    expect(restarted.messages()).toEqual([])
  })

  it('reconciles a lost acknowledgement by identity without replacing the queue twice', async () => {
    const f = await fixture()
    const request = f.request.getMockImplementation()!
    f.request.mockImplementationOnce(async (...args) => {
      await request(...args)
      throw new CodexIpcError('Connection lost', true)
    })
    await f.send()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.messages().map(({ id }) => id)).toEqual([feedback.id])
  })

  it('never resubmits an uncertain item that is absent after consumption or deletion', async () => {
    const f = await fixture()
    f.request.mockRejectedValueOnce(new CodexIpcError('Connection lost', true))
    await expect(f.send()).rejects.toThrow('uncertain')
    await expect(f.send()).rejects.toThrow('uncertain')
    expect(f.request).toHaveBeenCalledOnce()
    const restarted = await fixture(f.directory)
    await expect(restarted.send()).rejects.toThrow('uncertain')
    expect(restarted.request).not.toHaveBeenCalled()
  })

  it('recovers a pending receipt when the exact queued message is still present', async () => {
    const f = await fixture()
    f.request.mockRejectedValueOnce(new CodexIpcError('Connection lost', true))
    await expect(f.send()).rejects.toThrow('uncertain')
    const restarted = await fixture(f.directory)
    restarted.setMessages([codexFeedbackQueuedMessage('task-a', feedback, '/original/project')])
    await restarted.send()
    expect(restarted.request).not.toHaveBeenCalled()
  })

  it('lets an explicit Hub retry reconcile a late native commit without dispatching again', async () => {
    const f = await fixture()
    const tasks = new DesignTasks({ createId: () => 'task-a', now: () => 1000 })
    const clients = new AgentClients(tasks, f.native)
    cleanups.push(() => clients.close())
    const owner = await clients.owner('connection-a', {
      'x-codex-turn-metadata': { thread_id: 'thread-a', turn_id: 'turn-a' }
    })
    const description = await clients.describe(owner)
    tasks.begin(
      owner,
      'extension-a',
      {
        sessionId: 'figma-a',
        fileKey: 'file-a',
        fileName: 'Product',
        pageId: 'page-a',
        busy: false
      },
      'Design',
      'request-a',
      description.client,
      description.capabilities
    )
    tasks.confirm('task-a', owner)
    const action = {
      requestId: feedback.id,
      taskId: 'task-a',
      epoch: 0,
      action: 'feedback' as const,
      feedback
    }
    f.request.mockRejectedValueOnce(new CodexIpcError('Connection lost', true))
    expect(await clients.action(action)).toMatchObject({ status: 'failed' })
    f.setMessages([codexFeedbackQueuedMessage('task-a', feedback, '/original/project')])
    expect(await clients.action(action)).toMatchObject({ status: 'delivered' })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('waits for an in-flight admission before removing only its cancelled message', async () => {
    const f = await fixture()
    let finish!: () => void
    const request = f.request.getMockImplementation()!
    f.request.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return request(...args)
    })
    const sending = f.send()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    f.controller.abort()
    const cancelled = f.native.cancelQueued('task-a')
    finish()
    await sending
    await cancelled
    expect(f.messages()).toEqual([])
    await expect(f.send()).rejects.toThrow('cancelled')
  })

  it.each([false, true])(
    'keeps later deliveries serialized after cancellation settles (failure: %s)',
    async (failRemoval) => {
      const f = await fixture()
      await f.send()
      const request = f.request.getMockImplementation()!
      let finishRemoval!: () => void
      let finishDelivery!: () => void
      f.request.mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => {
          finishRemoval = resolve
        })
        if (failRemoval) throw new CodexIpcError('Removal disconnected', true)
        return request(...args)
      })
      const cancelled = f.native.cancelQueued('task-a')
      const cancellation = failRemoval
        ? expect(cancelled).rejects.toThrow('Removal disconnected')
        : expect(cancelled).resolves.toBeUndefined()
      await vi.waitFor(() => expect(finishRemoval).toBeTypeOf('function'))
      f.request.mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => {
          finishDelivery = resolve
        })
        return request(...args)
      })
      const next = { ...feedback, id: '00000000-0000-4000-8000-000000000002' }
      const sending = f.native.enqueue(
        binding,
        'task-b',
        next,
        f.controller.signal,
        f.validate,
        f.dispatched
      )
      finishRemoval()
      await cancellation
      await vi.waitFor(() => expect(finishDelivery).toBeTypeOf('function'))
      await expect(
        f.native.enqueue(
          binding,
          'task-b',
          { ...next, mode: 'steer' },
          f.controller.signal,
          f.validate,
          f.dispatched
        )
      ).rejects.toThrow('pending delivery')
      finishDelivery()
      await sending
      expect(f.messages().map((message) => message.id)).toEqual(
        failRemoval ? [feedback.id, next.id] : [next.id]
      )
    }
  )

  it('allows an explicit retry after a definite owner rejection', async () => {
    const f = await fixture()
    f.request.mockRejectedValueOnce(new CodexIpcError('Owner changed'))
    await expect(f.send()).rejects.toThrow('Owner changed')
    expect(f.dispatched).not.toHaveBeenCalled()
    await f.send()
    expect(f.request).toHaveBeenCalledTimes(2)
  })

  it('retains the bounded Start fallback when the local queue store cannot be read', async () => {
    const f = await fixture()
    f.read.mockRejectedValueOnce(new CodexQueueUnavailable('Store unavailable'))
    f.request.mockResolvedValueOnce({
      resultType: 'success',
      handledByClientId: 'owner-a',
      result: { result: { turn: { id: 'turn-a' } } }
    })
    await f.send()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.request.mock.calls[0]![0]).toBe('thread-follower-start-turn')
  })

  it('keeps an incompatible acknowledgement uncertain unless committed state confirms admission', async () => {
    const f = await fixture()
    f.request.mockResolvedValueOnce({
      resultType: 'success',
      handledByClientId: 'wrong-owner',
      result: { ok: true }
    })
    await expect(f.send()).rejects.toThrow('uncertain')
    await expect(f.send()).rejects.toThrow('uncertain')
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('does not overwrite a queue with incompatible entries or reuse a foreign identity', async () => {
    const f = await fixture()
    f.setMessages([{ id: feedback.id, text: 'Different user input' }])
    await expect(f.send()).rejects.toThrow('different content')
    expect(f.request).not.toHaveBeenCalled()
  })

  it('removes only the cancelled task’s messages and never resends them after restart', async () => {
    const f = await fixture()
    await f.send()
    f.setMessages([...f.messages(), { id: 'composer-later', text: 'Keep me' }])
    await f.native.cancelQueued('task-a')
    expect(f.messages()).toEqual([{ id: 'composer-later', text: 'Keep me' }])
    await expect(f.send()).rejects.toThrow('cancelled')
    const restarted = await fixture(f.directory)
    await expect(restarted.send()).rejects.toThrow('cancelled')
    expect(restarted.request).not.toHaveBeenCalled()
  })

  it('preserves another task’s admitted messages in the same conversation during cancellation', async () => {
    const f = await fixture()
    await f.send()
    const other = { ...feedback, id: '00000000-0000-4000-8000-000000000002' }
    await f.native.enqueue(binding, 'task-b', other, f.controller.signal, f.validate, f.dispatched)
    await f.native.cancelQueued('task-a')
    expect(f.messages()).toEqual([codexFeedbackQueuedMessage('task-b', other, '/original/project')])
  })

  it('persists cancellation before reading host state so a read failure remains recoverable', async () => {
    const f = await fixture()
    await f.send()
    f.read.mockRejectedValueOnce(new Error('Snapshot unavailable'))
    await expect(f.native.cancelQueued('task-a')).rejects.toThrow('Snapshot unavailable')
    const restarted = await fixture(f.directory)
    restarted.setMessages(f.messages())
    await restarted.native.reconcileQueued(() => false)
    expect(restarted.messages()).toEqual([])
  })

  it('retries targeted removal after disconnect, including after restart', async () => {
    const f = await fixture()
    await f.send()
    f.request.mockRejectedValueOnce(new CodexIpcError('Connection lost', true))
    await expect(f.native.cancelQueued('task-a')).rejects.toThrow('Connection lost')
    const restarted = await fixture(f.directory)
    restarted.setMessages([...f.messages(), { id: 'composer-later' }])
    await restarted.native.reconcileQueued(() => false)
    expect(restarted.messages()).toEqual([{ id: 'composer-later' }])
  })

  it('retains cancellation tombstones for an admission committed after the first cleanup', async () => {
    const f = await fixture()
    f.request.mockRejectedValueOnce(new CodexIpcError('Connection lost', true))
    await expect(f.send()).rejects.toThrow('uncertain')
    await f.native.cancelQueued('task-a')
    const restarted = await fixture(f.directory)
    restarted.setMessages([
      codexFeedbackQueuedMessage('task-a', feedback, '/original/project'),
      { id: 'composer-later' }
    ])
    await restarted.native.reconcileQueued(() => false)
    expect(restarted.messages()).toEqual([{ id: 'composer-later' }])
    await expect(restarted.send()).rejects.toThrow('cancelled')
  })

  it('checks Stop again after reading the queue and before dispatch', async () => {
    const f = await fixture()
    f.read.mockImplementationOnce(async () => {
      f.controller.abort()
      return []
    })
    await expect(f.send()).rejects.toThrow()
    expect(f.request).not.toHaveBeenCalled()
    expect(await readdir(f.directory)).toEqual([])
  })

  it('reads current persisted queue state without modifying the host file', async () => {
    const f = await fixture()
    vi.stubEnv('CODEX_HOME', f.directory)
    const path = join(f.directory, '.codex-global-state.json')
    const original = JSON.stringify({
      'queued-follow-ups': { 'thread-a': [{ id: 'one', extra: 42 }] },
      unrelated: 'keep'
    })
    await writeFile(path, original)
    expect(await readCodexQueue('thread-a')).toEqual([{ id: 'one', extra: 42 }])
    expect(await readCodexQueue('other')).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(original)
    await writeFile(path, JSON.stringify({ 'queued-follow-ups': { 'thread-a': [{ id: 'two' }] } }))
    expect(await readCodexQueue('thread-a')).toEqual([{ id: 'two' }])
    await writeFile(path, JSON.stringify({ 'queued-follow-ups': { 'thread-a': null } }))
    // A null entry is the native representation of no stored queue.
    expect(await readCodexQueue('thread-a')).toEqual([])
    await writeFile(
      path,
      JSON.stringify({ 'queued-follow-ups': { 'thread-a': [{ id: 'x' }, { id: 'x' }] } })
    )
    await expect(readCodexQueue('thread-a')).rejects.toThrow('duplicate')
  })
})
