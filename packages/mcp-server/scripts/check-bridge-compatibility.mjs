import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  MessageToExtensionSchema,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_BRIDGE_SUBPROTOCOL
} from '@tempad-dev/shared'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import { WebSocket } from 'ws'

import {
  MessageToExtensionSchema as OldMessages,
  codeResult,
  structure
} from './fixtures/extension-0.20.0.mjs'

// Exercise the shipped Hub, without connecting to the user's Hub or Figma sessions.
// A dedicated Origin allowlist prevents the browser from joining this test Hub.
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const directory = await mkdtemp(join(tmpdir(), 'tempad-bridge-'))
const peers = []
const failures = []
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TEMPAD_MCP_RUNTIME_DIR: directory,
  TEMPAD_MCP_LOG_DIR: directory,
  TEMPAD_MCP_ASSET_DIR: join(directory, 'assets'),
  TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin,
  TEMPAD_MCP_TOOL_TIMEOUT: '1000',
  TEMPAD_MCP_AUTO_ACTIVATE_GRACE: '10'
}
const hub = spawn(process.execPath, [fileURLToPath(new URL('../dist/hub.mjs', import.meta.url))], {
  env: environment,
  stdio: ['ignore', 'ignore', 'pipe']
})
let stderr = ''
hub.stderr.on('data', (data) => {
  stderr += data
})
hub.on('error', (error) => failures.push(error))
const client = new Client({ name: 'bridge-test', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))],
  env: environment,
  stderr: 'pipe'
})
transport.stderr.on('data', (data) => {
  stderr += data
})
client.onerror = (error) => failures.push(error)

async function until(read, description) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (failures.length) throw failures[0]
    const value = await read()
    if (value) return value
    if (hub.exitCode !== null || hub.signalCode !== null) throw new Error(`Hub exited: ${stderr}`)
    await delay(25)
  }
  throw new Error(`Timed out: ${description}; ${stderr}`)
}

