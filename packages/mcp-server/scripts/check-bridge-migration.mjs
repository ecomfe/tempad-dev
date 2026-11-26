import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import console from 'node:console'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import WebSocket from 'ws'

import { fixtureEnvironment, fixtureRoot, RUNTIME_TEST_ENV } from './runtime-test-platform.mjs'

// Use the exact packaging receipt and the published bridge baseline without registry access.
const [candidatePath, priorPath] = process.argv.slice(2)
if (process.platform === 'win32')
  throw new Error('Run this two-archive check on Unix to isolate the published 1.x release socket.')
if (!candidatePath || !priorPath)
  throw new Error('Pass the candidate .tgz and published 1.0.5 .tgz.')
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const receipt = await readJson(candidatePath + '.json')
const version = receipt.version
assert.match(version, /^2\./)
const priorVersion = '1.0.5'
const stableArgs = ['--runtime-updates=stable']
const priorIntegrity =
  'sha512-EM02vlXuNTsPg3d85BwLMVlOhw7Pu9KqleVNdbtW+b7050ugHPTVxKs/kHoRzusbyacasQXT4SleGQwGaG4zKg=='
const root = await fixtureRoot('tp-mig-')
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
function namespace(root) {
  const state = join(root, 'state')
  const runtime = join(state, 'runtime')
  const run = join(root, 'run')
  return {
    state,
    runtime,
    supervisorPath: join(runtime, 'supervisor.json'),
    identityPath: join(run, 'hub-runtime.json'),
    updatePath: join(runtime, 'updates.json'),
    env: {
      ...fixtureEnvironment(join(root, 'home'), root),
      ...RUNTIME_TEST_ENV,
      TEMPAD_MCP_RUNTIME_DIR: run,
      TEMPAD_MCP_STATE_DIR: state,
      TEMPAD_MCP_ASSET_DIR: join(root, 'assets'),
      TEMPAD_MCP_LOG_DIR: join(root, 'logs'),
      TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin
    }
  }
}
const fixture = namespace(root)
const { state, runtime, env } = fixture
Object.assign(process.env, env)
const { endLogging, verifyArchive } = await import('../dist/runtime-verification.mjs')
async function unpack(path, version, integrity) {
  const { files, manifest } = verifyArchive(await readFile(path), version, integrity)
  const directory = join(root, version)
  for (const [name, bytes] of files) {
    const destination = join(directory, name)
    await mkdir(dirname(destination), { mode: 0o700, recursive: true })
    await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' })
  }
  return { cli: join(directory, 'dist/cli.mjs'), manifest }
}
const candidate = await unpack(candidatePath, version, receipt.integrity)
const prior = await unpack(priorPath, priorVersion, priorIntegrity)
const journal = () => readJson(join(runtime, 'switch.json'))
const snapshot = join(state, 'design-tasks.json')
const fences = {
  revision: 1,
  records: [{ readRequired: true, task: { target: { fileKey: 'interrupted-write' } } }],
  current: {},
  fileFences: { 'stopped-file': true }
}
// Keep background registry discovery out of this test of locally installed packages.
const updates = { version: 2, nextCheck: Date.now() + 60 * 60 * 1000, failures: 0 }
async function deferRegistry({ runtime, updatePath }) {
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  await writeFile(updatePath, JSON.stringify(updates), { flag: 'wx', mode: 0o600 })
}
await deferRegistry(fixture)
await writeFile(snapshot, JSON.stringify(fences), { flag: 'wx', mode: 0o600 })

const asset = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9WQAAAAASUVORK5CYII=',
  'base64'
)
const assetHash = createHash('sha256').update(asset).digest('hex')
let storedAssetUrl
async function assertStoredAsset(assetServerUrl) {
  const url = `${assetServerUrl}/assets/${assetHash}`
  if (!storedAssetUrl) {
    const upload = await globalThis.fetch(url, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'image/png' },
      body: asset
    })
    assert.equal(upload.status, 201)
    storedAssetUrl = url
  }
  assert.equal(url, storedAssetUrl)
  const download = await globalThis.fetch(url)
  assert.equal(download.status, 200)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), asset)
}

