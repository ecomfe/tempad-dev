import { execFile, spawn } from 'node:child_process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

import {
  compareContracts,
  compareReleaseWindow,
  digest,
  runtimeContract,
  summarize
} from './runtime-contract.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    runs: { type: 'string', default: '5' },
    lockfile: { type: 'string' }
  }
})
const runs = Number(values.runs)
if (process.platform === 'win32')
  throw new Error('Runtime measurement requires isolated Unix sockets.')
if (!values.output || !positionals.length || !Number.isInteger(runs) || runs < 1 || runs > 100)
  throw new Error(
    'Usage: measure-runtime.mjs --output <new.json> [--runs 5] [--lockfile <path>] <installed-package-dir> [...]'
  )

const isolation = fileURLToPath(new URL('./runtime-probe-isolation.mjs', import.meta.url))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const execute = promisify(execFile)

async function artifactFiles(root, path = 'dist') {
  const entries = await readdir(join(root, path), { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = `${path}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await artifactFiles(root, name)))
    else if (entry.isFile()) files.push([name, sha256(await readFile(join(root, name)))])
    else throw new Error(`Unexpected artifact entry: ${name}`)
  }
  return files
}

function launch(path, env) {
  const child = spawn(process.execPath, ['--import', isolation, path], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let diagnostic = ''
  let failure
  child.stderr.on('data', (data) => {
    diagnostic = (diagnostic + data).slice(-64000)
  })
  child.on('error', (error) => {
    failure = error
  })
  child.stdin.on('error', (error) => {
    failure = error
  })
  return {
    child,
    assertRunning() {
      if (failure) throw failure
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Measurement process exited: ${diagnostic}`)
    }
  }
}

async function stop({ child }) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  child.kill('SIGTERM')
  const timer = globalThis.setTimeout(() => child.kill('SIGKILL'), 3000)
  try {
    await closed
  } finally {
    globalThis.clearTimeout(timer)
  }
}

