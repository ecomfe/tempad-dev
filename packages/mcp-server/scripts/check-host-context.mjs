import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import console from 'node:console'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'

// Release Windows pipes ignore directory overrides. Never risk an installed Hub.
if (process.platform === 'win32')
  throw new Error('The isolated CLI host-context check requires Unix sockets.')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

async function waitFor(check, message) {
  const deadline = Date.now() + 15000
  do {
    const value = await check()
    if (value) return value
    await setTimeout(25)
  } while (Date.now() < deadline)
  throw new Error(message)
}

async function records(path) {
  try {
    return (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function stopHub(path) {
  try {
    const { pid } = JSON.parse(await readFile(path, 'utf8'))
    process.kill(pid, 'SIGTERM')
    await waitFor(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch (error) {
        if (error.code === 'ESRCH') return true
        throw error
      }
    }, 'Fixture Hub did not exit')
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
  }
}

async function checkOrder(firstKind, legacy = false) {
  const root = await mkdtemp('/tmp/tp-h-')
  const children = []
  const recordPath = join(root, 'frames.jsonl')
  const hubPath = join(root, 'hub.json')
  try {
    await cp(join(packageRoot, 'dist'), join(root, 'dist'), { recursive: true })
    await symlink(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
    // Only this private fixture substitutes the Hub. The built CLI still launches,
    // locks, registers, bridges, reconnects and sanitizes its child environment.
    await writeFile(
      join(root, 'dist/hub.mjs'),
      `
      import { createServer } from 'node:net';
      import { writeFileSync, appendFileSync } from 'node:fs';
      import { fileURLToPath } from 'node:url';
      import { join } from 'node:path';
      import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
      import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
      import { z } from 'zod';
      const root = fileURLToPath(new URL('..', import.meta.url));
      writeFileSync(join(root, 'hub.json'), JSON.stringify({ pid: process.pid, env: process.env }));
      process.umask(0o177);
      let next = 0;
      createServer((socket) => {
        const connection = ++next;
        let buffer = '';
        if (${legacy}) {
          // Freeze the pre-context connect contract from 74ed70c9. In particular,
          // do not register the new notification or import its current schema.
          let identity;
          const mcp = new McpServer({ name: 'legacy-hub-fixture', version: '0.11.0' });
          mcp.server.setNotificationHandler(z.object({
            method: z.literal('notifications/tempad/client-event'),
            params: z.object({
              event: z.literal('connect'),
              kind: z.enum(['codex-app', 'claude']),
              sessionId: z.string().min(1).max(256).optional(),
              turnId: z.string().min(1).max(256).optional()
            }).strict()
          }), ({ params }) => { identity = params; });
          mcp.registerTool('fixture_identity', {}, async () => ({
            content: [{ type: 'text', text: JSON.stringify(identity) }]
          }));
          mcp.server.setRequestHandler(z.object({ method: z.literal('fixture/disconnect') }), async () => {
            setImmediate(() => socket.end());
            return {};
          });
          void mcp.connect(new StdioServerTransport(socket, socket));
        }
        socket.on('error', () => {});
        socket.on('data', (chunk) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\\n')) !== -1) {
            const frame = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            appendFileSync(join(root, 'frames.jsonl'), JSON.stringify({ connection, frame }) + '\\n');
            if (frame.id !== undefined && !${legacy}) {
              socket.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} }) + '\\n');
              if (frame.method === 'fixture/disconnect') socket.end();
            }
          }
        });
      }).listen(join(process.env.TEMPAD_MCP_RUNTIME_DIR, 'mcp.sock'));
    `
    )

    async function launch(kind) {
      const home = join(root, kind)
      await mkdir(home)
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: root,
        TEMPAD_MCP_RUNTIME_DIR: join(root, 'run'),
        TEMPAD_MCP_LOG_DIR: join(root, 'log'),
        TEMPAD_MCP_ASSET_DIR: join(root, 'assets'),
        TEMPAD_MCP_STATE_DIR: join(root, 'state'),
        CODEX_HOME: join(home, 'codex'),
        CODEX_SQLITE_HOME: join(home, 'sqlite'),
        NODE_OPTIONS: '--no-warnings',
        OPENAI_API_KEY: 'fixture-secret',
        ...(kind === 'codex'
          ? { CODEX_APP_TOOLS_PIPE_PATH: '/fixture.pipe', CODEX_THREAD_ID: 'codex-thread' }
          : { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'claude-session' })
      }
      const child = spawn(process.execPath, [join(root, 'dist/cli.mjs')], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      children.push(child)
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      const replies = new Map()
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        const message = JSON.parse(line)
        replies.set(message.id, message)
      })
      const request = async (id, method, params) => {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
        await waitFor(() => {
          if (child.exitCode !== null) throw new Error(`CLI exited: ${stderr}`)
          return replies.has(id)
        }, `CLI did not bridge ${method}: ${stderr}`)
        assert.equal(replies.get(id).error, undefined)
        return replies.get(id).result
      }
      if (legacy) {
        const initialized = await request(0, 'initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: kind === 'codex' ? 'codex' : 'claude-code', version: '1.0.0' }
        })
        assert.equal(initialized.serverInfo.name, 'legacy-hub-fixture')
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
        )
        const result = await request(5, 'tools/call', { name: 'fixture_identity', arguments: {} })
        assert.equal(
          JSON.parse(result.content[0].text).kind,
          kind === 'codex' ? 'codex-app' : 'claude'
        )
      }
      assert.deepEqual(await request(1, 'ping'), {})
      return { child, request, home }
    }

    const first = await launch(firstKind)
    const second = await launch(firstKind === 'codex' ? 'claude' : 'codex')
    const hub = JSON.parse(await readFile(hubPath, 'utf8'))
    assert.equal(hub.env.TEMPAD_MCP_RUNTIME_DIR, join(root, 'run'))
    for (const name of [
      'CODEX_HOME',
      'CODEX_SQLITE_HOME',
      'CODEX_THREAD_ID',
      'CODEX_APP_TOOLS_PIPE_PATH',
      'CLAUDECODE',
      'CLAUDE_CODE_SESSION_ID',
      'NODE_OPTIONS',
      'OPENAI_API_KEY'
    ])
      assert.equal(hub.env[name], undefined, `Hub inherited ${name}`)

    await second.request(2, 'fixture/disconnect')
    await waitFor(
      async () =>
        (await records(recordPath)).filter(
          ({ frame }) => frame.method === 'notifications/tempad/host-context'
        ).length === 3,
      'CLI did not re-register context after reconnect'
    )
    await second.request(3, 'ping')
    const disconnected = once(first.child, 'exit')
    first.child.stdin.end()
    await disconnected
    await second.request(4, 'ping')
    if (legacy) {
      const result = await second.request(6, 'tools/call', {
        name: 'fixture_identity',
        arguments: {}
      })
      assert.equal(
        JSON.parse(result.content[0].text).kind,
        firstKind === 'codex' ? 'claude' : 'codex-app'
      )
    }
    const frames = await records(recordPath)
    const registrations = frames.filter(
      ({ frame }) => frame.method === 'notifications/tempad/host-context'
    )
    assert.deepEqual(
      registrations.map(({ frame }) => frame.params.home),
      [first.home, second.home, second.home]
    )
    assert.deepEqual(registrations[1].frame.params, registrations[2].frame.params)
    for (const { connection, frame } of registrations) {
      assert.equal(frame.params.version, 1)
      assert.equal(frame.params.codexHome, join(frame.params.home, 'codex'))
      assert.equal(frame.params.codexSqliteHome, join(frame.params.home, 'sqlite'))
      const events = frames.filter((entry) => entry.connection === connection)
      assert.equal(events[0].frame.method, 'notifications/tempad/host-context')
      assert.equal(events[1].frame.method, 'notifications/tempad/client-event')
      assert.equal(
        events[1].frame.params.kind,
        frame.params.home.endsWith('/codex') ? 'codex-app' : 'claude'
      )
    }
    console.log(
      `Host context: ${firstKind} first, independent registrations, sanitized Hub, reconnect and launcher exit passed${legacy ? '; legacy SDK initialization, strict identity and tools passed' : ''}.`
    )
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
    await stopHub(hubPath)
    await rm(root, { recursive: true, force: true })
  }
}

await checkOrder('claude')
await checkOrder('codex')
await checkOrder('codex', true)
