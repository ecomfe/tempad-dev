import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { request } from 'node:http'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import raw from 'unplugin-raw/rolldown'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const bundle = mkdtempSync(join(packageRoot, 'node_modules/.tempad-startup-test-'))
const directory = mkdtempSync(join(tmpdir(), 'tempad-startup-test-'))
const children: ChildProcess[] = []

beforeAll(async () => {
  const config = join(bundle, 'config.mjs')
  const hub = join(bundle, 'hub-entry.mts')
  const assets = join(bundle, 'asset-listener.mjs')
  writeFileSync(
    hub,
    `import {startHub} from ${JSON.stringify(join(packageRoot, 'src/hub-runtime.ts'))}; await startHub(); process.stdout.write('ready\\n');`
  )
  writeFileSync(
    config,
    `import { getMcpServerConfig as read } from ${JSON.stringify(join(packageRoot, 'src/config.ts'))}; export const getMcpServerConfig = () => ({...read(), wsPortCandidates: [0]});`
  )
  writeFileSync(
    assets,
    `import { createAssetHttpServer as create } from ${JSON.stringify(join(packageRoot, 'src/asset-http-server.ts'))};
    export function createAssetHttpServer(...args) {
      const server = create(...args), start = server.start;
      server.start = async () => { await start(); process.stdout.write('assets=' + server.getBaseUrl() + '\\n'); };
      return server;
    }`
  )
  await build({
    config: false,
    cwd: packageRoot,
    entry: { cli: 'src/cli.ts', hub, 'log-transport': 'src/log-transport.ts' },
    outDir: bundle,
    clean: false,
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: false,
    logLevel: 'silent',
    plugins: [
      raw(),
      {
        name: 'isolated-hub-port',
        resolveId(source, importer) {
          if (source === './config' && importer?.endsWith('/hub-runtime.ts')) return config
          if (source === './asset-http-server' && importer?.endsWith('/hub-runtime.ts'))
            return assets
        }
      }
    ]
  })
}, 15000)

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  rmSync(directory, { recursive: true, force: true })
  rmSync(bundle, { recursive: true, force: true })
})

