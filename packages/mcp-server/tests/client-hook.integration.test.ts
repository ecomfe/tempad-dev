import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  run: (
    directory: string,
    hooks: ClientHooks,
    received: ClientHook[],
    root: string
  ) => Promise<void>,
  linuxRoot?: 'private' | 'unsafe'
) {
  const root = await mkdtemp(join(tmpdir(), 'th-'))
  let directory = root
  if (linuxRoot) {
    const legacyRoot = join(root, 'tempad-dev')
    await mkdir(legacyRoot, { mode: linuxRoot === 'private' ? 0o700 : 0o755 })
    directory = join(
      linuxRoot === 'private' ? legacyRoot : join(root, `tempad-dev-${process.getuid?.()}`),
      'run'
    )
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
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
    if (process.platform !== 'win32') await chmod(join(directory, 'mcp.sock'), 0o600)
    await run(directory, hooks, received, root)
  } finally {
    await Promise.all([...clients].map((client) => client.close()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}

async function runHook(
  directory: string,
  event: string,
  extra = {},
  kind = 'codex',
  linuxTmpDir?: string
) {
  const args = linuxTmpDir
    ? [
        '--import',
        'data:text/javascript,Object.defineProperty(process,"platform",{value:"linux"})',
        hook,
        kind
      ]
    : [hook, kind]
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      TEMPAD_MCP_RUNTIME_DIR: linuxTmpDir ? '' : directory,
      ...(linuxTmpDir ? { TMPDIR: linuxTmpDir, TMP: linuxTmpDir, TEMP: linuxTmpDir } : {})
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = '',
    stderr = ''
  child.stdout.setEncoding('utf8').on('data', (data) => {
    stdout += data
  })
  child.stderr.setEncoding('utf8').on('data', (data) => {
    stderr += data
  })
  child.stdin.end(
    JSON.stringify({ hook_event_name: event, session_id: 'thread-a', turn_id: 'turn-a', ...extra })
  )
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve))
  return { code, stdout, stderr }
}

// The installed Windows hook ignores runtime-directory overrides for its fixed pipe.
// Only the in-memory protocol test is safe there; never probe the user's real Hub.
describe('plugin hook transport', () => {
  it.skipIf(process.platform === 'win32').each([
    { name: 'a normal reply', prefix: '' },
    {
      name: 'unrelated frames before the reply',
      prefix: 'not JSON\nnull\n42\n{}\n{"id":2,"error":{"message":"Other request"}}\n'
    }
  ])('preserves split UTF-8 with $name', async ({ prefix }) => {
    const directory = await mkdtemp(join(tmpdir(), 'th-'))
    const input = {
      hook_event_name: 'PostToolUse',
      session_id: 'thread-会话',
      tool_name: 'mcp__tempad-dev__manage_design_task',
      tool_input: { action: 'begin' },
      tool_response: { structuredContent: { taskId: 'task-設計' } }
    }
    const output = {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        additionalContext: 'Stop · 已停止 🛑'
      }
    }
    const requestBytes = Buffer.from(JSON.stringify(input))
    const requestSplit = requestBytes.indexOf(Buffer.from('会')) + 1
    let received: ClientHook | undefined
    let finishResponse: (() => void) | undefined
    const sockets = new Set<import('node:net').Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      let buffer = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => {
        buffer += chunk
        if (!buffer.endsWith('\n')) return
        const message = JSON.parse(buffer)
        const request = ClientHookRequestSchema.parse(message)
        received = request.params
        const bytes = Buffer.from(
          prefix + JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { output } }) + '\n'
        )
        const split = bytes.indexOf(Buffer.from('🛑')) + 1
        finishResponse = () => socket.end(bytes.subarray(split))
        socket.write(bytes.subarray(0, split))
      })
      socket.once('close', () => sockets.delete(socket))
    })
    let child: ReturnType<typeof spawn> | undefined
    try {
      await new Promise<void>((resolve) => server.listen(join(directory, 'mcp.sock'), resolve))
      await chmod(join(directory, 'mcp.sock'), 0o600)
      // Observe actual stream delivery before sending the rest. Separate writes alone can
      // coalesce, hiding the split character; no timing delay or fake decoder is involved.
      const observer = `
          import { Socket } from 'node:net'
          const emit = Socket.prototype.emit
          Socket.prototype.emit = function(event, ...args) {
            const result = Reflect.apply(emit, this, [event, ...args])
            if (event === 'data') process.send(this === process.stdin ? 'stdin' : 'socket')
            return result
          }
          process.channel.unref()
        `
      const hookProcess = spawn(
        process.execPath,
        ['--import', `data:text/javascript,${encodeURIComponent(observer)}`, hook, 'claude'],
        {
          env: { ...process.env, TEMPAD_MCP_RUNTIME_DIR: directory },
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }
      )
      child = hookProcess
      let stdout = '',
        stderr = ''
      hookProcess.stdout!.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
      hookProcess.stderr!.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
      const chunks = new Set<unknown>()
      hookProcess.on('message', (source) => {
        if (chunks.has(source)) return
        chunks.add(source)
        if (source === 'stdin') hookProcess.stdin!.end(requestBytes.subarray(requestSplit))
        if (source === 'socket') finishResponse?.()
      })
      const closed = new Promise<number | null>((resolve) => hookProcess.once('close', resolve))
      hookProcess.stdin!.write(requestBytes.subarray(0, requestSplit))
      expect(await closed).toBe(0)
      expect(stderr).toBe('')
      expect(chunks).toContain('stdin')
      expect(chunks).toContain('socket')
      expect.soft(received).toMatchObject({
        sessionId: input.session_id,
        taskId: input.tool_response.structuredContent.taskId
      })
      expect(JSON.parse(stdout)).toEqual(output)
    } finally {
      child?.kill()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'keeps the isolated Hub after legacy root changes and refuses ambiguous roots',
    async () => {
      await withHookHub(async (directory, _hooks, received, root) => {
        const legacy = join(root, 'tempad-dev')
        await rm(legacy, { recursive: true })
        await runHook(directory, 'Interrupt', {}, 'claude', root)
        expect(received).toHaveLength(1)
        await mkdir(legacy, { mode: 0o700 })
        await runHook(directory, 'Interrupt', {}, 'claude', root)
        expect(received).toHaveLength(2)
        await mkdir(join(legacy, 'run'), { mode: 0o700 })
        await writeFile(join(legacy, 'run', 'mcp.sock'), '')
        expect(await runHook(directory, 'Interrupt', {}, 'claude', root)).toEqual({
          code: 0,
          stdout: '',
          stderr: ''
        })
        expect(received).toHaveLength(2)
      }, 'unsafe')
    }
  )
  it.skipIf(process.platform === 'win32').each(['private', 'unsafe'] as const)(
    'finds the Hub with a %s legacy Linux root without an override',
    async (state) => {
      await withHookHub(async (directory, _hooks, received, root) => {
        expect(await runHook(directory, 'Interrupt', {}, 'claude', root)).toEqual({
          code: 0,
          stdout: '',
          stderr: ''
        })
        expect(received).toHaveLength(1)
        expect(received[0]?.event).toBe('Interrupt')
      }, state)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'does not send lifecycle identity to a shared-access socket',
    async () => {
      await withHookHub(async (directory, _hooks, received) => {
        await chmod(join(directory, 'mcp.sock'), 0o666)
        expect(await runHook(directory, 'Interrupt')).toEqual({ code: 0, stdout: '', stderr: '' })
        expect(received).toEqual([])
      })
    }
  )
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

  it.skipIf(process.platform === 'win32')(
    'reports lifecycle over the real Hub transport without exposing a model tool or output',
    async () => {
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
    }
  )

  it.skipIf(process.platform === 'win32').each(['codex', 'claude'] as const)(
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
            tool_name: 'mcp__tempad-dev__manage_design_task',
            tool_input: { action: 'begin' },
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

  it.skipIf(process.platform === 'win32').each(['begin', 'resume', 'complete', 'cancel'])(
    'binds unified %s hook results only when work begins or resumes',
    async (action) => {
      await withHookHub(async (directory, _hooks, received) => {
        await runHook(
          directory,
          'PostToolUse',
          {
            tool_name: 'mcp__tempad-dev__manage_design_task',
            tool_input: { action },
            tool_response: { structuredContent: { taskId: 'task-a' } }
          },
          'claude'
        )
        expect(received.at(-1)?.taskId).toBe(
          ['begin', 'resume'].includes(action) ? 'task-a' : undefined
        )
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'binds Claude content strings and arrays alongside existing MCP result wrappers',
    async () => {
      await withHookHub(async (directory, _hooks, received) => {
        const task = { taskId: 'task-a' }
        const text = JSON.stringify(task)
        const content = [{ type: 'text', text }]
        for (const tool_response of [
          text,
          content,
          task,
          { structuredContent: task },
          { result: { structuredContent: task } },
          { content }
        ]) {
          expect(
            await runHook(
              directory,
              'PostToolUse',
              {
                tool_name: 'mcp__plugin_tempad-dev-dev_tempad-dev-dev__manage_design_task',
                tool_input: { action: 'begin' },
                tool_response
              },
              'claude'
            )
          ).toEqual({ code: 0, stdout: '', stderr: '' })
          expect(received.at(-1)).toMatchObject({
            kind: 'claude',
            event: 'PostToolUse',
            sessionId: 'thread-a',
            taskId: 'task-a'
          })
        }
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'does not bind malformed content, errors, unrelated tools or subagent responses',
    async () => {
      await withHookHub(async (directory, _hooks, received) => {
        const task = { taskId: 'task-a' }
        const content = [{ type: 'text', text: JSON.stringify(task) }]
        const input = {
          tool_name: 'mcp__tempad-dev__manage_design_task',
          tool_input: { action: 'resume' },
          tool_response: content
        }
        for (const tool_response of [
          'not JSON',
          'null',
          '42',
          [{ type: 'image', text: JSON.stringify(task) }],
          { isError: true, content },
          { result: { isError: true, structuredContent: task } },
          JSON.stringify({ isError: true, ...task }),
          [{ type: 'text', text: JSON.stringify({ isError: true, ...task }) }]
        ]) {
          await runHook(directory, 'PostToolUse', { ...input, tool_response }, 'claude')
          expect(received.at(-1)?.taskId).toBeUndefined()
        }
        await runHook(
          directory,
          'PostToolUse',
          { ...input, tool_name: 'mcp__tempad-dev__get_design_task' },
          'claude'
        )
        expect(received.at(-1)?.taskId).toBeUndefined()
        const count = received.length
        for (const extra of [{ agent_id: 'child' }, { subagent_id: 'child' }])
          await runHook(directory, 'PostToolUse', { ...input, ...extra }, 'claude')
        expect(received).toHaveLength(count)
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'does not bind failed unified actions and still accepts older installed tool names',
    async () => {
      await withHookHub(async (directory, _hooks, received) => {
        await runHook(
          directory,
          'PostToolUse',
          {
            tool_name: 'mcp__tempad-dev__manage_design_task',
            tool_input: { action: 'resume' },
            tool_response: { isError: true, structuredContent: { taskId: 'task-a' } }
          },
          'claude'
        )
        expect(received.at(-1)?.taskId).toBeUndefined()
        await runHook(
          directory,
          'PostToolUse',
          {
            tool_name: 'mcp__tempad-dev__resume_design',
            tool_response: { structuredContent: { taskId: 'task-a' } }
          },
          'claude'
        )
        expect(received.at(-1)?.taskId).toBe('task-a')
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'does not emit comment context offered by an older Hub',
    async () => {
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
    }
  )

  it.skipIf(process.platform === 'win32')(
    'exits quietly when the Hub rejects the hook',
    async () => {
      await withHookHub(async (directory, hooks) => {
        vi.spyOn(hooks, 'handle').mockImplementation(() => {
          throw new Error('Unsupported hook')
        })
        expect(await runHook(directory, 'PreToolUse')).toEqual({ code: 0, stdout: '', stderr: '' })
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'exits quietly when no Hub is running instead of launching a helper',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tempad-no-hub-'))
      try {
        expect(await runHook(directory, 'PreToolUse')).toEqual({ code: 0, stdout: '', stderr: '' })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
})
