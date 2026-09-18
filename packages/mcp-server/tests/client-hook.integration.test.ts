import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { ClientHookRequestSchema, ClientHooks, type ClientHook } from '../src/agent-clients/hooks'
import { ClientEventSchema } from '../src/agent-clients/identity'

const hook = fileURLToPath(
  new URL('../../../agent-plugin/src/clients/shared/lifecycle.mjs', import.meta.url)
)

async function withHookHub(
  run: (directory: string, hooks: ClientHooks, received: ClientHook[]) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'tempad-hook-test-'))
  const hooks = new ClientHooks()
  const received: ClientHook[] = []
  const clients = new Set<McpServer>()
  const server = createServer((socket) => {
    const mcp = new McpServer({ name: 'isolated-tempad-hub', version: '1.0.0' })
    clients.add(mcp)
    mcp.server.setRequestHandler(ClientHookRequestSchema, (request) => {
      received.push(request.params)
      return hooks.handle(request.params)
    })
    void mcp.connect(new StdioServerTransport(socket, socket))
    socket.once('close', () => {
      clients.delete(mcp)
      void mcp.close()
    })
  })
  try {
    await new Promise<void>((resolve) => server.listen(join(directory, 'mcp.sock'), resolve))
    await run(directory, hooks, received)
  } finally {
    await Promise.all([...clients].map((client) => client.close()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

async function runHook(directory: string, event: string, extra = {}, kind = 'codex') {
  const child = spawn(process.execPath, [hook, kind], {
    env: { ...process.env, TEMPAD_MCP_RUNTIME_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (data) => {
    stdout += String(data)
  })
  child.stderr.on('data', (data) => {
    stderr += String(data)
  })
  child.stdin.end(
    JSON.stringify({ hook_event_name: event, session_id: 'thread-a', turn_id: 'turn-a', ...extra })
  )
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve))
  return { code, stdout, stderr }
}

describe('plugin hook transport', () => {
  it('still accepts the lifecycle notification used by existing runtime clients', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const input = new PassThrough(),
      output = new PassThrough()
    const received = vi.fn()
    server.server.setNotificationHandler(ClientEventSchema, received)
    await server.connect(new StdioServerTransport(input, output))
    input.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/tempad/client-event',
        params: { event: 'Interrupt', kind: 'codex-app', sessionId: 'thread-a' }
      }) + '\n'
    )
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
    await server.close()
  })

  it('reports lifecycle over the real Hub transport without exposing a model tool or output', async () => {
    await withHookHub(async (directory, _hooks, received) => {
      expect(await runHook(directory, 'Interrupt')).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(received).toEqual([
        expect.objectContaining({
          version: 1,
          event: 'Interrupt',
          kind: 'codex',
          sessionId: 'thread-a',
          turnId: 'turn-a'
        })
      ])
      await runHook(directory, 'PostToolUse', { agent_id: 'child-agent' })
      expect(received).toHaveLength(1)
    })
  })

  it.each(['codex', 'claude'] as const)(
    'reports %s task binding and emits only the one-time Figma Stop notice',
    async (kind) => {
      await withHookHub(async (directory, hooks, received) => {
        await runHook(directory, 'UserPromptSubmit', {}, kind)
        hooks.stop(
          {
            client: { kind, name: kind, sessionId: 'thread-a' },
            turnId: 'turn-a'
          },
          'task-a'
        )
        const result = await runHook(
          directory,
          'PostToolUse',
          {
            tool_name: 'mcp__tempad-dev__begin_design',
            tool_response: { structuredContent: { taskId: 'task-a' } }
          },
          kind
        )
        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: expect.stringContaining('The user stopped Figma design task task-a.')
          }
        })
        expect(received.at(-1)?.taskId).toBe('task-a')
        for (const event of ['PreToolUse', 'PostToolUse', 'Stop'])
          expect(await runHook(directory, event, {}, kind)).toEqual({
            code: 0,
            stdout: '',
            stderr: ''
          })
      })
    }
  )

  it('does not emit comment context offered by an older Hub', async () => {
    await withHookHub(async (directory, hooks) => {
      vi.spyOn(hooks, 'handle').mockReturnValue({
        receiptId: '00000000-0000-4000-8000-000000000001',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: 'Hidden legacy comment'
          }
        }
      } as ReturnType<ClientHooks['handle']>)
      expect(await runHook(directory, 'PreToolUse')).toEqual({
        code: 0,
        stdout: '',
        stderr: ''
      })
    })
  })

  it('exits quietly when no Hub is running instead of launching a helper', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tempad-no-hub-'))
    try {
      expect(await runHook(directory, 'PreToolUse')).toEqual({ code: 0, stdout: '', stderr: '' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