function launch(entry: string, runtime: string, preload?: string, stores = directory) {
  const child = spawn(
    process.execPath,
    [...(preload ? ['--import', preload] : []), join(bundle, entry)],
    {
      env: {
        ...process.env,
        TEMPAD_MCP_RUNTIME_DIR: runtime,
        TEMPAD_MCP_STATE_DIR: join(stores, 'state'),
        TEMPAD_MCP_ASSET_DIR: join(stores, 'assets'),
        TEMPAD_MCP_LOG_DIR: join(directory, 'logs'),
        TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  children.push(child)
  let stderr = ''
  let stdout = ''
  child.stderr!.on('data', (chunk) => {
    stderr += String(chunk)
  })
  child.stdout!.on('data', (chunk) => {
    stdout += String(chunk)
  })
  const exited = once(child, 'exit')
  return { child, exited, stderr: () => stderr, stdout: () => stdout }
}

async function pingHub(socketPath: string): Promise<void> {
  const socket = connect(socketPath)
  try {
    await once(socket, 'connect')
    socket.setEncoding('utf8')
    socket.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
    let response = ''
    for await (const chunk of socket) {
      response += String(chunk)
      const end = response.indexOf('\n')
      if (end === -1) continue
      expect(JSON.parse(response.slice(0, end))).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
      return
    }
    throw new Error('Hub closed before replying to ping')
  } finally {
    socket.destroy()
  }
}

// These cases exercise real Unix inode checks and socket recovery. Windows uses
// the released fixed pipe, which cannot be isolated by the runtime override.
it.skipIf(process.platform === 'win32').each(['permissions', 'symlink', 'file'] as const)(
  'refuses an untrusted socket (%s) without contacting it or spawning a Hub',
  async (kind) => {
    const runtime = join(directory, `deny-${kind}`)
    const stores = join(directory, `stores-${kind}`)
    mkdirSync(runtime, { mode: 0o700 })
    const socketPath = join(runtime, 'mcp.sock')
    const listenerPath = kind === 'permissions' ? socketPath : join(runtime, 'safe.sock')
    let connections = 0
    const server = createServer((socket) => {
      connections++
      socket.destroy()
    })
    const spawned = join(directory, `spawned-${kind}`)
    const preload = join(bundle, `reject-${kind}.mjs`)
    writeFileSync(
      preload,
      `import childProcess from 'node:child_process'; import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const timeout = globalThis.setTimeout, spawn = childProcess.spawn, lstat = fs.lstatSync;
      globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 5000 ? 10 : ms, ...args);
      childProcess.spawn = (...args) => { fs.appendFileSync(${JSON.stringify(spawned)}, 'spawn\\n'); return spawn(...args); };
      fs.lstatSync = (path, ...args) => {
        if (path === ${JSON.stringify(socketPath)}) process.stderr.write('fixture-trust-check\\n');
        return lstat(path, ...args);
      };
      syncBuiltinESMExports();`
    )
    try {
      server.listen(listenerPath)
      await once(server, 'listening')
      chmodSync(listenerPath, kind === 'permissions' ? 0o666 : 0o600)
      if (kind === 'symlink') symlinkSync(listenerPath, socketPath)
      if (kind === 'file') writeFileSync(socketPath, 'not a socket', { mode: 0o600 })
      const before = lstatSync(socketPath)
      const cli = launch('cli.mjs', runtime, preload, stores)
      // Measure bounded rejection after the process has loaded the CLI, as in
      // the initial-connection fixture below; do not count import scheduling.
      await vi.waitFor(() => expect(cli.stderr()).toContain('fixture-trust-check'), {
        timeout: 5000
      })
      await vi.waitFor(() => expect(cli.child.exitCode, cli.stderr()).not.toBeNull(), {
        timeout: 3000
      })
      expect((await cli.exited)[0], cli.stderr()).toBe(1)
      expect(cli.stderr()).toContain('Refusing untrusted Hub socket')
      expect(cli.stderr().match(/fixture-trust-check/g)).toHaveLength(3)
      expect(connections).toBe(0)
      expect(existsSync(spawned)).toBe(false)
      expect(existsSync(join(runtime, 'hub-runtime.json'))).toBe(false)
      expect(existsSync(join(stores, 'state'))).toBe(false)
      const after = lstatSync(socketPath)
      expect(after.ino).toBe(before.ino)
      expect(after.mode).toBe(before.mode)
      if (kind === 'file') expect(readFileSync(socketPath, 'utf8')).toBe('not a socket')
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  10000
)

it.skipIf(process.platform === 'win32')(
  'preserves an existing private Hub socket, identity and store ownership',
  async () => {
    const runtime = join(directory, 'live')
    const stores = join(directory, 'live-stores')
    const first = launch('hub.mjs', runtime, undefined, stores)
    await vi.waitFor(() => expect(first.stdout(), first.stderr()).toContain('ready'), {
      timeout: 5000
    })
    const socketPath = join(runtime, 'mcp.sock')
    const identityPath = join(runtime, 'hub-runtime.json')
    const identity = readFileSync(identityPath, 'utf8')
    const inode = lstatSync(socketPath).ino
    const stateLock = join(stores, 'state/.tempad-hub-writer.lock')
    const stateLockInode = lstatSync(stateLock).ino
    const contender = launch('hub.mjs', runtime, undefined, stores)
    expect((await contender.exited)[0], contender.stderr()).toBe(75)
    expect(first.child.exitCode).toBeNull()
    expect(lstatSync(socketPath).ino).toBe(inode)
    expect(readFileSync(identityPath, 'utf8')).toBe(identity)
    expect(lstatSync(stateLock).ino).toBe(stateLockInode)
    await pingHub(socketPath)
    expect((await first.exited)[0], first.stderr()).toBe(0)
  },
  10000
)

it.skipIf(process.platform === 'win32')(
  'recovers through the CLI after orphaned lifecycle and writer locks expire',
  async () => {
    const runtime = join(directory, 'orphaned')
    const stores = join(directory, 'orphaned-stores')
    const old = launch('hub.mjs', runtime, undefined, stores)
    await vi.waitFor(() => expect(old.stdout(), old.stderr()).toContain('ready'), {
      timeout: 5000
    })
    old.child.kill('SIGKILL')
    expect(await old.exited).toEqual([null, 'SIGKILL'])

    const locks = [
      join(runtime, 'hub.lock.lock'),
      join(stores, 'state/.tempad-hub-writer.lock'),
      join(stores, 'assets/.tempad-hub-writer.lock')
    ]
    // Keep 30s of the real 60s lease: longer than the former 25s CLI retry
    // window, without spending a full minute aging the killed Hub's locks.
    const lastHeartbeat = new Date(Date.now() - 30000)
    for (const lock of locks) utimesSync(lock, lastHeartbeat, lastHeartbeat)
    const identityPath = join(runtime, 'hub-runtime.json')
    const oldIdentity = readFileSync(identityPath, 'utf8')
    const cli = launch('cli.mjs', runtime, undefined, stores)
    cli.child.stdin!.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
    try {
      await vi.waitFor(
        () => {
          expect(cli.child.exitCode, cli.stderr()).toBeNull()
          expect(cli.stdout(), cli.stderr()).toContain('"id":1')
        },
        { timeout: 40000 }
      )
      expect(Date.now() - lastHeartbeat.getTime()).toBeGreaterThanOrEqual(60000)
      // Filesystems may reuse freed inodes; each recovered lease needs a fresh heartbeat.
      for (const lock of locks) {
        expect(lstatSync(lock).mtimeMs).toBeGreaterThan(lastHeartbeat.getTime())
      }
      expect(readFileSync(identityPath, 'utf8')).not.toBe(oldIdentity)
      expect(JSON.parse(cli.stdout().trim())).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    } finally {
      cli.child.stdin!.end()
      await cli.exited
      if (existsSync(identityPath) && readFileSync(identityPath, 'utf8') !== oldIdentity) {
        // The CLI-spawned Hub is detached; wait for its idle shutdown before
        // deleting its isolated directories in afterAll.
        await vi.waitFor(() => expect(existsSync(identityPath)).toBe(false), {
          timeout: 5000
        })
      }
    }
  },
  50000
)

it.skipIf(process.platform === 'win32')(
  'replaces a private stale Unix socket left by a killed listener',
  async () => {
    const runtime = join(directory, 'stale')
    const stores = join(directory, 'stale-stores')
    mkdirSync(runtime, { mode: 0o700 })
    const socketPath = join(runtime, 'mcp.sock')
    const entry = 'stale-listener.mjs'
    writeFileSync(
      join(bundle, entry),
      `import {createServer} from 'node:net'; import {chmodSync} from 'node:fs';
      const socket = ${JSON.stringify(socketPath)};
      createServer().listen(socket, () => { chmodSync(socket, 0o600); process.stdout.write('ready\\n'); });`
    )
    const old = launch(entry, runtime, undefined, stores)
    await vi.waitFor(() => expect(old.stdout(), old.stderr()).toContain('ready'), { timeout: 3000 })
    old.child.kill('SIGKILL')
    expect(await old.exited).toEqual([null, 'SIGKILL'])
    expect(lstatSync(socketPath).isSocket()).toBe(true)

    const replacement = launch('hub.mjs', runtime, undefined, stores)
    await vi.waitFor(() => expect(replacement.stdout(), replacement.stderr()).toContain('ready'), {
      timeout: 5000
    })
    expect(lstatSync(socketPath).isSocket()).toBe(true)
    expect(lstatSync(socketPath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(join(runtime, 'hub-runtime.json'), 'utf8')).processId).toBe(
      replacement.child.pid
    )
    await pingHub(socketPath)
    expect((await replacement.exited)[0], replacement.stderr()).toBe(0)
  },
  10000
)

it.skipIf(process.platform === 'win32').each(['natural', 'timeout'] as const)(
  'persists an accepted upload completed during %s shutdown before releasing writer locks',
  async (exit) => {
    const stores = join(directory, `late-upload-${exit}`)
    const runtime = join(directory, exit === 'natural' ? 'upload-n' : 'upload-t')
    const assets = join(stores, 'assets')
    const preload = join(bundle, `shutdown-${exit}.mjs`)
    // The parent must finish the accepted upload before testing either exit path.
    // Trigger the real shutdown callback explicitly, without racing its 2s timer
    // against scheduling of this process and the child on a busy test runner.
    writeFileSync(
      preload,
      `process.on('SIGTERM', () => {
        const timeout = globalThis.setTimeout;
        globalThis.setTimeout = (fn, ms, ...args) => {
          if (ms !== 2000) return timeout(fn, ms, ...args);
          const timer = timeout(fn, 30000, ...args);
          process.once('SIGUSR2', () => { clearTimeout(timer); fn(...args); });
          process.stderr.write('fixture-shutdown-armed\\n');
          return timer;
        };
        ${exit === 'timeout' ? 'setInterval(() => {}, 10000);' : ''}
      });`
    )
    const hub = launch('hub.mjs', runtime, preload, stores)
    await vi.waitFor(() => expect(hub.stdout(), hub.stderr()).toContain('ready'), {
      timeout: 5000
    })
    const baseUrl = hub.stdout().match(/assets=(\S+)/)![1]!
    const body = Buffer.from('upload accepted before shutdown and completed afterward')
    const hash = createHash('sha256').update(body).digest('hex')
    let finish!: () => void
    const uploaded = new Promise<number>((resolve, reject) => {
      const req = request(
        `${baseUrl}/assets/${hash}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': body.length,
            'X-Asset-Width': '36',
            'X-Asset-Height': '24',
            Connection: 'close'
          }
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode!))
        }
      )
      req.on('error', reject)
      req.write(body.subarray(0, 1))
      finish = () => req.end(body.subarray(1))
    })
    await vi.waitFor(() =>
      expect(readdirSync(assets).some((name) => name.includes('.tmp.'))).toBe(true)
    )
    hub.child.kill('SIGTERM')
    await vi.waitFor(() => expect(hub.stderr()).toContain('fixture-shutdown-armed'), {
      timeout: 5000
    })
    expect(existsSync(join(runtime, 'hub-runtime.json'))).toBe(false)
    expect(existsSync(join(assets, '.tempad-hub-writer.lock'))).toBe(true)
    expect(JSON.parse(readFileSync(join(assets, 'assets.json'), 'utf8'))).toEqual([])
    finish()
    expect(await uploaded).toBe(201)
    if (exit === 'timeout') hub.child.kill('SIGUSR2')
    expect((await hub.exited)[0], hub.stderr()).toBe(exit === 'timeout' ? 1 : 0)
    expect(JSON.parse(readFileSync(join(assets, 'assets.json'), 'utf8'))).toEqual([
      expect.objectContaining({ hash, size: body.length, metadata: { width: 36, height: 24 } })
    ])
    expect(existsSync(join(assets, '.tempad-hub-writer.lock'))).toBe(false)
    expect(existsSync(join(stores, 'state/.tempad-hub-writer.lock'))).toBe(false)
  },
  10000
)

it.skipIf(process.platform === 'win32')(
  'keeps store locks through asynchronous shutdown and allows a later Hub',
  async () => {
    const preload = join(bundle, 'slow-shutdown.mjs')
    const marker = join(directory, 'drained')
    const release = join(directory, 'release')
    writeFileSync(
      preload,
      `import {writeFile} from 'node:fs/promises'; import {existsSync} from 'node:fs'; process.on('SIGTERM', () => { const timer = setInterval(() => { if (existsSync(${JSON.stringify(release)})) { clearInterval(timer); void writeFile(${JSON.stringify(marker)}, 'done'); } }, 10); });`
    )
    const runtime = join(directory, 'run-one')
    mkdirSync(join(directory, 'state'), { mode: 0o755 })
    const mode = statSync(join(directory, 'state')).mode
    const first = launch('hub.mjs', runtime, preload)
    await vi.waitFor(() => expect(first.stdout(), first.stderr()).toContain('ready'), {
      timeout: 5000
    })
    expect(statSync(join(directory, 'state')).mode).toBe(mode)
    const independent = launch(
      'hub.mjs',
      join(directory, 'independent-run'),
      undefined,
      join(directory, 'independent')
    )
    await vi.waitFor(() => expect(independent.stdout(), independent.stderr()).toContain('ready'), {
      timeout: 5000
    })
    independent.child.kill('SIGTERM')
    expect((await independent.exited)[0]).toBe(0)
    first.child.kill('SIGTERM')
    const contender = launch('hub.mjs', join(directory, 'run-two'))
    // The second process must never restore or publish an identity while the old
    // process still owns storage, even though their runtime locks differ.
    const [code] = await contender.exited
    expect(code, contender.stderr()).toBe(1)
    expect(existsSync(join(directory, 'run-two/hub-runtime.json'))).toBe(false)
    writeFileSync(release, '')
    expect((await first.exited)[0], first.stderr()).toBe(0)
    expect(readFileSync(marker, 'utf8')).toBe('done')
    expect(existsSync(join(directory, 'state/.tempad-hub-writer.lock'))).toBe(false)
    expect(existsSync(join(directory, 'assets/.tempad-hub-writer.lock'))).toBe(false)
    const nextRuntime = join(directory, 'run-three')
    const next = launch('hub.mjs', nextRuntime)
    await vi.waitFor(() => expect(next.stdout(), next.stderr()).toContain('ready'), {
      timeout: 5000
    })
    next.child.kill('SIGTERM')
    expect((await next.exited)[0], next.stderr()).toBe(0)
  },
  10000
)

it.each(['denied', 'stalled', 'closed'])(
  'bounds the initial CLI connection when it is %s',
  async (failure) => {
    const preload = join(bundle, `connect-${failure}.mjs`)
    writeFileSync(
      preload,
      `
    import net from 'node:net'; import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const timeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms >= 1000 ? 10 : ms, ...args);
    ${failure === 'stalled' ? 'let now = Date.now(); Date.now = () => now;' : ''}
    fs.lstatSync = () => ({isDirectory:()=>true,isSymbolicLink:()=>false,isSocket:()=>true,uid:process.getuid?.(),mode:0o700});
    net.connect = () => {
      process.stderr.write('fixture-connect\\n');
      const socket = new net.Socket();
      ${failure === 'stalled' ? 'now += 15000;' : ''}
      ${failure === 'denied' ? "queueMicrotask(() => socket.destroy(Object.assign(new Error('Fixture denied'), {code:'EACCES'})));" : ''}
      ${failure === 'closed' ? 'queueMicrotask(() => socket.destroy());' : ''}
      return socket;
    };
    syncBuiltinESMExports();
  `
    )
    const attempt = launch('cli.mjs', join(directory, `cli-${failure}`), preload)
    // Child startup/import time is separate from the bounded connection attempts.
    await vi.waitFor(() => expect(attempt.stderr()).toContain('fixture-connect'), {
      timeout: 5000
    })
    await vi.waitFor(() => expect(attempt.child.exitCode, attempt.stderr()).not.toBeNull(), {
      timeout: 5000
    })
    expect((await attempt.exited)[0]).toBe(1)
    const attempts = failure === 'stalled' ? 5 : 3
    expect(attempt.stderr()).toContain(
      `Unable to connect to TemPad Hub after ${attempts} startup attempts`
    )
    expect(attempt.stderr().match(/fixture-connect/g)).toHaveLength(attempts)
  },
  15000
)

it.skipIf(process.platform === 'win32')(
  'keeps reconnecting after more than three transient failures once a bridge has worked',
  async () => {
    const runtime = join(directory, 'reconnecting-cli')
    mkdirSync(runtime, { mode: 0o700 })
    let connections = 0
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      connections++
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += String(chunk)
        let end
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          const message = JSON.parse(line)
          if (!('id' in message)) continue
          socket.write(`${line}\n`)
          if (message.id === 1) socket.end()
        }
      })
    })
    const preload = join(bundle, 'reconnect-failures.mjs')
    writeFileSync(
      preload,
      `
    import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module';
    const timeout = globalThis.setTimeout, connect = net.connect;
    globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms >= 1000 ? 20 : ms, ...args);
    let calls = 0;
    net.connect = (...args) => {
      if (++calls === 1 || calls > 5) return connect(...args);
      const socket = new net.Socket();
      queueMicrotask(() => socket.destroy(Object.assign(new Error('Transient fixture error'), {code:'ETIMEDOUT'})));
      return socket;
    }; syncBuiltinESMExports();
  `
    )
    try {
      server.listen(join(runtime, 'mcp.sock'))
      await once(server, 'listening')
      chmodSync(join(runtime, 'mcp.sock'), 0o600)
      const attempt = launch('cli.mjs', runtime, preload)
      attempt.child.stdin!.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
      await vi.waitFor(() => expect(connections).toBe(2), { timeout: 3000 })
      attempt.child.stdin!.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
      await vi.waitFor(() => expect(attempt.stdout()).toContain('"id":2'))
      attempt.child.stdin!.end()
      expect((await attempt.exited)[0], attempt.stderr()).toBe(0)
    } finally {
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  5000
)

it.skipIf(process.platform === 'win32').each(['closed', 'invalid', 'denied-after-binding'])(
  'bounds an accepted CLI bridge that is %s',
  async (failure) => {
    const runtime = join(directory, failure === 'denied-after-binding' ? 'bridge-denied' : failure)
    mkdirSync(runtime, { mode: 0o700 })
    let connections = 0
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      // Keep a regressed fourth connection open so this test cannot create a hot loop.
      if (++connections > 3) return
      socket.end(
        failure === 'invalid'
          ? 'not JSON-RPC\n'
          : failure === 'denied-after-binding'
            ? '{"jsonrpc":"2.0","method":"notifications/tempad/client-binding","params":{"kind":"claude","sessionId":"reconnected-session"}}\n'
            : ''
      )
    })
    const preload = join(bundle, `bridge-${failure}.mjs`)
    writeFileSync(
      preload,
      `import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module';
      const timeout = globalThis.setTimeout, connect = net.connect;
      globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms >= 1000 ? 20 : ms, ...args);
      let calls = 0;
      net.connect = (...args) => {
        process.stderr.write('fixture-connect\\n');
        if (++calls === 1 || ${JSON.stringify(failure)} !== 'denied-after-binding') return connect(...args);
        const socket = new net.Socket();
        queueMicrotask(() => socket.destroy(Object.assign(new Error('Fixture denied'), {code:'EACCES'})));
        return socket;
      }; syncBuiltinESMExports();`
    )
    let attempt: ReturnType<typeof launch> | undefined
    try {
      server.listen(join(runtime, 'mcp.sock'))
      await once(server, 'listening')
      chmodSync(join(runtime, 'mcp.sock'), 0o600)
      attempt = launch('cli.mjs', runtime, preload)
      await vi.waitFor(() => expect(attempt!.stderr()).toContain('fixture-connect'), {
        timeout: 5000
      })
      await vi.waitFor(() => expect(attempt!.child.exitCode, attempt!.stderr()).not.toBeNull(), {
        timeout: 5000
      })
      expect((await attempt.exited)[0], attempt.stderr()).toBe(1)
      expect(attempt.stderr()).toContain(
        `Unable to connect to TemPad Hub after 3 ${failure === 'denied-after-binding' ? 'reconnect' : 'startup'} attempts`
      )
      expect(attempt.stderr().match(/fixture-connect/g)).toHaveLength(
        failure === 'denied-after-binding' ? 4 : 3
      )
      expect(connections).toBe(failure === 'denied-after-binding' ? 1 : 3)
      expect(attempt.stdout()).toBe('')
      expect(existsSync(join(runtime, 'hub-runtime.json'))).toBe(false)
    } finally {
      // Stop the CLI before removing its listener, even when an assertion fails.
      if (attempt && attempt.child.exitCode === null && attempt.child.signalCode === null) {
        attempt.child.kill()
        await attempt.exited
      }
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  15000
)

it.skipIf(process.platform === 'win32')(
  'backs off even when each accepted bridge sends a valid binding before closing',
  async () => {
    const runtime = join(directory, 'bridge-backoff')
    mkdirSync(runtime, { mode: 0o700 })
    const connectedAt: number[] = []
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      connectedAt.push(performance.now())
      if (connectedAt.length >= 3) return
      socket.end(
        '{"jsonrpc":"2.0","method":"notifications/tempad/client-binding","params":{"clearSessionHint":true}}\n'
      )
    })
    let attempt: ReturnType<typeof launch> | undefined
    try {
      server.listen(join(runtime, 'mcp.sock'))
      await once(server, 'listening')
      chmodSync(join(runtime, 'mcp.sock'), 0o600)
      attempt = launch('cli.mjs', runtime)
      await vi.waitFor(() => expect(connectedAt).toHaveLength(3), { timeout: 3000 })
      expect(connectedAt[1]! - connectedAt[0]!).toBeGreaterThanOrEqual(150)
      expect(connectedAt[2]! - connectedAt[1]!).toBeGreaterThanOrEqual(150)
      expect(attempt.stdout()).toBe('')
    } finally {
      if (attempt && attempt.child.exitCode === null && attempt.child.signalCode === null) {
        attempt.child.kill()
        await attempt.exited
      }
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  5000
)

it.skipIf(process.platform === 'win32')(
  'exits when the consumer ends stdin during reconnect backoff',
  async () => {
    const runtime = join(directory, 'bridge-stdin')
    mkdirSync(runtime, { mode: 0o700 })
    let notifyClosed!: () => void
    const firstClosed = new Promise<void>((resolve) => {
      notifyClosed = resolve
    })
    let connections = 0
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      if (++connections !== 1) return
      socket.on('close', notifyClosed)
      socket.resume()
      socket.end(
        '{"jsonrpc":"2.0","method":"notifications/tempad/client-binding","params":{"clearSessionHint":true}}\n'
      )
    })
    let attempt: ReturnType<typeof launch> | undefined
    try {
      server.listen(join(runtime, 'mcp.sock'))
      await once(server, 'listening')
      chmodSync(join(runtime, 'mcp.sock'), 0o600)
      attempt = launch('cli.mjs', runtime)
      await firstClosed
      await new Promise((resolve) => setTimeout(resolve, 30))
      attempt.child.stdin!.end()
      await vi.waitFor(() => expect(attempt!.child.exitCode).not.toBeNull(), { timeout: 1000 })
      expect((await attempt.exited)[0], attempt.stderr()).toBe(0)
    } finally {
      if (attempt && attempt.child.exitCode === null && attempt.child.signalCode === null) {
        attempt.child.kill()
        await attempt.exited
      }
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  5000
)
