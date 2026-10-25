import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import console from 'node:console'
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'tsdown'

import config from '../tsdown.config.ts'
import { runtimeSourceHash } from './runtime-source-hash.mjs'

if (process.platform === 'win32' || process.env.TEMPAD_MCP_DEV_CHECKOUT)
  throw new Error(
    'Runtime acquisition acceptance requires an isolated Unix release-test environment.'
  )
const exec = promisify(execFile)
const source = fileURLToPath(new URL('..', import.meta.url))
const repo = join(source, '../..')
const sourceHash = runtimeSourceHash(repo)
const root = await realpath(await mkdtemp(join(tmpdir(), 'tp-release-test-')))
const packaged = join(root, 'source.tgz')
const clients = []
const transports = []
let control
let succeeded = false
let runtimePids = []
const releases = new Map()
const requests = []
let online = true
const registry = createServer((req, res) => {
  requests.push(req.url)
  if (!online) {
    res.writeHead(503)
    res.end()
    return
  }
  const selector = req.url?.startsWith('/@tempad-dev%2fmcp/')
    ? req.url.slice('/@tempad-dev%2fmcp/'.length)
    : undefined
  const release = selector
    ? releases.get(selector === 'latest' ? [...releases.keys()].at(-1) : selector)
    : [...releases.values()].find(
        (item) => item.url === `http://127.0.0.1:${registry.address().port}${req.url}`
      )
  if (!release) {
    res.writeHead(404)
    res.end()
    return
  }
  if (selector) {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        name: '@tempad-dev/mcp',
        version: release.version,
        dist: { integrity: release.integrity, tarball: release.url }
      })
    )
  } else {
    res.setHeader('content-type', 'application/octet-stream')
    res.end(release.bytes)
  }
})
await new Promise((resolve) => registry.listen(0, '127.0.0.1', resolve))
const registryUrl = `http://127.0.0.1:${registry.address().port}`
const isolationEnv = {
  ...process.env,
  HOME: join(root, 'home'),
  TEMPAD_MCP_RUNTIME_DIR: join(root, 'run'),
  TEMPAD_MCP_STATE_DIR: join(root, 'state'),
  TEMPAD_MCP_ASSET_DIR: join(root, 'assets'),
  TEMPAD_MCP_LOG_DIR: join(root, 'logs')
}
for (const key of [
  'NODE_OPTIONS',
  'TEMPAD_MCP_DEV_CHECKOUT',
  'CODEX_HOME',
  'CODEX_SQLITE_HOME',
  'CODEX_THREAD_ID',
  'CODEX_APP_TOOLS_PIPE_PATH',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID'
])
  delete isolationEnv[key]
for (const path of ['home', 'run', 'state', 'assets', 'logs'])
  await mkdir(join(root, path), { mode: 0o700 })
// Verifier imports initialize logging; keep that tooling process private too.
for (const key of [
  'TEMPAD_MCP_RUNTIME_DIR',
  'TEMPAD_MCP_STATE_DIR',
  'TEMPAD_MCP_ASSET_DIR',
  'TEMPAD_MCP_LOG_DIR'
])
  process.env[key] = isolationEnv[key]
