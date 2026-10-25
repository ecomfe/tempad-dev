import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION
} from '@tempad-dev/shared'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile, execFileSync } from 'node:child_process'
import console from 'node:console'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'tsdown'
import { WebSocket } from 'ws'

import config from '../tsdown.prototype.config.ts'

// Build fixtures from authored source and test-only manifest inputs. Never patch
// a generated runtime or use the user's release/checkout stores and services.
if (process.platform === 'win32') throw new Error('Runtime switch acceptance requires Unix.')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const repo = join(packageRoot, '../..')
await mkdir(join(repo, '.dev'), { recursive: true })
const artifacts = await mkdtemp(join(repo, '.dev/runtime-switch-'))
await symlink(join(packageRoot, 'node_modules'), join(artifacts, 'node_modules'), 'dir')
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const exec = promisify(execFile)
const results = []
const fetch = globalThis.fetch
let completed = false
async function artifact(version, incompatible = false) {
  const output = join(artifacts, version)
  await build({
    ...config,
    config: false,
    cwd: packageRoot,
    entry: ['src/runtime-prototype.ts', 'src/log-transport.ts'],
    outDir: output,
    sourcemap: false,
    plugins: [
      ...config.plugins,
      {
        name: 'local-runtime-test-input',
        load(id) {
          if (id === join(packageRoot, 'package.json'))
            return JSON.stringify({ ...manifest, version })
        },
        transform(code, id) {
          if (version === '0.11.1' && id === join(packageRoot, 'src/runtime-prototype/run.ts')) {
            const boundary = "const { startHub } = await import('../hub-runtime')"
            assert.ok(code.includes(boundary), 'fixture Hub startup boundary changed')
            return code.replace(
              boundary,
              `
              if ((await import('node:fs')).existsSync(join(root, 'test-delay-hub')))
                await new Promise(resolve => setTimeout(resolve, 2000))
              ${boundary}`
            )
          }
          if (id === join(packageRoot, 'src/runtime-prototype/supervisor.ts')) {
            const boundary = 'writeJournal(config.root, value)'
            assert.ok(code.includes(boundary), 'fixture handoff boundary changed')
            // Instrument the fixture source at the durable boundary. fs.watch
            // can coalesce phases or run after the next assertion; it cannot
            // establish where a crash actually occurred.
            return code.replace(
              boundary,
              `${boundary}
    const faultPath = join(config.root, 'test-fault.json')
    if (existsSync(faultPath)) {
      const fault = JSON.parse(readFileSync(faultPath, 'utf8'))
      if (value.phase === fault.phase &&
          (value.phase !== 'committed' || value.active.version === fault.version)) {
        rmSync(faultPath)
        writeFileSync(join(config.root, 'test-fault-observed.json'),
          JSON.stringify({ phase: value.phase, pid: process.pid }))
        if (fault.action === 'crash') process.kill(process.pid, 'SIGKILL')
        else {
          const deadline = Date.now() + 5000
          while (!existsSync(join(config.root, 'test-fault-release'))) {
            if (Date.now() >= deadline) throw new Error('Fixture port barrier timed out')
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
          }
        }
      }
    }`
            )
          }
          if (incompatible && id === join(packageRoot, 'src/hub-runtime.ts'))
            return code.replace("title: 'TemPad Dev'", "title: 'Incompatible fixture'")
        }
      }
    ]
  })
  return join(output, 'runtime-prototype.mjs')
}
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
async function until(check, label, timeout = 20000) {
  const deadline = performance.now() + timeout
  do {
    const value = await check()
    if (value) return value
    await delay(25)
  } while (performance.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
async function record(root, path) {
  try {
    return JSON.parse(await readFile(join(root, path), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
}
async function rpc(root, method, params, path = 'supervisor.sock') {
  const socket = connect(join(root, path))
  socket.setTimeout(5000, () => socket.destroy(new Error('Runtime test RPC timed out')))
  await once(socket, 'connect')
  const reply = new Promise((resolve, reject) => {
    let data = ''
    socket.once('error', reject)
    socket.once('close', () => reject(new Error('Runtime test RPC connection closed')))
    socket.on('data', (chunk) => {
      data += chunk
      if (data.includes('\n')) resolve(data.slice(0, data.indexOf('\n')))
    })
  })
  socket.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }) + '\n'
  )
  try {
    const value = JSON.parse(await reply)
    if (value.error) throw new Error(value.error.message)
    return value.result
  } finally {
    socket.destroy()
  }
}
async function applyHook(root, input) {
  return until(async () => {
    const result = await rpc(root, 'tempad/client-hook', input, 'run/mcp.sock')
    assert.equal(result.receipt?.invocationId, input.invocationId)
    return result.receipt.state === 'applied' && result
  }, 'durable hook application')
}
function ownedProcesses(root) {
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(artifacts) && line.includes(`--root ${root}`))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
}
const session = {
  sessionId: 'session',
  fileKey: 'file',
  fileName: 'Switch fixture',
  pageId: '0:1',
  tabId: 1,
  documentId: 'document',
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
const call = (client, name, args = {}) =>
  client.callTool({ name, arguments: args }, undefined, { timeout: 30000 })

async function scenario(a, b, mode, incompatible) {
  const root = await realpath(await mkdtemp('/tmp/tp-sw-'))
  const clients = []
  const edgePids = []
  const claudeStop = mode === 'claude-stop' || mode === 'claude-stop-rollback'
  const claudeSession = randomUUID()
  const claudeTurn = randomUUID()
  const claudeHook = (event, extra = {}) => ({
    version: 2,
    kind: 'claude',
    sessionId: claudeSession,
    turnId: claudeTurn,
    event,
    invocationId: randomUUID(),
    profile: { kind: 'release' },
    issuedAt: Date.now(),
    ...extra
  })
  let passed = false
  let extension, conflict
  let stderr = ''
  const command = (...args) =>
    exec(process.execPath, [a, '--root', root, ...args], {
      timeout: 390000,
      maxBuffer: 4 * 1024 * 1024
    })
  async function openClient(name, timeout = 15000) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [a, '--root', root],
      stderr: 'pipe',
      env: {
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: root,
        TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin,
        TEMPAD_MCP_AUTO_ACTIVATE_GRACE: '10'
      }
    })
    transport.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-20000)
    })
    const client = new Client({ name, version: '1' })
    clients.push(client)
    await client.connect(transport, { timeout })
    assert.ok(transport.pid)
    edgePids.push(transport.pid)
    return client
  }
  try {
    for (let index = 0; index < 2; index++)
      await openClient(claudeStop && index === 0 ? 'claude-code' : `switch-${index}`)
    const initial = await record(root, 'supervisor.json')
    const endpoints = await record(root, 'endpoints.json')
    const catalog = await clients[0].listTools()
    let frames = [],
      calls = [],
      held,
      assetUrl,
      review
    async function attach() {
      frames = []
      let registered
      extension = new WebSocket(
        `ws://127.0.0.1:${endpoints.wsPort}`,
        [TEMPAD_MCP_BRIDGE_SUBPROTOCOL],
        { origin }
      )
      extension.on('message', (bytes) => {
        const message = JSON.parse(bytes)
        frames.push(message)
        if (message.type === 'designTaskState') review = message.task
        if (message.type === 'registered') {
          registered = message.id
          extension.send(
            JSON.stringify({
              type: 'runtimeHello',
              extensionVersion: '0.22.0',
              extensionRuntimeFingerprint: 'b'.repeat(64),
              protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
              terminalReceipts: true,
              durableTerminalReceipts: true
            })
          )
          extension.send(
            JSON.stringify({
              type: 'sessions',
              browserId: 'browser',
              activeSessionId: session.sessionId,
              sessions: [session],
              ...(review ? { reviews: [{ sessionId: session.sessionId, task: review }] } : {})
            })
          )
          extension.send(JSON.stringify({ type: 'activate' }))
        }
        if (message.type === 'state') assetUrl = message.assetServerUrl
        if (message.type !== 'toolCall') return
        calls.push(message)
        if (message.payload.name === 'apply_canvas') {
          held = message
          return
        }
        extension.send(
          JSON.stringify({
            type: 'toolResult',
            id: message.id,
            payload: message.payload.name === '__begin_design' ? message.payload.args : structure
          })
        )
      })
      await once(extension, 'open')
      await until(
        () =>
          assetUrl &&
          frames.some((frame) => frame.type === 'state' && frame.activeId === registered),
        'extension activation'
      )
    }
    await attach()
    if (claudeStop) {
      await assert.rejects(
        clients[0].request(
          { method: 'tempad/client-hook', params: claudeHook('UserPromptSubmit') },
          ResultSchema
        ),
        /runtime gateway/
      )
      await applyHook(root, claudeHook('UserPromptSubmit'))
    }
    const task = await call(clients[0], 'manage_design_task', {
      action: 'begin',
      title: mode,
      requestId: randomUUID(),
      sessionId: session.sessionId
    })
    assert.ok(!task.isError, JSON.stringify(task))
    const { taskId, epoch } = task.structuredContent
    if (claudeStop) {
      await applyHook(root, claudeHook('PostToolUse', { taskId }))
      const bound = (await record(root, 'state/design-tasks.json')).records.find(
        (value) => value.task.taskId === taskId
      )
      assert.equal(bound.task.client.kind, 'claude')
      assert.equal(bound.task.client.sessionId, claudeSession)
    }
    await call(clients[0], 'get_structure', { nodeId: '1:2', taskId, taskEpoch: epoch })
    const body = Buffer.from('persistent fixture asset')
    const hash = createHash('sha256').update(body).digest('hex')
    const url = `${assetUrl}/assets/${hash}.png`
    assert.equal(
      (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body })).status,
      201
    )
    const beforeFile = await readFile(join(root, 'assets', `${hash}.png`))
    if (mode === 'normal') {
      await assert.rejects(command('--switch', a), /newer stable/)
      await assert.rejects(command('--switch', incompatible), /frozen MCP contract/)
    }
    const write = call(clients[0], 'apply_canvas', {
      mode: 'update',
      targetNodeId: '1:2',
      markup: '<frame key="root" />',
      taskId,
      taskEpoch: epoch
    })
    const lost = write.catch((error) => ({ transportError: error.message }))
    await until(() => held, 'one admitted write')
    assert.ok(held.terminalReceipt)
    let upload, uploaded
    if (mode === 'normal') {
      const content = Buffer.from('upload spanning drain')
      const digest = createHash('sha256').update(content).digest('hex')
      upload = request(`${assetUrl}/assets/${digest}.png`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Content-Length': content.length }
      })
      uploaded = new Promise((resolve, reject) => {
        upload.once('error', reject)
        upload.once('response', (response) => {
          response.resume()
          resolve(response.statusCode)
        })
      })
      void uploaded.catch(() => {})
      upload.write(content.subarray(0, 1))
      await until(
        async () => (await rpc(root, 'tempad/runtime-status')).blockers.includes('asset transfers'),
        'upload admitted'
      )
    }
    if (mode === 'orphan') {
      extension.terminate()
      await lost
    }
    const hooks = []
    const stopAtGate = mode !== 'normal' && mode !== 'orphan'
    let portBarrier
    let newEdge
    if (mode === 'initial-attach') {
      await writeFile(join(root, 'test-delay-hub'), '')
      newEdge = (async () => {
        await until(
          async () => (await record(root, 'switch.json'))?.phase === 'old-stopped',
          'delayed replacement startup'
        )
        const client = await openClient('during-handoff')
        assert.deepEqual(await client.listTools(), catalog)
      })()
      void newEdge.catch(() => {})
    }
    if (
      ['preparing', 'old-stopped', 'candidate-ready', 'committed', 'port-conflict'].includes(mode)
    ) {
      await writeFile(
        join(root, 'test-fault.json'),
        JSON.stringify({
          phase: mode === 'port-conflict' ? 'old-stopped' : mode,
          action: mode === 'port-conflict' ? 'hold' : 'crash',
          version: '0.11.1'
        })
      )
      if (mode === 'port-conflict') {
        portBarrier = (async () => {
          await until(
            () => record(root, 'test-fault-observed.json'),
            'port conflict boundary',
            90_000
          )
          conflict = createServer()
          conflict.listen(endpoints.wsPort, '127.0.0.1')
          await once(conflict, 'listening')
          await writeFile(join(root, 'test-fault-release'), '')
          // Candidate startup must fail first; leave fallback a free port.
          setTimeout(() => conflict.close(), 5800)
        })()
        void portBarrier.catch(() => {})
      }
    }
    const update = command('--switch', b).then(
      (value) => JSON.parse(value.stdout),
      (error) => ({ interrupted: error.message })
    )
    if (mode !== 'orphan') {
      await until(async () => (await rpc(root, 'tempad/runtime-status')).gated, 'drain gate')
      const count = calls.length
      await assert.rejects(
        call(clients[1], 'get_structure', { nodeId: '1:2' }),
        (error) => error.data?.dispatched === false
      )
      assert.equal(calls.length, count)
      const hook = {
        version: 1,
        kind: 'claude',
        sessionId: 'no-bound-task',
        event: 'Interrupt',
        invocationId: randomUUID()
      }
      hooks.push(hook)
      await rpc(root, 'tempad/client-hook', hook, 'run/mcp.sock')
      if (stopAtGate) {
        const requestId = randomUUID()
        extension.send(
          JSON.stringify({
            type: 'designAction',
            sessionId: session.sessionId,
            action: { requestId, taskId, epoch, action: 'stop' }
          })
        )
        await until(
          () =>
            frames.some(
              (frame) =>
                frame.type === 'designActionResult' &&
                frame.result.requestId === requestId &&
                frame.result.status === 'delivered'
            ),
          'Stop during drain'
        )
      }
      extension.send(JSON.stringify({ type: 'toolResult', id: held.id, payload: written }))
      assert.ok(!(await lost).isError)
      if (upload) {
        const pending = await rpc(root, 'tempad/runtime-status')
        assert.ok(pending.gated && pending.blockers.includes('asset transfers'))
        assert.equal(pending.hubPid, initial.hubPid)
        upload.end(Buffer.from('upload spanning drain').subarray(1))
        assert.equal(await uploaded, 201)
      }
    }
    const outcome = await update
    await portBarrier
    await newEdge
    const settled = await until(
      async () => {
        try {
          const status = await rpc(root, 'tempad/runtime-status')
          return status.phase === 'committed' && !status.gated && status
        } catch {
          return false
        }
      },
      'committed runtime and attached edges',
      90000
    )
    if (mode === 'normal' || mode === 'orphan' || mode === 'initial-attach' || claudeStop)
      assert.equal(outcome.status, 'activated', JSON.stringify(outcome))
    if (mode === 'port-conflict')
      assert.equal(outcome.status, 'rolled-back', JSON.stringify(outcome))
    if (
      ['preparing', 'old-stopped', 'candidate-ready', 'committed', 'port-conflict'].includes(mode)
    )
      assert.deepEqual(await record(root, 'test-fault-observed.json'), {
        phase: mode === 'port-conflict' ? 'old-stopped' : mode,
        pid: initial.pid
      })
    assert.deepEqual(await record(root, 'endpoints.json'), endpoints)
    assert.deepEqual(await clients[0].listTools(), catalog)
    assert.deepEqual(await clients[1].listTools(), catalog)
    for (const client of clients)
      await until(async () => {
        try {
          return !(await call(client, 'list_design_sessions')).isError
        } catch {
          return false
        }
      }, 'initialized edge data connection')
    await clients[0].ping()
    assert.equal(await (await fetch(url)).text(), body.toString())
    assert.deepEqual(await readFile(join(root, 'assets', `${hash}.png`)), beforeFile)
    assert.equal(
      (await fetch(url, { headers: { Origin: 'https://attacker.invalid' } })).status,
      403
    )
    extension?.terminate()
    await attach()
    if (mode === 'orphan') {
      const blocked = JSON.parse((await command('--runtime-status')).stdout)
      assert.ok(JSON.stringify(blocked).includes(held.id))
      const snapshot = await record(root, 'state/design-tasks.json')
      assert.ok(snapshot.records.some((value) => value.execution?.id === held.id))
      extension.send(
        JSON.stringify({ type: 'toolCompletion', id: held.id, ...held.terminalReceipt })
      )
      await until(
        () => frames.some((frame) => frame.type === 'toolCompletionAck' && frame.id === held.id),
        'old-generation receipt accepted'
      )
      assert.ok(
        !(await record(root, 'state/design-tasks.json')).records.some(
          (value) => value.execution?.id === held.id
        )
      )
    }
    for (const input of hooks)
      assert.deepEqual(await rpc(root, 'tempad/client-hook', input, 'run/mcp.sock'), {})
    const saved = (await record(root, 'state/design-tasks.json')).records.find(
      (value) => value.task.taskId === taskId
    )
    assert.equal(saved.task.status, mode === 'orphan' || stopAtGate ? 'cancelled' : 'paused')
    if (mode === 'preparing') {
      // The crash precedes shutdown admission. The successor retains the live
      // A Hub and stages B, so the task lease must not change.
      assert.equal(settled.hubId, initial.hubId)
      assert.equal(settled.active.version, '0.11.0')
      assert.equal(settled.candidate.version, '0.11.1')
      assert.equal(saved.task.epoch, epoch)
    } else assert.ok(saved.task.epoch > epoch)
    if (mode === 'normal' || mode === 'claude-stop-rollback') {
      assert.deepEqual(JSON.parse((await command('--recover-runtime')).stdout), {
        status: 'recovered',
        version: '0.11.1'
      })
      assert.equal((await rpc(root, 'tempad/runtime-status')).hubId, settled.hubId)
      // Both cancellation and a yet-undelivered Claude notice must survive rollback.
      if (!claudeStop)
        extension.send(
          JSON.stringify({
            type: 'designAction',
            sessionId: session.sessionId,
            action: { requestId: randomUUID(), taskId, epoch: saved.task.epoch, action: 'stop' }
          })
        )
      await until(
        async () =>
          (await record(root, 'state/design-tasks.json')).records.find(
            (value) => value.task.taskId === taskId
          )?.task.status === 'cancelled',
        'post-activation Stop'
      )
      assert.ok(ownedProcesses(root).includes(settled.hubPid))
      process.kill(settled.hubPid, 'SIGKILL')
      const rollback = await until(
        async () => {
          try {
            const status = await rpc(root, 'tempad/runtime-status')
            return !status.gated && status.active.version === '0.11.0' && status
          } catch {
            return false
          }
        },
        'rollback after active Hub failure',
        90000
      )
      assert.ok(rollback.failure)
      for (const client of clients)
        await until(async () => {
          try {
            return !(await call(client, 'list_design_sessions')).isError
          } catch {
            return false
          }
        }, 'edge data connection after rollback')
      assert.equal(
        (await record(root, 'state/design-tasks.json')).records.find(
          (value) => value.task.taskId === taskId
        ).task.status,
        'cancelled'
      )
      assert.deepEqual(await clients[0].listTools(), catalog)
      assert.equal(await (await fetch(url)).text(), body.toString())
      await assert.rejects(command('--switch', b), /quarantined/)
    }
    if (claudeStop) {
      const input = claudeHook('PreToolUse')
      const result = await applyHook(root, input)
      assert.equal(result.output?.hookSpecificOutput?.hookEventName, 'PreToolUse')
      assert.ok(
        result.output.hookSpecificOutput.additionalContext.includes(
          `The user stopped Figma design task ${taskId}.`
        )
      )
      assert.deepEqual(await applyHook(root, input), result)
      assert.equal((await applyHook(root, claudeHook('PostToolUse'))).output, undefined)
      assert.equal(
        (await record(root, 'state/design-tasks.json')).records.find(
          (value) => value.task.taskId === taskId
        ).task.status,
        'cancelled'
      )
    }
    assert.ok(edgePids.every(alive), 'The original initialized edges must survive handoff.')
    assert.equal(calls.filter((value) => value.payload.name === 'apply_canvas').length, 1)
    results.push({
      mode,
      outcome,
      active: settled.active.version,
      initializedClients: clients.length,
      writes: 1
    })
    passed = true
  } catch (error) {
    throw new Error(`${mode}: ${error.message}\n${stderr}\nRoot: ${root}`, { cause: error })
  } finally {
    conflict?.close()
    extension?.terminate()
    await Promise.allSettled(clients.map((client) => client.close()))
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const pid of ownedProcesses(root)) {
        try {
          process.kill(pid, signal)
        } catch (error) {
          if (error.code !== 'ESRCH') console.error(`Fixture cleanup failed: ${error.message}`)
        }
      }
      await until(() => !ownedProcesses(root).some(alive), 'fixture cleanup', 5000).catch(() => {})
    }
    assert.equal(ownedProcesses(root).length, 0)
    if (passed && !process.env.TEMPAD_KEEP_PROTOTYPE)
      await rm(root, { recursive: true, force: true })
  }
}

