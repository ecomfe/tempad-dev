import { MCP_CHECKOUT_PORT_CANDIDATES, MCP_PORT_CANDIDATES } from '@tempad-dev/shared'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'

import { runtimeDirectories } from '../../../agent-plugin/src/clients/shared/runtime-profile.mjs'

if (process.platform === 'win32')
  throw new Error('The release pipe is not isolatable on Windows; do not probe an installed Hub.')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

async function identity(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function waitFor(check, message) {
  const deadline = Date.now() + 15000
  do {
    const result = await check()
    if (result) return result
    await setTimeout(25)
  } while (Date.now() < deadline)
  throw new Error(message)
}

async function readLogs(directory) {
  const files = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  return (
    await Promise.all(
      files
        .filter((name) => name.endsWith('.log'))
        .map((name) => readFile(join(directory, name), 'utf8'))
    )
  ).join('\n')
}

async function checkProfiles(overrides) {
  // macOS's per-user temporary root plus a checkout suffix can exceed sun_path.
  const root = await realpath(await mkdtemp('/tmp/tp-p-'))
  const checkout = join(root, 'c')
  const targetPackage = join(checkout, 'packages/mcp-server')
  const children = []
  const identities = new Set()
  const logDirectories = new Set()
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    TMPDIR: root,
    TEMP: root,
    TMP: root,
    ...(overrides
      ? {
          TEMPAD_MCP_RUNTIME_DIR: join(root, 'r'),
          TEMPAD_MCP_LOG_DIR: join(root, 'l'),
          TEMPAD_MCP_ASSET_DIR: join(root, 'a'),
          TEMPAD_MCP_STATE_DIR: join(root, 's')
        }
      : {}),
    TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  }

  async function startClient(local) {
    const childEnv = { ...env, ...(local ? { TEMPAD_MCP_DEV_CHECKOUT: checkout } : {}) }
    const cli = join(local ? targetPackage : packageRoot, 'dist/cli.mjs')
    const paths = runtimeDirectories(childEnv, undefined, { tmpdir: root, homedir: root })
    const record = join(paths.runtime, 'hub-runtime.json')
    identities.add(record)
    logDirectories.add(paths.log)
    const child = spawn(process.execPath, [cli], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (data) => {
      stderr += data
    })
    const replies = new Map()
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      const reply = JSON.parse(line)
      if (reply.id !== undefined) replies.set(reply.id, reply)
    })
    const request = async (id, method, params) => {
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n'
      )
      await waitFor(() => {
        if (child.exitCode !== null) throw new Error(`CLI exited: ${stderr}`)
        return replies.has(id)
      }, `No ${method} response: ${stderr}`)
      const reply = replies.get(id)
      assert.equal(reply.error, undefined)
      return reply.result
    }
    await request(1, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'isolated-profile-check', version: '1' }
    })
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    )
    const hub = await waitFor(async () => {
      const value = await identity(record)
      return value?.wsPort && value
    }, 'Hub identity and WebSocket port were not published')
    assert.equal(hub.entryPath, join(local ? targetPackage : packageRoot, 'dist/hub.mjs'))
    assert.equal(
      hub.runtimeFingerprint,
      createHash('sha256')
        .update(await readFile(hub.entryPath))
        .digest('hex')
    )
    const port = hub.wsPort
    assert.ok(
      (local ? MCP_CHECKOUT_PORT_CANDIDATES : MCP_PORT_CANDIDATES).includes(port),
      `${local ? 'Checkout' : 'Release'} Hub bound the wrong port: ${port}`
    )
    return { child, paths, record, hub, request, port }
  }

  try {
    await mkdir(targetPackage, { recursive: true })
    await cp(join(packageRoot, 'dist'), join(targetPackage, 'dist'), { recursive: true })
    await symlink(
      join(packageRoot, 'node_modules'),
      join(targetPackage, 'node_modules'),
      'junction'
    )
    const release = await startClient(false)
    const dev = await startClient(true)
    const secondRelease = await startClient(false)
    assert.equal(
      secondRelease.hub.processId,
      release.hub.processId,
      'Release clients must share one Hub'
    )
    assert.notEqual(dev.hub.processId, release.hub.processId)
    assert.notEqual(dev.port, release.port)
    for (const key of ['runtime', 'log', 'assets', 'state'])
      assert.notEqual(dev.paths[key], release.paths[key])
    const devExit = once(dev.child, 'close')
    dev.child.stdin.end()
    await devExit
    await waitFor(
      async () => !(await identity(dev.record)),
      'Checkout Hub did not stop with its last client'
    )
    assert.equal((await identity(release.record)).processId, release.hub.processId)
    await release.request(2, 'ping')
    await secondRelease.request(2, 'ping')
    console.log(
      `Runtime profiles (${overrides ? 'overrides' : 'defaults'}): shared release Hub on ${release.port}; isolated checkout Hub on ${dev.port}; independent directories and shutdown.`
    )
  } catch (error) {
    for (const directory of logDirectories) console.error((await readLogs(directory)).slice(-8000))
    throw error
  } finally {
    for (const child of children) child.stdin.end()
    try {
      await waitFor(
        async () => (await Promise.all([...identities].map(identity))).every((value) => !value),
        'Profile test Hubs did not stop'
      )
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    }
    for (const path of identities) {
      const hub = await identity(path)
      if (hub) {
        try {
          process.kill(hub.processId, 'SIGTERM')
        } catch (error) {
          if (error.code !== 'ESRCH') {
            console.error(error)
            process.exitCode = 1
          }
        }
      }
    }
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
    await rm(root, { recursive: true, force: true })
  }
}

for (const overrides of [false, true]) await checkProfiles(overrides)