let stoppedTask
async function assertStopFence(client, port) {
  const page = {
    sessionId: 'page',
    fileKey: 'reviewed-file',
    fileName: 'Fixture',
    pageId: '0:1',
    tabId: 1,
    documentId: 'document',
    busy: false
  }
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, ['tempad-mcp'], { origin })
  const send = (message) => socket.send(JSON.stringify(message))
  let extensionId,
    active,
    assetServerUrl,
    stopResult,
    dispatchedWrites = 0
  socket.on('message', (bytes) => {
    const message = JSON.parse(bytes)
    if (message.type === 'registered') {
      extensionId = message.id
      send({
        type: 'runtimeHello',
        protocolVersion: 15,
        extensionVersion: '1.1.1',
        extensionRuntimeFingerprint: 'b'.repeat(64),
        terminalReceipts: true,
        durableTerminalReceipts: true
      })
      send({
        type: 'sessions',
        browserId: 'browser',
        activeSessionId: page.sessionId,
        sessions: [page]
      })
      send({ type: 'activate' })
    } else if (message.type === 'state') {
      active = !!extensionId && message.activeId === extensionId
      assetServerUrl = message.assetServerUrl
    } else if (message.type === 'designActionResult') stopResult = message.result
    else if (message.type === 'toolCall') {
      if (message.payload.name === 'apply_canvas') dispatchedWrites++
      send({ type: 'toolResult', id: message.id, payload: message.payload.args })
    }
  })
  async function until(check) {
    while (!check()) await once(socket, 'message', { signal: globalThis.AbortSignal.timeout(5000) })
  }
  try {
    await once(socket, 'open')
    await until(() => active)
    await assertStoredAsset(assetServerUrl)
    if (!stoppedTask) {
      const begin = await client.callTool({
        name: 'manage_design_task',
        arguments: {
          action: 'begin',
          requestId: randomUUID(),
          title: 'Migration Stop fixture',
          sessionId: page.sessionId
        }
      })
      assert.notEqual(begin.isError, true, JSON.stringify(begin))
      const { taskId, epoch } = begin.structuredContent
      send({
        type: 'designAction',
        sessionId: page.sessionId,
        action: { requestId: randomUUID(), taskId, epoch, action: 'stop' }
      })
      await until(() => stopResult)
      const stored = await readJson(snapshot)
      assert.equal(
        stored.records.find((record) => record.task?.taskId === taskId)?.task.status,
        'cancelled'
      )
      stoppedTask = taskId
    }
    const write = await client.callTool({
      name: 'apply_canvas',
      arguments: { mode: 'update', targetNodeId: '1:2', markup: '<frame key="root" />' }
    })
    assert.equal(write.isError, true)
    assert.match(JSON.stringify(write), /stopped task/i)
    assert.equal(dispatchedWrites, 0)
  } finally {
    socket.terminate()
  }
}

async function assertSessionList(client) {
  const result = await client.callTool({ name: 'list_design_sessions', arguments: {} })
  assert.notEqual(result.isError, true, JSON.stringify(result))
}

async function runClient({ env, identityPath, supervisorPath }, release, args, run) {
  const client = new Client({ name: 'bridge-migration-test', version: '1' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [release.cli, ...args],
    env,
    stderr: 'pipe'
  })
  let errors = ''
  transport.stderr.on('data', (data) => {
    errors += data
  })
  try {
    await client.connect(transport, { timeout: 100_000 })
    assert.equal(client.getServerVersion().version, release.manifest.packageVersion)
    const identity = await readJson(identityPath)
    await run({ client, identity, supervisor: await readJson(supervisorPath) })
  } catch (error) {
    throw new Error(`${error}\n${errors}`, { cause: error })
  } finally {
    await client.close()
    await transport.close()
  }
}

async function session(release, expected, { args = ['--runtime-updates=pinned'], run } = {}) {
  await runClient(fixture, release, args, async (owner) => {
    assert.equal(owner.identity.packageVersion, expected)
    await assertStopFence(owner.client, owner.identity.wsPort)
    await assertSessionList(owner.client)
    await run?.(owner)
  })
}

async function stopped({ supervisorPath, identityPath } = fixture) {
  const deadline = Date.now() + 110_000
  while (existsSync(supervisorPath) || existsSync(identityPath)) {
    if (Date.now() > deadline) throw new Error('The fixture runtime still has an owner.')
    await delay(100)
  }
}

