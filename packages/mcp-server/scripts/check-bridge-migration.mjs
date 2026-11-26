import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
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

// Use the exact packaging receipt and the reviewed public baseline without registry access.
const [candidatePath, priorPath] = process.argv.slice(2)
if (process.platform === 'win32')
  throw new Error('Run this two-archive check on Unix to isolate the published 1.x release socket.')
if (!candidatePath || !priorPath)
  throw new Error('Pass the candidate .tgz and published 1.0.5 .tgz.')
const receipt = JSON.parse(await readFile(candidatePath + '.json', 'utf8'))
const root = await fixtureRoot('tp-mig-')
const state = join(root, 'state')
const runtime = join(state, 'runtime')
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const env = {
  ...fixtureEnvironment(join(root, 'home'), root),
  ...RUNTIME_TEST_ENV,
  TEMPAD_MCP_RUNTIME_DIR: join(root, 'run'),
  TEMPAD_MCP_STATE_DIR: state,
  TEMPAD_MCP_ASSET_DIR: join(root, 'assets'),
  TEMPAD_MCP_LOG_DIR: join(root, 'logs'),
  TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin
}
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
const candidate = await unpack(candidatePath, '2.0.0', receipt.integrity)
const baseline = candidate.manifest.guidanceReview.baseline
assert.equal(baseline.version, '1.0.5')
const prior = await unpack(priorPath, baseline.version, baseline.integrity)
const journal = async () => JSON.parse(await readFile(join(runtime, 'switch.json'), 'utf8'))
const snapshot = join(state, 'design-tasks.json')
const fences = {
  revision: 1,
  records: [{ readRequired: true, task: { target: { fileKey: 'interrupted-write' } } }],
  current: {},
  fileFences: { 'stopped-file': true }
}
await mkdir(state, { recursive: true, mode: 0o700 })
await writeFile(snapshot, JSON.stringify(fences), { flag: 'wx', mode: 0o600 })

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
    } else if (message.type === 'state') active = !!extensionId && message.activeId === extensionId
    else if (message.type === 'designActionResult') stopResult = message.result
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
      const stored = JSON.parse(await readFile(snapshot, 'utf8'))
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

async function session(
  release,
  expected,
  run = async () => {},
  args = ['--runtime-updates=pinned']
) {
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
    const identity = JSON.parse(
      await readFile(join(env.TEMPAD_MCP_RUNTIME_DIR, 'hub-runtime.json'), 'utf8')
    )
    assert.equal(identity.packageVersion, expected)
    await assertStopFence(client, identity.wsPort)
    assert.notEqual(
      (await client.callTool({ name: 'list_design_sessions', arguments: {} })).isError,
      true
    )
    await run()
  } catch (error) {
    throw new Error(`${error}\n${errors}`, { cause: error })
  } finally {
    await client.close()
    await transport.close()
  }
}

async function stopped() {
  const deadline = Date.now() + 110_000
  while (
    existsSync(join(runtime, 'supervisor.json')) ||
    existsSync(join(env.TEMPAD_MCP_RUNTIME_DIR, 'hub-runtime.json'))
  ) {
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
  await session(prior, '1.0.5', async () => {
    await migrate('2.0.0', /Close all TemPad MCP connections/)
  })
  await stopped()
  // A normal new CLI can serve a session on the retained old Hub.
  await session(candidate, '1.0.5', undefined, [])
  await stopped()
  // The same request resumes an interrupted selection. The opposite request can
  // restore the original owner before a failed forward launch has committed.
  await migrate('2.0.0', /Fixture supervisor launch failure/, true)
  await migrate('1.0.5')
  await session(prior, '1.0.5')
  await stopped()
  await migrate('2.0.0', /Fixture supervisor launch failure/, true)
  await migrate('2.0.0')
  await session(candidate, '2.0.0')
  await stopped()
  await migrate('2.0.0')
  await session(candidate, '2.0.0')
  await stopped()
  await migrate('1.0.5', /Fixture supervisor launch failure/, true)
  assert.equal((await journal()).phase, 'old-stopped')
  const restored = (await journal()).candidate
  assert.equal(restored.version, '1.0.5')
  const endpoints = JSON.parse(await readFile(join(runtime, 'endpoints.json'), 'utf8'))
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
  await migrate('2.0.0')
  await session(candidate, '2.0.0')
  await stopped()
  await migrate('1.0.5')
  await session(prior, '1.0.5')
  await stopped()
  await migrate('1.0.5')
  await session(prior, '1.0.5')
  await stopped()
  assert.equal((await journal()).previous, undefined)
  const stored = JSON.parse(await readFile(snapshot, 'utf8'))
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
  console.log(
    'Published MCP 1.0.5 and candidate 2.0.0 passed live-owner refusal, normal attachment, cold migration, interrupted rollback recovery and 1.0.5 restoration.'
  )
} catch (error) {
  console.error(`Preserved migration evidence at ${root}`)
  throw error
} finally {
  endLogging()
}
await rm(root, { recursive: true, force: true })