const verify = await import('../dist/runtime-verification.mjs')
const { ControlPeer, SocketTransport, ResultSchema, connectSocket } = verify
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const policy = JSON.parse(await readFile(join(source, 'runtime-policy.json'), 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
const versions = [0, 1, 2].map((offset) => `${major}.${minor}.${patch + offset}`)
async function until(check, label, timeout = 60_000) {
  const deadline = performance.now() + timeout
  do {
    const value = await check()
    if (value) return value
    await delay(50)
  } while (performance.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
async function makeArtifact(version, base, epoch) {
  const directory = join(root, version)
  await cp(base, directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ ...pkg, version }))
  await build({
    ...config,
    config: false,
    cwd: source,
    outDir: join(directory, 'dist'),
    sourcemap: false,
    plugins: [
      ...config.plugins,
      {
        name: 'isolated-release-fixture',
        load(id) {
          if (id === join(source, 'package.json')) return JSON.stringify({ ...pkg, version })
        },
        transform(code, id) {
          if (id === join(source, 'src/runtime-update/registry.ts')) {
            assert.ok(code.includes("const REGISTRY = 'https://registry.npmjs.org'"))
            return code.replace(
              "const REGISTRY = 'https://registry.npmjs.org'",
              `const REGISTRY = ${JSON.stringify(registryUrl)}`
            )
          }
          if (id === join(source, 'src/hub-runtime.ts')) {
            const boundary = 'const runtimeDataSockets = new Map<string, Socket>()'
            assert.ok(code.includes(boundary))
            code = code.replace(
              boundary,
              `${boundary}\n  if (!endpoints && options.prototype?.release) wsPortCandidates.splice(0, wsPortCandidates.length, 0)`
            )
            if (version !== versions[0])
              code = code.replace(
                "title: 'TemPad Dev'",
                "title: 'TemPad Dev compatible correction'"
              )
            return code
          }
        }
      }
    ]
  })
  await rm(join(directory, 'dist/runtime-manifest.json'), { force: true })
  const packed = JSON.parse(
    (
      await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
        cwd: directory,
        maxBuffer: 8 * 1024 * 1024
      })
    ).stdout
  )[0]
  const files = verify.readArchive(await readFile(join(root, packed.filename)))
  const probe = await verify.probeArtifact(join(directory, 'dist/managed-runtime.mjs'))
  const preceding = [...releases.values()].at(-1)
  const manifest = verify.ManifestSchema.parse({
    ...policy,
    packageVersion: version,
    guidanceEpoch: epoch,
    guidanceReview: {
      ...policy.guidanceReview,
      version,
      ...(preceding
        ? {
            decision: epoch === policy.guidanceEpoch ? 'compatible' : 'new-epoch',
            baseline: { version: preceding.version, integrity: preceding.integrity }
          }
        : {})
    },
    name: pkg.name,
    entry: 'dist/managed-runtime.mjs',
    node: pkg.engines.node,
    platforms: ['darwin', 'linux'],
    wireHash: probe.wireHash,
    presentationHash: probe.presentationHash,
    lockHash: 'a'.repeat(64),
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, verify.sha256(bytes)]))
  })
  if (preceding) verify.validatePolicyBaseline(manifest, preceding.manifest)
  await writeFile(join(directory, 'dist/runtime-manifest.json'), JSON.stringify(manifest))
  await rm(join(root, packed.filename))
  const final = JSON.parse(
    (
      await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
        cwd: directory,
        maxBuffer: 8 * 1024 * 1024
      })
    ).stdout
  )[0]
  const bytes = await readFile(join(root, final.filename))
  verify.verifyArchive(bytes, version, final.integrity)
  const release = {
    version,
    directory,
    manifest,
    bytes,
    integrity: final.integrity,
    url: `${registryUrl}/@tempad-dev/mcp/-/mcp-${version}.tgz`
  }
  releases.set(version, release)
  return release
}
async function client(release, policy = 'off', env = isolationEnv) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(release.directory, 'dist/cli.mjs'),
      ...(policy !== 'off' ? [`--runtime-updates=${policy}`] : [])
    ],
    env,
    stderr: 'pipe'
  })
  let diagnostic = ''
  transport.stderr?.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes).slice(-10_000)
  })
  transports.push(transport)
  const client = new Client({ name: 'release-acceptance', version: '1' })
  clients.push(client)
  try {
    await client.connect(transport, { timeout: 60_000 })
  } catch (error) {
    throw new Error(`${String(error)}\n${diagnostic}`, { cause: error })
  }
  return client
}
function exited(pid) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (error.code === 'ESRCH') return true
    throw error
  }
}
try {
  await exec(
    process.execPath,
    [join(source, 'scripts/prepare-runtime-release.mjs'), '--output', packaged],
    { maxBuffer: 8 * 1024 * 1024 }
  )
  const base = join(root, 'base')
  for (const [path, bytes] of verify.readArchive(await readFile(packaged))) {
    const target = join(base, path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { mode: 0o600 })
  }
  const a = await makeArtifact(versions[0], base, policy.guidanceEpoch)
  const b = await makeArtifact(versions[1], base, policy.guidanceEpoch)
  const defaultStatus = await exec(
    process.execPath,
    [join(a.directory, 'dist/cli.mjs'), '--runtime-update-status'],
    { env: isolationEnv }
  )
  assert.equal(JSON.parse(defaultStatus.stdout).managed, false)
  assert.equal(requests.length, 0)
  await assert.rejects(readFile(join(root, 'state/runtime/prototype.json')))
  const legacy = createSocketServer((socket) => socket.end())
  await new Promise((resolve) => legacy.listen(join(root, 'run/mcp.sock'), resolve))
  await chmod(join(root, 'run/mcp.sock'), 0o600)
  const before = requests.length
  await assert.rejects(
    exec(process.execPath, [join(a.directory, 'dist/cli.mjs'), '--check-runtime-update'], {
      env: isolationEnv
    }),
    /legacy Hub/
  )
  await new Promise((resolve) => legacy.close(resolve))
  assert.equal(requests.length, before)
  await assert.rejects(readFile(join(root, 'state/runtime/prototype.json')))

  await writeFile(join(root, 'assets/preserved.txt'), 'pre-enrollment asset')
  // A background metadata failure must disable checks, not kill the supervisor
  // or start acquisition without a durable attempt. Exercise a real write error.
  const storageFailureRoot = join(root, 'f')
  const storageFailureEnv = { ...isolationEnv }
  for (const [key, name] of Object.entries({
    TEMPAD_MCP_RUNTIME_DIR: 'run',
    TEMPAD_MCP_STATE_DIR: 'state',
    TEMPAD_MCP_ASSET_DIR: 'assets',
    TEMPAD_MCP_LOG_DIR: 'logs'
  })) {
    storageFailureEnv[key] = join(storageFailureRoot, name)
    await mkdir(storageFailureEnv[key], { recursive: true, mode: 0o700 })
  }
  const metadataTemporary = join(storageFailureRoot, 'state/runtime/updates.json.tmp')
  await mkdir(metadataTemporary, { recursive: true, mode: 0o700 })
  const storageFailureClient = await client(a, 'stable', storageFailureEnv)
  control = new ControlPeer()
  await control.connect(
    new SocketTransport(await connectSocket(join(storageFailureRoot, 'run/supervisor.sock')))
  )
  const storageFailure = await until(async () => {
    const value = await control.request({ method: 'tempad/runtime-status' }, ResultSchema)
    return value.updates.error?.includes('could not be saved') && value
  }, 'isolated update metadata failure')
  runtimePids = [storageFailure.supervisorPid, storageFailure.hubPid]
  assert.match(storageFailure.updates.error, /EISDIR/)
  assert.equal(storageFailure.updates.checking, false)
  assert.equal(requests.length, before, 'failed attempt must not query the registry')
  await storageFailureClient.ping()
  await storageFailureClient.listTools()
  const stillServing = await control.request({ method: 'tempad/runtime-status' }, ResultSchema)
  assert.equal(stillServing.supervisorPid, storageFailure.supervisorPid)
  assert.equal(stillServing.hubPid, storageFailure.hubPid)
  await control.close()
  await storageFailureClient.close()
  await until(() => runtimePids.every(exited), 'storage fault runtime shutdown', 15_000)
  await rm(metadataTemporary, { recursive: true })
  const started = performance.now()
  const [first, parallel] = await Promise.all([client(a, 'stable'), client(a, 'stable')])
  const firstInitializeMs = Math.round(performance.now() - started)
  await parallel.listTools()
  await parallel.close()
  const catalog = await first.listTools()
  control = new ControlPeer()
  await control.connect(new SocketTransport(await connectSocket(join(root, 'run/supervisor.sock'))))
  const request = (method, params) =>
    control.request({ method, ...(params ? { params } : {}) }, ResultSchema, { timeout: 180_000 })
  const status = () => request('tempad/runtime-status')
  const staged = await until(async () => {
    const value = await status()
    if (value.updates?.error) throw new Error(value.updates.error)
    return value.updates?.candidate?.version === b.version && value
  }, 'verified candidate staging')
  assert.equal(staged.active.version, a.version)
  assert.equal(staged.updates.automaticActivation, false)
  runtimePids = [staged.supervisorPid, staged.hubPid]
  const oldPid = staged.hubPid
  const second = await client(a)
  assert.equal((await status()).hubPid, oldPid, 'mixed policies must share the Hub')
  const count = requests.length
  await delay(200)
  assert.equal(requests.length, count, 'attachment must not multiply checks')
  assert.match(
    JSON.stringify(
      await request('tempad/runtime-activate', { version: b.version, integrity: b.integrity })
    ),
    /not opted in/
  )
  assert.equal((await status()).hubPid, oldPid)
  await second.close()
  await until(
    async () =>
      !(await status()).updates.pendingReasons.some((value) => value.includes('not opted in')),
    'pinned edge departure'
  )
  const activated = await request('tempad/runtime-activate', {
    version: b.version,
    integrity: b.integrity
  })
  assert.equal(activated.status, 'activated')
  const changed = await status()
  runtimePids = [changed.supervisorPid, changed.hubPid]
  assert.equal(changed.active.version, b.version)
  assert.notEqual(changed.hubPid, oldPid)
  assert.deepEqual(await first.listTools(), catalog, 'the original session keeps its presentation')
  await first.ping()
  const unpinned = await client(a)
  assert.equal(unpinned.getServerVersion().version, a.version, 'initialize identifies the edge')
  assert.equal(unpinned.getServerVersion().title, 'TemPad Dev compatible correction')
  await unpinned.close()
  await assert.rejects(client(a, 'pinned'), /pinned client requests a different runtime/)
  assert.equal(await readFile(join(root, 'assets/preserved.txt'), 'utf8'), 'pre-enrollment asset')

  const c = await makeArtifact(versions[2], base, policy.guidanceEpoch + 1)
  const incompatible = await request('tempad/runtime-check', { version: c.version })
  assert.ok(incompatible.pendingReasons.some((value) => value.includes('Guidance epoch')))
  assert.equal(
    (await request('tempad/runtime-activate', { version: c.version, integrity: c.integrity }))
      .status,
    'staged'
  )
  await assert.rejects(
    request('tempad/runtime-activate', { version: c.version, integrity: b.integrity }),
    /staged artifact changed/
  )
  assert.equal((await status()).hubPid, changed.hubPid)
  online = false
  await assert.rejects(request('tempad/runtime-check', { version: c.version }), /HTTP 503/)
  await first.ping()
  assert.equal((await status()).hubPid, changed.hubPid)
  const blockedCount = requests.length
  for (const bad of ['/missing/checkout', source]) {
    await assert.rejects(
      exec(process.execPath, [join(a.directory, 'dist/cli.mjs'), '--runtime-updates=stable'], {
        env: { ...isolationEnv, TEMPAD_MCP_DEV_CHECKOUT: bad },
        timeout: 10_000
      })
    )
    await assert.rejects(
      exec(
        process.execPath,
        [
          join(a.directory, 'dist/runtime-installer.mjs'),
          '--cache',
          join(root, 'bad-cache'),
          '--version',
          b.version,
          '--current',
          a.version
        ],
        { env: { ...isolationEnv, TEMPAD_MCP_DEV_CHECKOUT: bad }, timeout: 10_000 }
      )
    )
  }
  assert.equal(requests.length, blockedCount, 'checkout must never query the fixture registry')
  const cache = incompatible.candidate.release.directory
  await writeFile(join(cache, 'dist/managed-runtime.mjs'), 'corrupt cache')
  online = true
  await assert.rejects(request('tempad/runtime-check', { version: c.version }), /hash mismatch/)
  await first.ping()

  // A local restart is the escape hatch for a guidance/contract boundary. It must
  // promote both control and Hub without a registry check or losing durable state.
  await control.close()
  await first.close()
  await until(() => runtimePids.every(exited), 'all old runtime owners exited', 15_000)
  online = false
  const networkBeforeRestart = requests.length
  const [restarted, concurrent] = await Promise.all([client(c, 'pinned'), client(c, 'pinned')])
  control = new ControlPeer()
  await control.connect(new SocketTransport(await connectSocket(join(root, 'run/supervisor.sock'))))
  const cold = await status()
  runtimePids = [cold.supervisorPid, cold.hubPid]
  assert.equal(cold.active.version, c.version)
  assert.equal(cold.controlComponents.supervisor.version, c.version)
  assert.equal(cold.controlComponents.restartRequired, false)
  assert.equal(cold.updates.automaticActivation, false)
  assert.equal(requests.length, networkBeforeRestart, 'cold adoption uses only installed bytes')
  assert.equal(await readFile(join(root, 'assets/preserved.txt'), 'utf8'), 'pre-enrollment asset')
  const savedControl = JSON.parse(
    await readFile(join(root, 'state/runtime/prototype.json'), 'utf8')
  )
  assert.equal(savedControl.release.manifestHash, verify.sha256(JSON.stringify(c.manifest)))
  const coldJournal = JSON.parse(await readFile(join(root, 'state/runtime/switch.json'), 'utf8'))
  assert.equal(coldJournal.previous.version, b.version)
  assert.equal(coldJournal.coldStart, undefined)
  await concurrent.close()
  await restarted.ping()
  await assert.rejects(client(a, 'pinned'), /pinned client requests a different runtime/)
  assert.equal((await status()).hubPid, cold.hubPid, 'an old CLI cannot downgrade the owner')
  assert.equal(runtimeSourceHash(repo), sourceHash, 'Runtime sources changed during acceptance.')
  succeeded = true
  console.log(
    JSON.stringify({
      node: process.version,
      versions,
      firstInitializeMs,
      cases: [
        'verified-download',
        'stage-only',
        'shared-release-owner',
        'concurrent-first-enrollment',
        'non-opt-in-policy-block',
        'explicit-pin-conflict',
        'explicit-activation',
        'frozen-presentation',
        'epoch-block',
        'offline-runtime',
        'checkout-zero-network',
        'corrupt-cache',
        'legacy-migration-guard',
        'background-metadata-failure-isolation',
        'cold-guidance-upgrade',
        'concurrent-cold-upgrade',
        'cold-upgrade-offline',
        'old-cli-no-downgrade'
      ]
    })
  )
} finally {
  await control?.close()
  await Promise.allSettled(clients.map((client) => client.close()))
  await Promise.allSettled(transports.map((transport) => transport.close()))
  registry.closeAllConnections()
  await new Promise((resolve) => registry.close(resolve))
  verify.endLogging()
  if (runtimePids.length)
    await until(() => runtimePids.every(exited), 'release runtime shutdown', 15_000)
  // The worker/probe must close its own processes. Keep failed evidence intact.
  if (succeeded && !process.env.TEMPAD_KEEP_PROTOTYPE)
    await rm(root, { recursive: true, force: true })
  else console.error(`Release acceptance evidence: ${root}`)
}