async function migrate(version, failure, failLaunch = false) {
  // The actual CLI still reads and validates its terminal prompt through the pipes.
  // A launch fault occurs after the verified journal and control have been saved.
  const code = `
    import cp from 'node:child_process'
    import { syncBuiltinESMExports } from 'node:module'
    if (${failLaunch}) {
      const spawn = cp.spawn
      cp.spawn = (...args) => {
        if (args[1].at(-1) === 'supervisor') throw new Error('Fixture supervisor launch failure')
        return spawn(...args)
      }
      syncBuiltinESMExports()
    }
    process.stdin.isTTY = process.stdout.isTTY = true
    process.argv = [process.execPath, ${JSON.stringify(candidate.cli)}, '--migrate-runtime', ${JSON.stringify(version)}]
    await import(${JSON.stringify(pathToFileURL(candidate.cli).href)})
  `
  const child = spawn(process.execPath, ['--input-type=module', '--eval', code], {
    env,
    stdio: 'pipe',
    windowsHide: true
  })
  let output = ''
  child.stdout.on('data', (data) => {
    output += data
    if (output.includes(`Type "update ${version}"`) && !child.stdin.writableEnded)
      child.stdin.end(`update ${version}\n`)
  })
  child.stderr.on('data', (data) => {
    output += data
  })
  try {
    const [exit] = await once(child, 'exit', { signal: globalThis.AbortSignal.timeout(120_000) })
    if (failure) {
      assert.notEqual(exit, 0)
      assert.match(output, failure)
    } else {
      assert.equal(exit, 0, output)
      assert.equal((await journal()).active.version, version)
      assert.equal((await journal()).phase, 'committed')
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
}

try {
  await session(prior, priorVersion, {
    args: [],
    async run(legacy) {
      await migrate(version, /Close all TemPad MCP connections/)
      await session(candidate, priorVersion, {
        args: [],
        async run(attached) {
          assert.equal(attached.identity.processId, legacy.identity.processId)
          assert.equal(attached.supervisor.pid, legacy.supervisor.pid)
          assert.equal((await journal()).active.version, priorVersion)
          await assertSessionList(legacy.client)
        }
      })
      await assertSessionList(legacy.client)
    }
  })
  await stopped()
  await session(candidate, priorVersion, { args: ['--runtime-updates=off'] })
  await stopped()
  // The same verified CLI now starts through its ordinary noninteractive stdio path.
  await session(candidate, version, {
    args: [],
    async run({ supervisor }) {
      const selection = await journal()
      assert.equal(selection.phase, 'committed')
      assert.equal(selection.active.version, version)
      assert.equal(selection.active.entry, supervisor.entry)
      assert.equal(selection.previous.version, priorVersion)
      assert.equal(selection.coldStart, undefined)
    }
  })
  await stopped()
  await migrate(priorVersion)
  await session(candidate, priorVersion, { args: stableArgs })
  await stopped()
  // The same request resumes an interrupted selection. The opposite request can
  // restore the original owner before a failed forward launch has committed.
  await migrate(version, /Fixture supervisor launch failure/, true)
  await migrate(priorVersion)
  await session(prior, priorVersion)
  await stopped()
  await migrate(version, /Fixture supervisor launch failure/, true)
  await migrate(version)
  await session(candidate, version)
  await stopped()
  await migrate(version)
  await session(candidate, version)
  await stopped()
  await migrate(priorVersion, /Fixture supervisor launch failure/, true)
  assert.equal((await journal()).phase, 'old-stopped')
  const restored = (await journal()).candidate
  assert.equal(restored.version, priorVersion)
  const endpoints = await readJson(join(runtime, 'endpoints.json'))
  const occupied = createServer()
  await once(occupied.listen(endpoints.httpPort, '127.0.0.1'), 'listening')
  try {
    await assert.rejects(
      promisify(execFile)(process.execPath, [restored.entry, '--root', runtime, '--role', 'hub'], {
        env,
        timeout: 30_000
      }),
      /EADDRINUSE/
    )
  } finally {
    await new Promise((resolve) => occupied.close(resolve))
  }
  await migrate(version)
  await session(candidate, version)
  await stopped()
  await migrate(priorVersion)
  await session(prior, priorVersion)
  await stopped()
  await migrate(priorVersion)
  await session(prior, priorVersion)
  await stopped()
  assert.equal((await journal()).previous, undefined)
  assert.deepEqual(await readJson(fixture.updatePath), updates)
  const stored = await readJson(snapshot)
  assert.deepEqual(stored.fileFences, fences.fileFences)
  assert.ok(
    stored.records.some(
      (record) => record.readRequired && record.task.target.fileKey === 'interrupted-write'
    )
  )
  assert.equal(
    stored.records.find((record) => record.task?.taskId === stoppedTask)?.task.status,
    'cancelled'
  )

  const restartRoot = await fixtureRoot('tp-restart-')
  const restart = namespace(restartRoot)
  try {
    await deferRegistry(restart)
    await runClient(restart, prior, [], async ({ client, identity }) => {
      assert.equal(identity.packageVersion, priorVersion)
      await assertSessionList(client)
    })
    // A host can relaunch the CLI before the old Hub's last-client shutdown finishes.
    const priorOwnerDraining = existsSync(restart.identityPath)
    await runClient(restart, candidate, stableArgs, async ({ client, identity }) => {
      assert.equal(identity.packageVersion, version)
      await assertSessionList(client)
    })
    await stopped(restart)
    assert.deepEqual(await readJson(restart.updatePath), updates)
    console.log(`Immediate host restart passed (prior Hub still recorded: ${priorOwnerDraining}).`)
  } catch (error) {
    console.error(`Preserved restart evidence at ${restartRoot}`)
    throw error
  }
  await rm(restartRoot, { recursive: true, force: true })
  console.log(
    `Published MCP ${priorVersion} and candidate ${version} passed live-owner reuse, automatic cold migration, explicit migration and rollback with interrupted launches, and preservation of Stop, task fences and uploaded assets.`
  )
} catch (error) {
  console.error(`Preserved migration evidence at ${root}`)
  throw error
} finally {
  endLogging()
}
await rm(root, { recursive: true, force: true })
