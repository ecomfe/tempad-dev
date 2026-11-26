import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

import {
  checkoutProfile,
  runtimeSocketPath
} from '../../../agent-plugin/src/clients/shared/runtime-profile.mjs'
import { ClientHooks, type ClientHook } from '../src/agent-clients/hooks'
import { protectPipeAsync } from '../src/runtime-platform'

it.skipIf(process.platform !== 'win32')(
  'sends a hook and accepts Stop only on a private Windows pipe',
  async () => {
    // A fresh checkout descriptor isolates the real installed hook from the fixed release pipe.
    const checkout = await realpath(await mkdtemp(join(tmpdir(), 'tempad-hook-')))
    const descriptor = join(checkout, 'clients/shared/runtime-profile.json')
    const profile = checkoutProfile(checkout)
    const endpoint = runtimeSocketPath(checkout, profile)
    const hook = fileURLToPath(
      new URL('../../../agent-plugin/targets/claude/clients/shared/lifecycle.mjs', import.meta.url)
    )
    const received: ClientHook[] = []
    let legacy = false
    const hooks = new ClientHooks(() => ({ taskId: 'task-a' }))
    const server = createServer((socket) => {
      createInterface({ input: socket }).once('line', (line) => {
        const { params } = JSON.parse(line)
        received.push(params)
        const first = received.length === 1
        const respond = (reply: object) =>
          socket.end(JSON.stringify({ jsonrpc: '2.0', id: 1, ...reply }) + '\n')
        if (legacy && first) {
          respond({ error: { code: -32602, message: 'Unsupported version' } })
          return
        }
        const result = first ? {} : hooks.handle(params)
        const receipt = {
          version: 2,
          invocationId: params.invocationId,
          state: first ? 'accepted' : 'applied'
        }
        respond({ result: legacy ? result : { ...result, receipt } })
      })
    })
    const invoke = async () => {
      // Observe actual child processes without replacing the native verifier or the named pipe.
      const observer = `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
        const spawn = cp.spawn; cp.spawn = (...args) => {
          const child = spawn(...args); process.send(child.pid); return child
        }; syncBuiltinESMExports()`
      const child = spawn(
        process.execPath,
        [
          '--import',
          `data:text/javascript,${encodeURIComponent(observer)}`,
          hook,
          'claude',
          '--runtime-profile',
          descriptor
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }
      )
      const pids: number[] = []
      child.on('message', (pid: number) => pids.push(pid))
      child.stdin!.end(
        JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'session-会话' })
      )
      const [[code], stdout, stderr] = await Promise.all([
        once(child, 'close'),
        text(child.stdout!),
        text(child.stderr!)
      ])
      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(pids).toHaveLength(1)
      await expect
        .poll(() => {
          try {
            return process.kill(pids[0]!, 0)
          } catch (error) {
            return (error as NodeJS.ErrnoException).code
          }
        })
        .toBe('ESRCH')
      return stdout
    }
    try {
      const dist = join(checkout, 'packages/mcp-server/dist')
      await mkdir(dist, { recursive: true })
      for (const name of ['cli.mjs', 'hub.mjs']) await writeFile(join(dist, name), '')
      await mkdir(join(checkout, 'clients/shared'), { recursive: true })
      await writeFile(descriptor, JSON.stringify({ checkout, id: profile.id, serverName: 'test' }))
      await writeFile(
        join(checkout, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            test: { args: [join(dist, 'cli.mjs')], env: { TEMPAD_MCP_DEV_CHECKOUT: checkout } }
          }
        })
      )
      server.listen(endpoint)
      await once(server, 'listening')
      expect(await invoke()).toBe('')
      expect(received).toEqual([])
      await protectPipeAsync(endpoint)
      for (legacy of [false, true]) {
        received.length = 0
        expect(JSON.parse(await invoke())).toEqual({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: expect.stringContaining('The user stopped Figma design task task-a.')
          }
        })
        expect(received.map(({ version }) => version)).toEqual([2, legacy ? 1 : 2])
        expect(received[0]?.sessionId).toBe('session-会话')
        expect(received[0]?.invocationId).toEqual(expect.any(String))
        expect(received[1]?.invocationId).toBe(received[0]?.invocationId)
      }
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(checkout, { recursive: true, force: true })
    }
  }
)
