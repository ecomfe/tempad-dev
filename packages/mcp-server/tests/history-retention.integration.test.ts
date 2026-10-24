import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAppFeedback } from '../src/agent-clients/codex-feedback'
import { CodexNativeQueue } from '../src/agent-clients/codex-queue'
import { AgentClients } from '../src/agent-clients/registry'
import { DesignTasks } from '../src/design-tasks'
import { HISTORY_RETENTION_MS } from '../src/history-retention'

const session = {
  sessionId: 'session-a',
  fileKey: 'file-a',
  fileName: 'Product',
  pageId: 'page-a',
  busy: false
}

afterEach(() => vi.restoreAllMocks())

describe('history retention across task and host adapters', () => {
  it('expires a settled action cache together with its retired task', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const tasks = new DesignTasks({ createId: () => 'task-a', now: () => now })
    const clients = new AgentClients(tasks)
    tasks.begin('owner-a', 'extension-a', session, 'Settings', 'begin-a')
    const action = { requestId: 'stop-a', taskId: 'task-a', epoch: 0, action: 'stop' as const }
    expect((await clients.action(action)).status).toBe('delivered')
    now += HISTORY_RETENTION_MS - 1
    expect((await clients.action(action)).status).toBe('delivered')
    now++
    expect(await clients.action(action)).toMatchObject({
      status: 'failed',
      message: 'This design task is no longer available.'
    })
  })

  it('removes a queued message even after its task details have expired', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const tasks = new DesignTasks({ createId: () => 'task-a', now: () => now })
    tasks.begin('owner-a', 'extension-a', session, 'Settings', 'begin-a')
    tasks.stop('task-a', 'cancelled')
    now += HISTORY_RETENTION_MS
    expect(tasks.find('task-a')).toBeUndefined()

    const directory = await mkdtemp(join(tmpdir(), 'tempad-history-retention-'))
    const receiptPath = join(directory, `${'a'.repeat(64)}.json`)
    let messages = [{ id: 'feedback-a' }]
    const queue = new CodexNativeQueue(
      async () => messages,
      async () => null,
      { list: vi.fn(), add: vi.fn(), remove: vi.fn(), close: vi.fn() }
    )
    const remove = vi.spyOn(queue, 'remove').mockImplementation(async () => {
      messages = []
    })
    const native = new CodexAppFeedback(directory, {
      open: async () => ({
        owner: vi.fn().mockResolvedValue('host-a'),
        close: vi.fn(),
        request: vi.fn(),
        broadcast: vi.fn(),
        onBroadcast: vi.fn(() => () => {}),
        onDisconnect: vi.fn(() => () => {})
      }),
      retryMs: 1,
      load: vi.fn(),
      nativeQueue: queue
    })
    const clients = new AgentClients(tasks, native)
    try {
      await writeFile(
        receiptPath,
        JSON.stringify({
          signature: 'hash',
          status: 'delivered',
          delivery: 'queue',
          conversationId: 'conversation-a',
          taskId: 'task-a',
          messageId: 'feedback-a',
          backend: 'legacy'
        })
      )
      await clients.refreshCapabilities()
      expect(remove).toHaveBeenCalledWith(
        expect.anything(),
        'host-a',
        'conversation-a',
        new Set(['feedback-a']),
        expect.any(AbortSignal),
        'legacy'
      )
      expect(messages).toEqual([])
      expect(JSON.parse(await readFile(receiptPath, 'utf8')).status).toBe('removed')
    } finally {
      clients.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