function peer(process) {
  const { child } = process
  const pending = new Map()
  let sequence = 0
  const lines = createInterface({ input: child.stdout })
  const fail = (error) => {
    for (const item of pending.values()) item.reject(error)
    pending.clear()
  }
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line)
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id)
      if (message.error) item.reject(new Error(JSON.stringify(message.error)))
      else item.resolve(message.result)
    } catch (error) {
      fail(error)
    }
  })
  child.once('close', () => fail(new Error('CLI closed during measurement.')))
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  return {
    notify(method) {
      send({ method })
    },
    async request(method, params) {
      process.assertRunning()
      const id = ++sequence
      let timer
      try {
        return await new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject })
          timer = globalThis.setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Timed out waiting for ${method}.`))
          }, 15000)
          send({ id, method, ...(params ? { params } : {}) })
        })
      } finally {
        globalThis.clearTimeout(timer)
      }
    }
  }
}

async function list(client, method, key) {
  const entries = []
  const cursors = new Set()
  let cursor
  do {
    const result = await client.request(method, cursor ? { cursor } : undefined)
    if (!Array.isArray(result[key])) throw new Error(`Invalid ${method} response.`)
    entries.push(...result[key])
    cursor = result.nextCursor
    if (
      cursor !== undefined &&
      (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || cursors.size >= 100)
    )
      throw new Error(`Invalid or repeated ${method} cursor.`)
    cursors.add(cursor)
  } while (cursor !== undefined)
  return entries
}

async function initialize(client) {
  const result = await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'isolated-runtime-measurement', version: '1' }
  })
  client.notify('notifications/initialized')
  return result
}

async function rss(processes) {
  const { stdout } = await execute('ps', [
    '-o',
    'pid=,rss=',
    '-p',
    processes.map(({ child }) => child.pid).join(',')
  ])
  const values = new Map(
    stdout
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
  )
  return processes.map(({ child }) => {
    const value = values.get(child.pid)
    if (!Number.isFinite(value) || value <= 0) throw new Error('Missing process RSS sample.')
    return value
  })
}

async function measure(root) {
  const temporary = await realpath(await mkdtemp('/tmp/tp-m-'))
  const env = {
    PATH: process.env.PATH,
    HOME: temporary,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    TEMPAD_PROBE_ROOT: temporary,
    TEMPAD_MCP_RUNTIME_DIR: join(temporary, 'run'),
    TEMPAD_MCP_LOG_DIR: join(temporary, 'log'),
    TEMPAD_MCP_ASSET_DIR: join(temporary, 'assets'),
    TEMPAD_MCP_STATE_DIR: join(temporary, 'state'),
    TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  }
  const processes = []
  const start = performance.now()
  try {
    // Direct launch makes cleanup ownership unambiguous; CLIs cannot spawn replacements.
    const hub = launch(join(root, 'dist/hub.mjs'), env)
    processes.push(hub)
    const deadline = Date.now() + 15000
    while (
      !(await stat(join(temporary, 'run/mcp.sock')).catch((error) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      }))
    ) {
      hub.assertRunning()
      if (Date.now() > deadline) throw new Error('The private Hub did not publish its socket.')
      await setTimeout(10)
    }
    const hubReadyMs = performance.now() - start
    const firstStarted = performance.now()
    const first = launch(join(root, 'dist/cli.mjs'), env)
    processes.push(first)
    const client = peer(first)
    const initialized = await initialize(client)
    const firstInitializeMs = performance.now() - firstStarted
    const snapshot = { initialize: initialized }
    if (initialized.capabilities.tools) snapshot.tools = await list(client, 'tools/list', 'tools')
    if (initialized.capabilities.resources) {
      snapshot.resources = await list(client, 'resources/list', 'resources')
      snapshot.resourceTemplates = await list(
        client,
        'resources/templates/list',
        'resourceTemplates'
      )
    }
    if (initialized.capabilities.prompts)
      snapshot.prompts = await list(client, 'prompts/list', 'prompts')
    await setTimeout(250)
    const [hubRssKiB, firstRssKiB] = await rss([hub, first])
    const attachedAt = performance.now()
    const second = launch(join(root, 'dist/cli.mjs'), env)
    processes.push(second)
    const secondClient = peer(second)
    await initialize(secondClient)
    const warmAttachMs = performance.now() - attachedAt
    await setTimeout(250)
    const twoClientsRssKiB = (await rss(processes)).reduce((sum, value) => sum + value, 0)
    return {
      snapshot,
      metrics: {
        hubReadyMs,
        firstInitializeMs,
        warmAttachMs,
        hubRssKiB,
        firstRssKiB,
        twoClientsRssKiB
      }
    }
  } finally {
    for (const child of processes.reverse()) await stop(child)
    await rm(temporary, { recursive: true, force: true })
  }
}

const results = []
for (const input of positionals) {
  const root = await realpath(resolve(input))
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== '@tempad-dev/mcp' || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error(`Not a stable TemPad MCP package: ${input}`)
  const files = await artifactFiles(root)
  const samples = []
  let contract
  let snapshot
  for (let run = 0; run < runs; run++) {
    const measured = await measure(root)
    const next = runtimeContract(measured.snapshot)
    if (contract && compareContracts(contract, next) !== 'identical')
      throw new Error(`Catalog changed between runs of ${manifest.version}.`)
    contract = next
    snapshot = measured.snapshot
    samples.push(measured.metrics)
  }
  results.push({
    version: manifest.version,
    root,
    artifactHash: digest({ manifest, files }),
    dependencies: manifest.dependencies,
    snapshot,
    wireHash: contract.wireHash,
    presentationHash: contract.presentationHash,
    metrics: Object.fromEntries(
      Object.keys(samples[0]).map((key) => [key, summarize(samples.map((sample) => sample[key]))])
    )
  })
  console.error(
    `Measured ${manifest.version}: ${snapshot.tools?.length ?? 0} tools, ${runs} fresh Hubs.`
  )
}
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  dependencyLock: values.lockfile
    ? { path: resolve(values.lockfile), sha256: sha256(await readFile(values.lockfile)) }
    : null,
  limits: [
    'Operator-supplied local packages only; no downloads or installed-host connections.',
    'TCP listeners are remapped to ephemeral loopback ports; Unix listeners must remain under a private root.',
    'Fresh processes with warm filesystem caches, not cold-machine startup; RSS is not exclusive physical memory.',
    'Warm attach initializes another CLI; it does not demonstrate uninterrupted MCP sessions or supervisor recovery.',
    'Hashes screen structural compatibility only; behavior, guidance, extension and storage compatibility require review.',
    'Installed dependencies may differ from those used at publication; preserve the installation lockfile.'
  ],
  results,
  comparisons: compareReleaseWindow(results)
}
await writeFile(resolve(values.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.error(`Saved ${results.length} artifact measurements to ${resolve(values.output)}.`)