async function peer(port, legacy) {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/`,
    legacy ? [] : [TEMPAD_MCP_BRIDGE_SUBPROTOCOL],
    { origin }
  )
  const state = {
    socket,
    frames: [],
    calls: [],
    id: null,
    activeId: null,
    assetServerUrl: null,
    respond: null
  }
  peers.push(state)
  socket.on('error', (error) => failures.push(error))
  socket.on('message', (raw) => {
    try {
      const message = (legacy ? OldMessages : MessageToExtensionSchema).parse(
        JSON.parse(raw.toString())
      )
      state.frames.push(message)
      if (message.type === 'registered') state.id = message.id
      if (message.type === 'state')
        Object.assign(state, { activeId: message.activeId, assetServerUrl: message.assetServerUrl })
      if (message.type === 'toolCall') {
        state.calls.push(message)
        const payload = state.respond?.(message)
        if (payload !== undefined) send(state, { type: 'toolResult', id: message.id, payload })
      }
    } catch (error) {
      failures.push(error)
    }
  })
  await until(() => state.id && state.assetServerUrl, 'extension handshake')
  return state
}

function send(peer, message) {
  peer.socket.send(JSON.stringify(message))
}
async function activate(peer) {
  send(peer, { type: 'activate' })
  await until(() => peer.activeId === peer.id, 'activation')
}
const call = (name, args = {}) =>
  client.callTool({ name, arguments: args }, undefined, { timeout: 5000 })
function upgrade(result) {
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /EXTENSION_UPGRADE_REQUIRED/)
  assert.match(JSON.stringify(result), /reload the Figma tab/)
}

try {
  const port = await until(async () => {
    const files = (await readdir(directory)).filter((name) => name.endsWith('.log'))
    const logs = (
      await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')))
    ).join('\n')
    return Number(logs.match(/WebSocket server ready\.[\s\S]*?port: (\d+)/)?.[1])
  }, 'isolated Hub startup')
  await client.connect(transport, { timeout: 5000 })

  const old = await peer(port, true)
  await activate(old)
  // Match 0.20.0's actual SHA-256-prefix upload protocol, including its bare URL.
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9WQAAAAASUVORK5CYII=',
    'base64'
  )
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  const asset = {
    hash,
    url: `${old.assetServerUrl}/assets/${hash}`,
    mimeType: 'image/png',
    size: bytes.length,
    width: 1,
    height: 1
  }
  const uploaded = await globalThis.fetch(asset.url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': asset.mimeType },
    body: bytes
  })
  assert.equal(uploaded.status, 201)
  old.respond = (message) => {
    assert.equal('route' in message, false)
    if (message.payload.name === 'get_code') return codeResult(asset)
    if (message.payload.name === 'get_screenshot')
      return { format: 'png', width: 1, height: 1, scale: 1, bytes: bytes.length, asset }
    assert.equal(message.payload.name, 'get_structure')
    return structure
  }
  const codeArgs = {
    nodeId: '1:2',
    preferredLang: 'jsx',
    vectorMode: 'smart',
    resolveTokens: false
  }
  const code = await call('get_code', codeArgs)
  assert.equal(code.isError, undefined)
  assert.equal(code.structuredContent.code, codeResult(asset).code)
  assert.deepEqual(code.structuredContent.tokens, codeResult(asset).tokens)
  assert.deepEqual(old.calls.at(-1).payload.args, codeArgs)
  assert.deepEqual(await readFile(code.structuredContent.assets[0].localPath), bytes)
  assert.deepEqual(Buffer.from(await (await globalThis.fetch(asset.url)).arrayBuffer()), bytes)
  assert.deepEqual(
    (await call('get_structure', { options: { depth: 2 } })).structuredContent,
    structure
  )
  assert.equal((await call('get_screenshot')).structuredContent.asset.hash, hash)
  const count = old.calls.length
  for (const [name, args] of [
    ['get_structure', { pageId: 'page-a' }],
    ['get_structure', { options: { native: true } }],
    ['get_design_system', {}],
    ['begin_design', { title: 'Unavailable', requestId: randomUUID() }],
    ['list_design_sessions', {}],
    ['apply_canvas', { mode: 'create', markup: '<frame key="root" />' }]
  ])
    upgrade(await call(name, args))
  assert.equal(old.calls.length, count, 'unsupported calls must not reach the old peer')

  // A versioned peer with no runtime identity must not enter the legacy bypass.
  const modern = await peer(port, false)
  assert.equal(modern.frames[0].protocolVersion, TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION)
  assert.notEqual(modern.assetServerUrl, old.assetServerUrl)
  const session = {
    sessionId: 'tab-a',
    fileKey: 'file-a',
    fileName: 'Current',
    pageId: 'page-a',
    busy: false
  }
  send(modern, {
    type: 'sessions',
    browserId: 'browser-a',
    activeSessionId: session.sessionId,
    sessions: [session]
  })
  await activate(modern)
  assert.match(JSON.stringify(await call('get_code')), /RUNTIME_IDENTITY_MISMATCH/)
  send(modern, {
    type: 'runtimeHello',
    extensionVersion: '0.21.0',
    extensionRuntimeFingerprint: 'a'.repeat(64)
  })
  // Wait on an echoed state so all preceding frames have been processed.
  modern.activeId = null
  await activate(modern)
  modern.respond = (message) => {
    assert.equal(message.route.gatewayId, modern.id)
    assert.equal(message.route.sessionId, session.sessionId)
    assert.equal(message.route.fileKey, session.fileKey)
    return message.payload.name === '__begin_design' ? message.payload.args : structure
  }
  assert.deepEqual((await call('get_structure')).structuredContent, structure)
  const begin = await call('begin_design', { title: 'Current task', requestId: randomUUID() })
  const task = begin.structuredContent
  assert.ok(task.taskId, JSON.stringify(begin))
  await activate(old)
  assert.deepEqual(
    (await call('get_structure', { taskId: task.taskId })).structuredContent,
    structure
  )
  assert.equal(modern.calls.at(-1).route.taskId, task.taskId)
  assert.equal(old.calls.length, count, 'task-bound reads must not follow legacy activation')

  // A disconnect fails in-flight old reads, and a replacement gets a new identity.
  old.respond = null
  const interrupted = call('get_structure')
  await until(() => old.calls.length > count, 'pending legacy read')
  old.socket.close()
  assert.match(JSON.stringify(await interrupted), /EXTENSION_DISCONNECTED/)
  const replacement = await peer(port, true)
  replacement.respond = () => structure
  await activate(replacement)
  assert.notEqual(replacement.id, old.id)
  assert.deepEqual((await call('get_structure')).structuredContent, structure)
  modern.socket.close()
  await once(modern.socket, 'close')
  const replacementCount = replacement.calls.length
  const unavailable = await call('get_structure', { taskId: task.taskId })
  assert.equal(unavailable.isError, true)
  assert.equal(
    replacement.calls.length,
    replacementCount,
    'disconnected tasks cannot fall back to legacy'
  )
  assert.deepEqual(failures, [])
  process.stdout.write(
    'Bridge compatibility passed: legacy reads/assets/reconnect, upgrade errors, current routing and task fences.\n'
  )
} finally {
  for (const peer of peers) peer.socket.terminate()
  await client.close()
  hub.kill('SIGTERM')
  if (hub.exitCode === null && hub.signalCode === null) {
    const killer = setTimeout(() => hub.kill('SIGKILL'), 3000)
    await once(hub, 'exit')
    clearTimeout(killer)
  }
  await rm(directory, { recursive: true, force: true })
}