async function coldAttachment(entry) {
  const root = await realpath(await mkdtemp('/tmp/tp-sw-cold-'))
  const clients = []
  let passed = false
  let stderr = ''
  async function openClient() {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, '--root', root],
      stderr: 'pipe',
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root }
    })
    transport.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-20000)
    })
    const client = new Client({ name: 'cold-start', version: '1' })
    clients.push(client)
    await client.connect(transport, { timeout: 95000 })
    return { client, pid: transport.pid }
  }
  try {
    const first = await openClient()
    const catalog = await first.client.listTools()
    const initial = await record(root, 'supervisor.json')
    // Kill the edge first so its established recovery cannot publish an endpoint.
    // Leave real writer leases intact; a fresh edge must wait for cold recovery.
    process.kill(first.pid, 'SIGKILL')
    await first.client.close()
    process.kill(initial.pid, 'SIGKILL')
    process.kill(initial.hubPid, 'SIGKILL')
    await until(() => !alive(initial.pid) && !alive(initial.hubPid), 'cold process exit')
    const started = performance.now()
    const second = await openClient()
    const elapsed = performance.now() - started
    assert.ok(elapsed > 5000, `Cold recovery did not exercise the endpoint wait: ${elapsed}ms`)
    assert.deepEqual(await second.client.listTools(), catalog)
    await second.client.ping()
    results.push({
      mode: 'cold-attach',
      elapsedMs: Math.round(elapsed),
      initializedClients: 1,
      writes: 0
    })
    passed = true
  } catch (error) {
    throw new Error(`cold-attach: ${error.message}\n${stderr}\nRoot: ${root}`, { cause: error })
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()))
    for (const pid of ownedProcesses(root)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') console.error(`Fixture cleanup failed: ${error.message}`)
      }
    }
    await until(() => !ownedProcesses(root).some(alive), 'cold fixture cleanup', 5000)
    if (passed && !process.env.TEMPAD_KEEP_PROTOTYPE)
      await rm(root, { recursive: true, force: true })
  }
}
try {
  const a = await artifact('0.11.0')
  const b = await artifact('0.11.1')
  const incompatible = await artifact('0.11.2', true)
  for (const mode of (
    process.env.TEMPAD_SWITCH_CASES ??
    'normal,orphan,preparing,old-stopped,candidate-ready,committed,port-conflict,claude-stop,claude-stop-rollback,initial-attach,cold-attach'
  ).split(',')) {
    if (mode === 'cold-attach') await coldAttachment(a)
    else await scenario(a, b, mode, incompatible)
    console.log(`Runtime switch case passed: ${mode}`)
  }
  console.log(JSON.stringify({ valid: true, cases: results }, null, 2))
  completed = true
} finally {
  // Failed probes retain their own root and executable evidence for diagnosis.
  if (!process.env.TEMPAD_KEEP_PROTOTYPE && completed)
    await rm(artifacts, { recursive: true, force: true })
}
