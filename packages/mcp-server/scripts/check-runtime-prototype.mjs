import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { TEMPAD_MCP_BRIDGE_SUBPROTOCOL } from '@tempad-dev/shared'
import assert from 'node:assert/strict'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import { WebSocket } from 'ws'

import { runtimeEndpoint } from '../src/runtime-platform.ts'
import {
  fixtureEnvironment,
  fixtureProcesses as processes,
  fixtureRoot,
  preserveFixtureEvidence,
  processMemory
} from './runtime-test-platform.mjs'

const root = await fixtureRoot('tp-p-')
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const clients = []
const entry = fileURLToPath(new URL('../dist/prototype/runtime-prototype.mjs', import.meta.url))
const failures = []
let extension
let stderr = ''
let passed = false
const started = performance.now()
async function until(check, description, timeout = 15000) {
  const deadline = performance.now() + timeout
  do {
    if (failures.length) throw failures[0]
    const value = await check()
    if (value) return value
    await delay(25)
  } while (performance.now() < deadline)
  throw new Error(`Timed out: ${description}\n${stderr}\nRoot: ${root}`)
}
async function record(name) {
  try {
    return JSON.parse(await readFile(join(root, name), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
function live(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
function owned(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !live(pid)) return false
  return fixtureProcesses().some((value) => value.pid === pid)
}
function fixtureProcesses() {
  return processes(root, entry)
}
function call(client, name, args = {}, options = {}) {
  return client.callTool({ name, arguments: args }, undefined, { timeout: 20000, ...options })
}
async function launch(label) {
  const home = join(root, label)
  await mkdir(home, { mode: 0o700 })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, '--root', root],
    stderr: 'pipe',
    env: {
      ...fixtureEnvironment(home, root),
      CODEX_HOME: join(home, 'codex'),
      CODEX_SQLITE_HOME: join(home, 'sqlite'),
      TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin,
      TEMPAD_MCP_AUTO_ACTIVATE_GRACE: '10'
    }
  })
  transport.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const client = new Client({ name: `prototype-${label}`, version: '1' })
  clients.push(client)
  await client.connect(transport, { timeout: 15000 })
  return { client, transport, home }
}
function send(message) {
  extension.send(JSON.stringify(message))
}
async function probe(path, message) {
  const socket = connect(path)
  socket.setTimeout(5000, () => socket.destroy(new Error('Probe timed out.')))
  await once(socket, 'connect')
  const reply = once(socket, 'data')
  socket.write(JSON.stringify(message) + '\n')
  const [data] = await reply
  socket.destroy()
  return JSON.parse(data)
}

try {
  const first = await launch('first')
  const coldMs = performance.now() - started
  const attached = performance.now()
  const second = await launch('second')
  const attachMs = performance.now() - attached
  const initial = await until(() => record('supervisor.json'), 'supervisor identity')
  const hub = await until(async () => {
    const value = await record('run/hub-runtime.json')
    return value?.wsPort && value
  }, 'Hub identity and private WebSocket port')
  assert.equal(initial.hubPid, hub.processId)
  await delay(250)
  const twoClientsMemory = processMemory([
    first.transport.pid,
    second.transport.pid,
    initial.pid,
    hub.processId
  ])
  const catalog = await first.client.listTools()
  assert.deepEqual(await second.client.listTools(), catalog)
  assert.ok(catalog.tools.some((tool) => tool.name === 'apply_canvas'))

  extension = new WebSocket(`ws://127.0.0.1:${hub.wsPort}`, [TEMPAD_MCP_BRIDGE_SUBPROTOCOL], {
    origin
  })
  const frames = []
  const calls = []
  let held
  let assetUrl
  let registered
  const session = {
    sessionId: 'prototype-session',
    fileKey: 'prototype-file',
    fileName: 'Isolated runtime fixture',
    pageId: '0:1',
    tabId: 1,
    documentId: 'prototype-document',
    busy: false
  }
  const structure = {
    roots: [{ id: '1:2', name: 'Fixture', type: 'FRAME', x: 0, y: 0, width: 100, height: 100 }]
  }
  const written = {
    rootNodeId: '1:2',
    nodeIdsByKey: { root: '1:2' },
    createdNodeIds: [],
    updatedNodeIds: ['1:2'],
    removedNodeIds: [],
    mutationCount: 1,
    verification: { status: 'passed', nodesChecked: 1, referencesChecked: 0, warnings: [] }
  }
  extension.on('error', (error) => failures.push(error))
  extension.on('message', (bytes) => {
    try {
      const message = JSON.parse(bytes)
      frames.push(message)
      if (message.type === 'registered') registered = message.id
      if (message.type === 'state') assetUrl = message.assetServerUrl
      if (message.type !== 'toolCall') return
      calls.push(message)
      if (message.payload.name === 'apply_canvas') {
        held = message
        return
      }
      const payload = message.payload.name === '__begin_design' ? message.payload.args : structure
      send({ type: 'toolResult', id: message.id, payload })
    } catch (error) {
      failures.push(error)
    }
  })
  await once(extension, 'open')
  await until(() => registered && assetUrl, 'extension registration')
  send({
    type: 'runtimeHello',
    extensionVersion: '0.22.0',
    extensionRuntimeFingerprint: 'b'.repeat(64)
  })
  send({
    type: 'sessions',
    browserId: 'prototype-browser',
    activeSessionId: session.sessionId,
    sessions: [session]
  })
  send({ type: 'activate' })
  await until(
    () => frames.some((frame) => frame.type === 'state' && frame.activeId === registered),
    'extension activation'
  )
  const task = await call(first.client, 'manage_design_task', {
    action: 'begin',
    title: 'Isolated prototype',
    requestId: randomUUID(),
    sessionId: session.sessionId
  })
  assert.equal(task.isError, undefined, JSON.stringify(task))
  const { taskId, epoch } = task.structuredContent
  await call(first.client, 'get_structure', { nodeId: '1:2', taskId, taskEpoch: epoch })
  const write = call(first.client, 'apply_canvas', {
    mode: 'update',
    targetNodeId: '1:2',
    markup: '<frame key="root" />',
    taskId,
    taskEpoch: epoch
  })
  // Observe an early disconnect immediately; the assertion below still awaits the result.
  void write.catch(() => {})
  await until(() => held, 'write admitted once')
  const recovering = performance.now()
  assert.ok(owned(initial.pid), 'only terminate this fixture supervisor')
  process.kill(initial.pid, 'SIGKILL')
  await until(
    async () => (await globalThis.fetch(`${assetUrl}/assets/${'a'.repeat(64)}`)).status === 503,
    'asset admission closes after control loss'
  )
  const before = calls.length
  const queuedRead = call(second.client, 'get_structure', { nodeId: '1:2' })
  void queuedRead.catch(() => {})
  await delay(100)
  assert.equal(
    (await globalThis.fetch(`${assetUrl}/assets/${'a'.repeat(64)}`)).status,
    503,
    'control admission remains closed during the queued read'
  )
  assert.equal(calls.length, before, 'the queued read is not dispatched during control loss')
  // The data connection remains valid while its independent control owner recovers.
  send({ type: 'toolResult', id: held.id, payload: written })
  assert.equal((await write).isError, undefined)
  assert.equal(calls.filter((message) => message.payload.name === 'apply_canvas').length, 1)
  await first.client.ping()
  assert.deepEqual(await first.client.listTools(), catalog)
  const stopId = randomUUID()
  send({
    type: 'designAction',
    sessionId: session.sessionId,
    action: { requestId: stopId, taskId, epoch, action: 'stop' }
  })
  await until(
    () =>
      frames.some(
        (frame) =>
          frame.type === 'designActionResult' &&
          frame.result.requestId === stopId &&
          frame.result.status === 'delivered'
      ),
    'Stop remains available during supervisor recovery'
  )
  const recovered = await until(
    async () => {
      const value = await record('supervisor.json')
      return value && value.pid !== initial.pid && value.generation > initial.generation && value
    },
    'one successor supervisor',
    20000
  )
  const recoverMs = performance.now() - recovering
  assert.equal((await queuedRead).isError, undefined)
  assert.equal(calls.length, before + 1, 'the waiting read is dispatched exactly once')
  assert.equal(recovered.hubPid, hub.processId)
  assert.equal(recovered.hubId, initial.hubId)
  await until(async () => {
    try {
      return !(await call(second.client, 'list_design_sessions')).isError
    } catch {
      return false
    }
  }, 'second initialized edge reattachment')
  const snapshot = await record('state/design-tasks.json')
  const saved = snapshot.records.find((value) => value.task.taskId === taskId)
  assert.equal(saved.hostContext.codexHome, join(first.home, 'codex'))
  assert.equal(saved.task.status, 'cancelled')
  await first.client.close()
  const secondTask = await call(second.client, 'manage_design_task', {
    action: 'begin',
    title: 'Second isolated owner',
    requestId: randomUUID(),
    sessionId: session.sessionId
  })
  assert.equal(secondTask.isError, undefined, JSON.stringify(secondTask))
  assert.equal(
    (
      await call(second.client, 'get_structure', {
        nodeId: '1:2',
        taskId: secondTask.structuredContent.taskId,
        taskEpoch: secondTask.structuredContent.epoch
      })
    ).isError,
    undefined
  )
  const state = await record('state/design-tasks.json')
  assert.equal(
    state.records.find((value) => value.task.taskId === secondTask.structuredContent.taskId)
      .hostContext.codexHome,
    join(second.home, 'codex')
  )

  // Hooks retain the public endpoint; a legacy byte bridge gets restart guidance.
  const path = runtimeEndpoint(join(root, 'run'), 'mcp.sock')
  assert.match(
    (await probe(path, { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} })).error.message,
    /MCP_RUNTIME_RESTART_REQUIRED/
  )
  const hook = await probe(path, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tempad/client-hook',
    params: {
      version: 1,
      kind: 'claude',
      sessionId: 'isolated-hook',
      event: 'UserPromptSubmit',
      invocationId: randomUUID()
    }
  })
  assert.deepEqual(hook.result, {})
  const incompatible = await probe(runtimeEndpoint(root, 'supervisor.sock'), {
    jsonrpc: '2.0',
    id: 2,
    method: 'tempad/runtime-hello',
    params: {
      sessionId: randomUUID(),
      token: randomUUID(),
      context: saved.hostContext,
      versions: [1]
    }
  })
  assert.match(incompatible.error.message, /MCP_RUNTIME_RESTART_REQUIRED/)
  const processes = fixtureProcesses().filter(({ command }) =>
    command.includes('--role supervisor')
  )
  assert.equal(processes.length, 1, 'only one successor owns supervisor control')
  await second.client.close()
  await until(() => !live(recovered.pid) && !live(hub.processId), 'last-client shutdown')
  console.log(
    JSON.stringify(
      {
        valid: true,
        coldMs,
        attachMs,
        recoverMs,
        twoClientsMemory,
        writes: 1,
        preservedHub: true,
        initializedEdges: 2,
        controlProtocol: recovered.version
      },
      null,
      2
    )
  )
  passed = true
} catch (error) {
  await preserveFixtureEvidence(root, `${error.stack}\n${stderr}`)
  throw new Error(`${error.message}\n${stderr}\nRoot: ${root}`, { cause: error })
} finally {
  await Promise.allSettled(clients.map((client) => client.close()))
  extension?.terminate()
  let cleanupReliable = true
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      // Include children that failed before publishing their runtime record.
      for (const { pid } of fixtureProcesses()) {
        try {
          process.kill(pid, signal)
        } catch (error) {
          if (error.code !== 'ESRCH')
            console.error(`Could not stop fixture ${pid}: ${error.message}`)
        }
      }
      const deadline = performance.now() + 5000
      while (fixtureProcesses().length && performance.now() < deadline) await delay(50)
    } catch {
      cleanupReliable = false
    }
  }
  if (!cleanupReliable || fixtureProcesses().length) {
    console.error(`Fixture processes did not exit; preserved isolated root: ${root}`)
    process.exitCode = 1
  } else if (passed && !process.env.TEMPAD_KEEP_PROTOTYPE)
    await rm(root, { recursive: true, force: true })
  else console.log(`Preserved isolated root: ${root}`)
}
