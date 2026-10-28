import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'tsdown'

import { assertPrivatePath, runtimeEndpoint } from '../src/runtime-platform.ts'
import config from '../tsdown.config.ts'
import { runPackageManager } from './package-manager.mjs'
import { runtimeSourceHash } from './runtime-source-hash.mjs'
import {
  FIXTURE_INITIALIZE_TIMEOUT_MS,
  commandArguments,
  fixtureEnvironment,
  fixtureRoot,
  preserveFixtureEvidence,
  processInventory
} from './runtime-test-platform.mjs'

if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
  throw new Error('Runtime acquisition acceptance requires an isolated release-test environment.')
const exec = promisify(execFile)
const source = fileURLToPath(new URL('..', import.meta.url))
const repo = join(source, '../..')
const sourceHash = runtimeSourceHash(repo)
if (process.env.TEMPAD_RUNTIME_EVIDENCE_DIR) await import('./runtime-startup-trace.mjs')
const root = await fixtureRoot('tp-release-test-')
const packaged = join(root, 'source.tgz')
const clients = []
const transports = []
let control
let occupiedAssetPort
let occupiedWebSocketPort
let succeeded = false
let runtimePids = []
const automaticPids = new Set()
const releases = new Map()
const requests = []
// UpdateManager permits a 240 s worker and resumes a partial scan after 30 s.
// Observe those production bounds; do not truncate a valid Windows acquisition.
const acquisitionTimeout = 245_000
const stagingTimeout = acquisitionTimeout + 30_000
let online = true
let latestVersion
function metadata(release) {
  return {
    name: '@tempad-dev/mcp',
    version: release.version,
    dist: { integrity: release.integrity, tarball: release.url }
  }
}
const registry = createServer((req, res) => {
  requests.push(req.url)
  if (!online) {
    res.writeHead(503)
    res.end()
    return
  }
  if (req.url === '/@tempad-dev%2fmcp') {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        name: '@tempad-dev/mcp',
        'dist-tags': { latest: latestVersion },
        versions: Object.fromEntries(
          [...releases].map(([version, release]) => [version, metadata(release)])
        )
      })
    )
    return
  }
  const selector = req.url?.startsWith('/@tempad-dev%2fmcp/')
    ? req.url.slice('/@tempad-dev%2fmcp/'.length)
    : undefined
  const release = selector
    ? releases.get(selector === 'latest' ? latestVersion : selector)
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
    res.end(JSON.stringify(metadata(release)))
  } else {
    res.setHeader('content-type', 'application/octet-stream')
    res.end(release.bytes)
  }
})
await new Promise((resolve) => registry.listen(0, '127.0.0.1', resolve))
const registryUrl = `http://127.0.0.1:${registry.address().port}`
const isolationEnv = {
  ...process.env,
  ...fixtureEnvironment(join(root, 'home'), root),
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
  'CODEX_SESSION_ID',
  'CODEX_APP_TOOLS_PIPE_PATH',
  'CLAUDECODE',
  'CLAUDE_CODE',
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
const { ControlPeer, SocketTransport, RuntimeDataTransport, ResultSchema, connectSocket } = verify
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const policy = JSON.parse(await readFile(join(source, 'runtime-policy.json'), 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
const versions = [0, 1, 2, 3].map((offset) => `${major}.${minor}.${patch + offset}`)
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
          if (resolve(id) === join(source, 'package.json'))
            return JSON.stringify({ ...pkg, version })
        },
        transform(code, id) {
          if (process.platform === 'win32' && resolve(id) === join(source, 'src/shared.ts')) {
            const boundary = 'export const SOCK_PATH = resolveSockPath()'
            assert.ok(code.includes(boundary), 'fixture public endpoint boundary changed')
            return code.replace(
              boundary,
              `import { runtimeEndpoint as fixtureRuntimeEndpoint } from './runtime-platform'\nexport const SOCK_PATH = fixtureRuntimeEndpoint(RUNTIME_DIR, 'mcp.sock')`
            )
          }
          if (resolve(id) === join(source, 'src/runtime-update/registry.ts')) {
            assert.ok(code.includes("const REGISTRY = 'https://registry.npmjs.org'"))
            return code.replace(
              "const REGISTRY = 'https://registry.npmjs.org'",
              `const REGISTRY = ${JSON.stringify(registryUrl)}`
            )
          }
          if (resolve(id) === join(source, 'src/runtime-update/cold-start.ts')) {
            const candidates = 'getMcpServerConfig(RUNTIME_PROFILE).wsPortCandidates'
            assert.ok(code.includes(candidates), 'fixture cold endpoint boundary changed')
            return code.replace(candidates, '[0]')
          }
          if (resolve(id) === join(source, 'src/hub-runtime.ts')) {
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
            const localRead = "case 'list_design_sessions':"
            const readStart = code.indexOf(localRead)
            assert.ok(readStart >= 0)
            const handler = 'handler: async () => {'
            const handlerStart = code.indexOf(handler, readStart) + handler.length
            assert.ok(handlerStart >= readStart + handler.length)
            // A real admitted local request stays pending long enough to observe
            // drain status; no native host or Figma execution is simulated here.
            code = `${code.slice(0, handlerStart)}\n            await new Promise((resolve) => setTimeout(resolve, 150))${code.slice(handlerStart)}`
            return code
          }
        }
      }
    ]
  })
  await rm(join(directory, 'dist/runtime-manifest.json'), { force: true })
  const packed = JSON.parse(
    (
      await runPackageManager(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
        {
          cwd: directory,
          maxBuffer: 8 * 1024 * 1024
        }
      )
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
    platforms: ['darwin', 'linux', 'win32'],
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
      await runPackageManager(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
        {
          cwd: directory,
          maxBuffer: 8 * 1024 * 1024
        }
      )
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
  latestVersion = version
  return release
}
async function client(release, policy = 'off', env = isolationEnv, name = 'release-acceptance') {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(release.directory, 'dist/cli.mjs'),
      ...(policy !== 'default' ? [`--runtime-updates=${policy}`] : [])
    ],
    env,
    stderr: 'pipe'
  })
  let diagnostic = ''
  transport.stderr?.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes).slice(-10_000)
  })
  transports.push(transport)
  const client = new Client({ name, version: '1' })
  clients.push(client)
  try {
    await client.connect(transport, { timeout: FIXTURE_INITIALIZE_TIMEOUT_MS })
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

async function stopFixture(directory) {
  const runtimeRoot = join(directory, 'state/runtime')
  for (const [role, path] of [
    ['supervisor', join(runtimeRoot, 'supervisor.json')],
    ['hub', join(directory, 'run/hub-runtime.json')]
  ]) {
    let record
    try {
      assertPrivatePath(path, 'file')
      record = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    const pid = role === 'supervisor' ? record.pid : record.processId
    const entry = role === 'supervisor' ? record.entry : record.entryPath
    assert.ok(Number.isInteger(pid) && pid > 0 && entry.startsWith(`${root}${sep}`))
    if (exited(pid)) continue
    let command
    try {
      command = processInventory().find((value) => value.pid === pid)?.command
      if (!command && exited(pid)) continue
      assert.ok(command, 'fixture process command must be inspectable before cleanup')
    } catch (error) {
      if (exited(pid)) continue
      throw error
    }
    assert.deepEqual(commandArguments(command).slice(-5), [
      entry,
      '--root',
      runtimeRoot,
      '--role',
      role
    ])
    try {
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    await until(() => exited(pid), `${role} fixture cleanup`, 15_000)
  }
}

async function automaticAcceptance(a, b) {
  const directory = join(root, 'auto')
  const env = { ...isolationEnv }
  for (const [key, name] of Object.entries({
    TEMPAD_MCP_RUNTIME_DIR: 'run',
    TEMPAD_MCP_STATE_DIR: 'state',
    TEMPAD_MCP_ASSET_DIR: 'assets',
    TEMPAD_MCP_LOG_DIR: 'logs'
  })) {
    env[key] = join(directory, name)
    await mkdir(env[key], { recursive: true, mode: 0o700 })
  }
  // These are SDK clients with host identity fixtures, not installed-host
  // acceptance. Hold publication until an explicit opt-out observer is attached.
  const firstClient = clients.length
  const firstTransport = transports.length
  const published = latestVersion
  latestVersion = a.version
  const owner = new ControlPeer()
  const controlPeers = [owner]
  try {
    const generic = await client(a, 'default', env)
    const codexEnv = { ...env, CODEX_THREAD_ID: 'automatic-release-fixture' }
    const codex = await client(a, 'default', codexEnv, 'codex-mcp-client')
    const catalog = await codex.listTools()
    const genericCatalog = await generic.listTools()
    let observer = await client(a, 'off', env)
    await owner.connect(
      new SocketTransport(
        await connectSocket(runtimeEndpoint(join(directory, 'run'), 'supervisor.sock'))
      )
    )
    const status = async () => {
      const state = await owner.request({ method: 'tempad/runtime-status' }, ResultSchema)
      for (const pid of [state.supervisorPid, state.hubPid]) if (pid) automaticPids.add(pid)
      return state
    }
    await until(async () => {
      const state = await status()
      return state.updates.lastAttempt && !state.updates.checking
    }, 'initial default update check')
    // Exercise the real CLI confirmation using controlled pipes. An exact version
    // above latest can be downloaded, but cancelling must not enroll it for idle activation.
    const confirmation = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      process.argv = [process.execPath, ${JSON.stringify(join(a.directory, 'dist/cli.mjs'))}, '--update-runtime', ${JSON.stringify(b.version)}];
      await import(${JSON.stringify(pathToFileURL(join(a.directory, 'dist/cli.mjs')).href)});
    `
      ],
      { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    )
    let prompt = ''
    let confirmationError = ''
    const confirmed = once(confirmation, 'exit', {
      signal: globalThis.AbortSignal.timeout(acquisitionTimeout + 5000)
    })
    confirmation.stdout.on('data', (bytes) => {
      prompt = (prompt + bytes).slice(-10000)
      if (prompt.includes('Type "update') && !confirmation.stdin.writableEnded)
        confirmation.stdin.end('cancel\n')
    })
    confirmation.stderr.on('data', (bytes) => {
      confirmationError = (confirmationError + bytes).slice(-10000)
    })
    try {
      assert.notEqual((await confirmed)[0], 0)
    } finally {
      if (confirmation.exitCode === null) confirmation.kill()
    }
    assert.match(confirmationError, /activation cancelled/)
    assert.equal((await status()).updates.manualCandidate.version, b.version)
    await observer.close()
    const manualWait = performance.now() + 8000
    await until(async () => {
      assert.equal(
        (await status()).active.version,
        a.version,
        'cancelled exact release must never auto-activate'
      )
      return performance.now() >= manualWait
    }, 'manual staging remains inactive')
    observer = await client(a, 'off', env)
    latestVersion = published
    const stagingStarted = performance.now()
    await owner.request(
      { method: 'tempad/runtime-check', params: { version: 'latest' } },
      ResultSchema,
      { timeout: acquisitionTimeout }
    )
    const staged = await until(
      async () => {
        const state = await status()
        if (state.updates.error) throw new Error(state.updates.error)
        return state.updates.candidate?.version === b.version && state
      },
      'automatic fixture staging',
      stagingTimeout
    )
    const stagingMs = Math.round(performance.now() - stagingStarted)
    assert.equal(staged.active.version, a.version)
    assert.equal(staged.updates.selection.latest, published)
    assert.ok(
      staged.updates.selection.latestReasons.some((reason) => reason.includes('Guidance epoch'))
    )
    assert.equal(staged.updates.automaticActivation, false)
    assert.deepEqual(
      staged.autoBlockers,
      [],
      'initialized generic clients support automatic switching'
    )
    const oldPid = staged.hubPid
    const remainsStaged = async (reason) => {
      const deadline = performance.now() + 8000
      await until(async () => {
        const state = await status()
        assert.equal(state.hubPid, oldPid, reason)
        return performance.now() >= deadline
      }, reason)
    }
    // Keep the data socket alive independently of the supervisor connection.
    // A disconnected opt-out edge must not disappear from update admission.
    const detachedEdge = async (policy) => {
      const registration = {
        sessionId: randomUUID(),
        token: randomUUID(),
        versions: [2],
        updates: {
          policy,
          version: a.version,
          manifestHash: verify.sha256(
            await readFile(join(a.directory, 'dist/runtime-manifest.json'))
          )
        },
        context: {
          version: 1,
          home: directory,
          tempDir: directory,
          codexHome: directory,
          codexSqliteHome: directory
        }
      }
      let peer
      let grant
      const reconnect = async () => {
        peer = new ControlPeer()
        controlPeers.push(peer)
        await peer.connect(
          new SocketTransport(
            await connectSocket(runtimeEndpoint(join(directory, 'run'), 'supervisor.sock'))
          )
        )
        grant = await peer.request(
          { method: 'tempad/runtime-hello', params: registration },
          ResultSchema
        )
        await peer.request(
          {
            method: 'tempad/runtime-ready',
            params: { hubId: grant.hubId }
          },
          ResultSchema
        )
      }
      await reconnect()
      const wire = new SocketTransport(
        await connectSocket(runtimeEndpoint(join(directory, 'run'), 'runtime-hub.sock'))
      )
      await new Promise((resolve, reject) => {
        wire.onerror = reject
        wire.onclose = () => reject(new Error('Data attachment closed'))
        wire.onmessage = (message) =>
          'result' in message ? resolve() : reject(new Error(JSON.stringify(message)))
        void wire
          .start()
          .then(() =>
            wire.send({
              jsonrpc: '2.0',
              id: 1,
              method: 'tempad/runtime-attach',
              params: { sessionId: registration.sessionId, token: registration.token }
            })
          )
          .catch(reject)
      })
      const data = new Client({ name: 'detached-control-fixture', version: '1' })
      clients.push(data)
      await data.connect(
        new RuntimeDataTransport(wire, {
          role: 'edge',
          generation: () => grant.generation,
          admit: () => true,
          started: true
        })
      )
      return { data, reconnect, disconnect: () => peer.close() }
    }
    const claude = await client(a, 'stable', { ...env, CLAUDECODE: '1' }, 'claude-code')
    await observer.close()
    const claudeBlocked = await until(async () => {
      const state = await status()
      return state.autoBlockers.some((reason) => reason.includes('Claude')) && state
    }, 'unverified Claude hook blocker')
    assert.equal(claudeBlocked.hubPid, oldPid)
    await remainsStaged('unverified Claude bindings must keep the candidate staged')
    const off = await client(a, 'off', codexEnv, 'codex-mcp-client')
    const hook = async (version) => {
      const params = {
        version,
        kind: 'claude',
        sessionId: 'automatic-claude-fixture',
        event: 'PreToolUse',
        invocationId: randomUUID(),
        ...(version === 2 ? { issuedAt: Date.now(), profile: { kind: 'release' } } : {})
      }
      return until(async () => {
        const peer = new ControlPeer()
        try {
          await peer.connect(
            new SocketTransport(
              await connectSocket(runtimeEndpoint(join(directory, 'run'), 'mcp.sock'))
            )
          )
          const result = await peer.request({ method: 'tempad/client-hook', params }, ResultSchema)
          if (version === 1) return result
          assert.equal(result.receipt.invocationId, params.invocationId)
          return result.receipt.state === 'applied' && result
        } finally {
          await peer.close()
        }
      }, 'Claude hook receipt applied')
    }
    await claude.notification({
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'claude', sessionId: 'automatic-claude-fixture' }
    })
    await hook(1)
    await claude.callTool({ name: 'list_design_sessions', arguments: {} })
    assert.ok(
      (await status()).blockers.includes('Claude binding without receipt/retry hooks'),
      'legacy hooks must still prevent handoff'
    )
    const receipt = await hook(2)
    assert.equal(receipt.receipt.version, 2)
    await claude.callTool({ name: 'list_design_sessions', arguments: {} })
    const policyBlocked = await until(async () => {
      const state = await status()
      return state.autoBlockers.length === 0 && state
    }, 'Claude binding has verified receipt/retry hooks')
    assert.ok(
      policyBlocked.updates.pendingReasons.some((reason) => reason.includes('not opted in'))
    )
    assert.equal(policyBlocked.updates.automaticActivation, false)
    assert.equal(policyBlocked.hubPid, oldPid)
    await remainsStaged('a non-opt-in peer must keep the candidate staged')

    const detached = await detachedEdge('off')
    const pinned = await detachedEdge('pinned')
    await detached.disconnect()
    await pinned.disconnect()
    await off.close()
    await remainsStaged('off/pinned data connections must survive control-only disconnects')
    assert.ok(
      (await status()).updates.automaticPendingReasons.some((reason) =>
        reason.includes('control connection')
      )
    )
    await detached.data.ping()
    await pinned.data.ping()
    await detached.reconnect()
    await remainsStaged('reconnected off policy must still block activation')
    await detached.disconnect()
    await detached.data.close()
    await remainsStaged('remaining pinned data connection must still block activation')
    await pinned.reconnect()
    await remainsStaged('reconnected pinned policy must still block activation')
    await pinned.disconnect()

    // Every completed call resets the quiet window. Keep sending actual tool
    // calls longer than that window, including while the non-opt-in peer exits.
    const workUntil = performance.now() + 6500
    let calls = 0
    let workError
    const work = (async () => {
      do {
        const result = await codex.callTool({ name: 'list_design_sessions', arguments: {} })
        assert.notEqual(result.isError, true)
        calls++
      } while (performance.now() < workUntil)
    })().catch((error) => {
      workError = error
    })
    await until(async () => {
      const state = await status()
      return state.blockers.includes('admitted MCP calls')
    }, 'actual admitted tool work')
    await pinned.data.close()
    while (performance.now() < workUntil) {
      assert.equal((await status()).hubPid, oldPid, 'busy work must not be interrupted to update')
      await delay(100)
    }
    await work
    if (workError) throw workError
    assert.ok(calls > 1)

    let gateStarted
    let waitingCall
    const changed = await until(async () => {
      const state = await status()
      if (state.gated && !gateStarted) {
        gateStarted = performance.now()
        waitingCall = codex.callTool({ name: 'list_design_sessions', arguments: {} })
        // Observe failures immediately even while the status loop is pending.
        void waitingCall.catch(() => {})
      }
      return state.active.version === b.version && !state.gated && state
    }, 'automatic compatible activation')
    assert.ok(gateStarted, 'the real admission pause must be observed')
    const admissionPauseMs = Math.round(performance.now() - gateStarted)
    assert.notEqual((await waitingCall).isError, true, 'a call arriving during handoff must wait')
    assert.notEqual(changed.hubPid, oldPid)
    assert.equal(changed.supervisorPid, staged.supervisorPid)
    assert.deepEqual(await codex.listTools(), catalog, 'automatic switching preserves the catalog')
    assert.deepEqual(await generic.listTools(), genericCatalog, 'generic session keeps its catalog')
    await codex.ping()
    await generic.ping()
    await hook(2)
    assert.notEqual(
      (await claude.callTool({ name: 'list_design_sessions', arguments: {} })).isError,
      true,
      'Claude keeps its MCP connection across automatic switching'
    )
    assert.deepEqual((await status()).autoBlockers, [])
    await claude.close()
    await codex.close()
    await generic.close()
    await until(() => [...automaticPids].every(exited), 'automatic fixture shutdown', 15_000)
    return { stagingMs, admissionPauseMs, uninterruptedCalls: calls }
  } catch (error) {
    const diagnostic = await owner
      .request({ method: 'tempad/runtime-status' }, ResultSchema, { timeout: 5000 })
      .catch((inspectionError) => ({ error: String(inspectionError) }))
    await writeFile(
      join(directory, 'failure-status.json'),
      JSON.stringify(diagnostic, null, 2)
    ).catch((inspectionError) => console.error(`Could not save failure status: ${inspectionError}`))
    await preserveFixtureEvidence(directory, error.stack)
    throw error
  } finally {
    latestVersion = published
    await Promise.all(controlPeers.map((peer) => peer.close()))
    await Promise.allSettled(clients.slice(firstClient).map((client) => client.close()))
    await Promise.allSettled(transports.slice(firstTransport).map((transport) => transport.close()))
    // A failed initialize can leave an owner before status ever records its PID.
    // Only stop processes whose private records and live argv match this fixture.
    await stopFixture(directory)
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
  const c = await makeArtifact(versions[2], base, policy.guidanceEpoch + 1)
  // Stable selection must not fetch this untagged version.
  const ahead = {
    ...b,
    version: versions[3],
    bytes: Buffer.from('not a stable release'),
    url: `${registryUrl}/@tempad-dev/mcp/-/mcp-${versions[3]}.tgz`
  }
  releases.set(ahead.version, ahead)
  const defaultStatus = await exec(
    process.execPath,
    [join(a.directory, 'dist/cli.mjs'), '--runtime-update-status'],
    { env: isolationEnv }
  )
  assert.equal(JSON.parse(defaultStatus.stdout).managed, false)
  assert.equal(requests.length, 0)
  await assert.rejects(readFile(join(root, 'state/runtime/prototype.json')))
  const legacySockets = new Set()
  let legacyBytes = 0
  const legacy = createSocketServer((socket) => {
    legacySockets.add(socket)
    socket.once('close', () => legacySockets.delete(socket))
    socket.on('data', (chunk) => {
      legacyBytes += chunk.length
    })
  })
  const legacyPath = runtimeEndpoint(join(root, 'run'), 'mcp.sock')
  await new Promise((resolve) => legacy.listen(legacyPath, resolve))
  // Released Windows Hubs used the default pipe ACL; do not upgrade the fixture's ACL.
  if (process.platform !== 'win32') await chmod(legacyPath, 0o600)
  const before = requests.length
  try {
    await assert.rejects(
      exec(process.execPath, [join(a.directory, 'dist/cli.mjs'), '--check-runtime-update'], {
        env: isolationEnv
      }),
      process.platform === 'win32' ? /Close\/restart all TemPad MCP connections once/ : /legacy Hub/
    )
    assert.equal(legacyBytes, 0)
  } finally {
    for (const socket of legacySockets) socket.destroy()
    await new Promise((resolve) => legacy.close(resolve))
  }
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
    new SocketTransport(
      await connectSocket(runtimeEndpoint(join(storageFailureRoot, 'run'), 'supervisor.sock'))
    )
  )
  const storageFailure = await until(async () => {
    const value = await control.request({ method: 'tempad/runtime-status' }, ResultSchema)
    return value.updates.error?.includes('could not be saved') && value
  }, 'isolated update metadata failure')
  runtimePids = [storageFailure.supervisorPid, storageFailure.hubPid]
  assert.match(storageFailure.updates.error, /EISDIR|EPERM|EACCES/)
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
  latestVersion = a.version
  const started = performance.now()
  const [first, parallel] = await Promise.all([client(a, 'stable'), client(a, 'stable')])
  const firstInitializeMs = Math.round(performance.now() - started)
  await parallel.listTools()
  await parallel.close()
  const catalog = await first.listTools()
  const second = await client(a, 'off')
  control = new ControlPeer()
  await control.connect(
    new SocketTransport(await connectSocket(runtimeEndpoint(join(root, 'run'), 'supervisor.sock')))
  )
  const request = (method, params) =>
    control.request({ method, ...(params ? { params } : {}) }, ResultSchema, {
      timeout: method === 'tempad/runtime-check' ? acquisitionTimeout : 180_000
    })
  const status = () => request('tempad/runtime-status')
  await until(async () => {
    const state = await status()
    return state.updates.lastAttempt && !state.updates.checking
  }, 'initial check before candidate publication')
  const beforeNoninteractive = requests.length
  await assert.rejects(
    exec(process.execPath, [join(a.directory, 'dist/cli.mjs'), '--update-runtime', ahead.version], {
      env: isolationEnv
    }),
    /interactive confirmation/
  )
  assert.equal(
    requests.length,
    beforeNoninteractive,
    'noninteractive activation must not acquire a release'
  )
  assert.equal((await status()).updates.manualCandidate, undefined)
  latestVersion = c.version
  const stagingStarted = performance.now()
  await request('tempad/runtime-check', { version: 'latest' })
  const staged = await until(
    async () => {
      const value = await status()
      if (value.updates?.error) throw new Error(value.updates.error)
      return value.updates?.candidate?.version === b.version && value
    },
    'verified candidate staging',
    stagingTimeout
  )
  const stagingMs = Math.round(performance.now() - stagingStarted)
  assert.equal(staged.active.version, a.version)
  assert.equal(staged.updates.selection.latest, c.version)
  assert.ok(
    staged.updates.selection.latestReasons.some((reason) => reason.includes('Guidance epoch'))
  )
  assert.equal(staged.updates.automaticActivation, false)
  runtimePids = [staged.supervisorPid, staged.hubPid]
  const oldPid = staged.hubPid
  const endpointPath = join(root, 'state/runtime/endpoints.json')
  const fixedEndpoints = JSON.parse(await readFile(endpointPath, 'utf8'))
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
  // Leave a fresh quiet window for the explicit transaction to acquire ownership
  // before the automatic scheduler can consider this same compatible candidate.
  assert.notEqual(
    (await first.callTool({ name: 'list_design_sessions', arguments: {} })).isError,
    true
  )
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
  assert.deepEqual(
    JSON.parse(await readFile(endpointPath, 'utf8')),
    fixedEndpoints,
    'a hot handoff must preserve asset ports and credentials'
  )
  assert.deepEqual(await first.listTools(), catalog, 'the original session keeps its presentation')
  await first.ping()
  const unpinned = await client(a)
  assert.equal(unpinned.getServerVersion().version, a.version, 'initialize identifies the edge')
  assert.equal(unpinned.getServerVersion().title, 'TemPad Dev compatible correction')
  await unpinned.close()
  await assert.rejects(client(a, 'pinned'), /pinned client requests a different runtime/)
  assert.equal(await readFile(join(root, 'assets/preserved.txt'), 'utf8'), 'pre-enrollment asset')

  const automatic = await automaticAcceptance(a, b)

  assert.ok(requests.includes('/@tempad-dev%2fmcp'), 'stable checks must read the release catalog')
  assert.ok(!requests.some((path) => path?.endsWith(`/mcp-${ahead.version}.tgz`)))
  latestVersion = a.version
  const rolledBackTag = await request('tempad/runtime-check', { version: 'latest' })
  assert.equal(rolledBackTag.candidate, undefined, 'moving latest backwards must not downgrade')
  assert.equal((await status()).active.version, b.version)
  latestVersion = c.version
  const olderExact = await request('tempad/runtime-check', { version: a.version })
  assert.equal(
    olderExact.candidate,
    undefined,
    'an exact request must not substitute another release'
  )
  assert.equal((await status()).active.version, b.version)
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
  const repaired = await request('tempad/runtime-check', { version: c.version })
  assert.equal(repaired.candidate.version, c.version)
  assert.match((await status()).updates.cacheWarning, /hash mismatch/)
  await first.ping()

  // A local restart is the escape hatch for a guidance/contract boundary. It must
  // promote both control and Hub without a registry check or losing durable state.
  await control.close()
  await first.close()
  await until(() => runtimePids.every(exited), 'all old runtime owners exited', 15_000)
  occupiedAssetPort = createServer()
  await once(occupiedAssetPort.listen(fixedEndpoints.httpPort, '127.0.0.1'), 'listening')
  online = false
  const networkBeforeRestart = requests.length
  const [restarted, concurrent] = await Promise.all([client(c, 'pinned'), client(c, 'pinned')])
  control = new ControlPeer()
  await control.connect(
    new SocketTransport(await connectSocket(runtimeEndpoint(join(root, 'run'), 'supervisor.sock')))
  )
  const cold = await status()
  runtimePids = [cold.supervisorPid, cold.hubPid]
  assert.equal(cold.active.version, c.version)
  assert.equal(cold.controlComponents.supervisor.version, c.version)
  assert.equal(cold.controlComponents.restartRequired, false)
  assert.equal(cold.updates.automaticActivation, false)
  assert.equal(requests.length, networkBeforeRestart, 'cold adoption uses only installed bytes')
  const coldEndpoints = JSON.parse(await readFile(endpointPath, 'utf8'))
  assert.notEqual(coldEndpoints.httpPort, fixedEndpoints.httpPort)
  assert.deepEqual(
    { ...coldEndpoints, httpPort: fixedEndpoints.httpPort },
    fixedEndpoints,
    'cold HTTP reallocation preserves credentials and the rollback-compatible metadata format'
  )
  await new Promise((resolve) => occupiedAssetPort.close(resolve))
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
  await control.close()
  await restarted.close()
  await until(() => runtimePids.every(exited), 'cold HTTP fixture owners exited', 15_000)
  occupiedWebSocketPort = createServer()
  await once(occupiedWebSocketPort.listen(coldEndpoints.wsPort, '127.0.0.1'), 'listening')
  const wsRestarted = await client(c, 'pinned')
  control = new ControlPeer()
  await control.connect(
    new SocketTransport(await connectSocket(runtimeEndpoint(join(root, 'run'), 'supervisor.sock')))
  )
  const wsCold = await status()
  runtimePids = [wsCold.supervisorPid, wsCold.hubPid]
  const wsEndpoints = JSON.parse(await readFile(endpointPath, 'utf8'))
  assert.notEqual(wsEndpoints.wsPort, coldEndpoints.wsPort)
  assert.deepEqual({ ...wsEndpoints, wsPort: coldEndpoints.wsPort }, coldEndpoints)
  await wsRestarted.ping()
  await new Promise((resolve) => occupiedWebSocketPort.close(resolve))
  assert.equal(runtimeSourceHash(repo), sourceHash, 'Runtime sources changed during acceptance.')
  succeeded = true
  console.log(
    JSON.stringify({
      node: process.version,
      versions,
      firstInitializeMs,
      stagingMs,
      automatic,
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
        'cold-occupied-http-port',
        'cold-occupied-websocket-port',
        'hot-endpoint-preservation',
        'old-cli-no-downgrade',
        'automatic-compatible-activation',
        'automatic-generic-host-activation',
        'automatic-claude-block',
        'automatic-non-opt-in-block',
        'automatic-busy-work-deferral',
        'automatic-handoff-request-wait',
        'default-release-enrollment',
        'newest-compatible-selection',
        'stable-tag-ceiling',
        'stable-tag-rollback-no-downgrade',
        'exact-version-no-substitution'
      ]
    })
  )
} catch (error) {
  await preserveFixtureEvidence(root, error.stack)
  throw error
} finally {
  if (occupiedAssetPort?.listening) await new Promise((resolve) => occupiedAssetPort.close(resolve))
  if (occupiedWebSocketPort?.listening)
    await new Promise((resolve) => occupiedWebSocketPort.close(resolve))
  await control?.close()
  await Promise.allSettled(clients.map((client) => client.close()))
  await Promise.allSettled(transports.map((transport) => transport.close()))
  registry.closeAllConnections()
  await new Promise((resolve) => registry.close(resolve))
  verify.endLogging()
  if (runtimePids.length)
    await until(() => runtimePids.every(exited), 'release runtime shutdown', 15_000)
  if (automaticPids.size)
    await until(() => [...automaticPids].every(exited), 'automatic fixture shutdown', 15_000)
  // The worker/probe must close its own processes. Keep failed evidence intact.
  if (succeeded && !process.env.TEMPAD_KEEP_PROTOTYPE)
    await rm(root, { recursive: true, force: true })
  else console.error(`Release acceptance evidence: ${root}`)
}
