import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  MessageToExtensionSchema,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
  buildGetCodeToolResult,
  measureCallToolResultBytes
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

import { checkProtocol13 } from './check-protocol-13.mjs'
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
const metricSamples = []
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TEMPAD_MCP_RUNTIME_DIR: directory,
  TEMPAD_MCP_LOG_DIR: directory,
  TEMPAD_MCP_ASSET_DIR: join(directory, 'assets'),
  TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin,
  TEMPAD_MCP_TOOL_TIMEOUT: '1000',
  TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT: '2000',
  TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT: '2000',
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

async function peer(port, legacy, receivingSchema = MessageToExtensionSchema) {
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
      const message = (legacy ? OldMessages : receivingSchema).parse(JSON.parse(raw.toString()))
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
function recordBridgeMetric(label, peer, payload, result) {
  if (process.env.TEMPAD_MCP_BRIDGE_METRICS !== '1') return
  const request = peer.calls.at(-1)
  metricSamples.push({
    label,
    hubToExtensionBytes: Buffer.byteLength(JSON.stringify(request)),
    extensionToHubBytes: Buffer.byteLength(
      JSON.stringify({ type: 'toolResult', id: request.id, payload })
    ),
    mcpResultBytes: measureCallToolResultBytes(result)
  })
}
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

  await checkProtocol13({ port, peer, send, activate, until, call, origin })

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
  recordBridgeMetric('legacy_get_code', old, codeResult(asset), code)
  const nearBudgetCode = codeResult(asset)
  let low = 0
  let high = MCP_TOOL_INLINE_BUDGET_BYTES
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const size = measureCallToolResultBytes(
      buildGetCodeToolResult({ ...nearBudgetCode, code: 'x'.repeat(middle) })
    )
    if (size <= MCP_TOOL_INLINE_BUDGET_BYTES) low = middle
    else high = middle - 1
  }
  nearBudgetCode.code = 'x'.repeat(low)
  assert.ok(
    measureCallToolResultBytes(
      buildGetCodeToolResult({
        ...nearBudgetCode,
        assets: [{ ...asset, localPath: code.structuredContent.assets[0].localPath }]
      })
    ) > MCP_TOOL_INLINE_BUDGET_BYTES
  )
  old.respond = (message) => (message.payload.name === 'get_code' ? nearBudgetCode : structure)
  const nearBudgetResult = await call('get_code', codeArgs)
  assert.equal(nearBudgetResult.isError, undefined)
  assert.equal(nearBudgetResult.structuredContent.code, nearBudgetCode.code)
  assert.equal(nearBudgetResult.structuredContent.assets[0].localPath, undefined)
  recordBridgeMetric('legacy_get_code_budget_fallback', old, nearBudgetCode, nearBudgetResult)
  old.respond = (message) => {
    if (message.payload.name === 'get_code') return codeResult(asset)
    if (message.payload.name === 'get_screenshot')
      return { format: 'png', width: 1, height: 1, scale: 1, bytes: bytes.length, asset }
    return structure
  }
  const legacyStructure = await call('get_structure', { options: { depth: 2 } })
  assert.deepEqual(legacyStructure.structuredContent, structure)
  recordBridgeMetric('legacy_get_structure', old, structure, legacyStructure)
  const legacyScreenshot = await call('get_screenshot')
  assert.equal(legacyScreenshot.structuredContent.asset.hash, hash)
  recordBridgeMetric(
    'legacy_get_screenshot',
    old,
    { format: 'png', width: 1, height: 1, scale: 1, bytes: bytes.length, asset },
    legacyScreenshot
  )
  const count = old.calls.length
  for (const [name, args] of [
    ['get_structure', { pageId: 'page-a' }],
    ['get_structure', { options: { native: true } }],
    ['get_structure', { options: { depth: 0 } }],
    ['get_structure', { nodeIds: ['1:2', '1:3'] }],
    ['get_code', { nodeIds: ['1:2', '1:3'] }],
    ['get_code', { resolveTokens: true }],
    ['get_screenshot', { nodeIds: ['1:2'] }],
    ['get_design_system', {}],
    ['manage_design_task', { action: 'begin', title: 'Unavailable', requestId: randomUUID() }],
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
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
    extensionVersion: '0.21.0',
    extensionRuntimeFingerprint: 'a'.repeat(64)
  })
  // Wait on an echoed state so all preceding frames have been processed.
  modern.activeId = null
  await activate(modern)
  const modernCodePayload = codeResult({
    ...asset,
    url: `${modern.assetServerUrl}/assets/${hash}`
  })
  modernCodePayload.tokens = {
    '--semantic': { kind: 'color', value: '--palette' },
    '--palette': { kind: 'color', value: { 'Palette:Light': '#FFF', 'Palette:Dark': '#000' } }
  }
  modernCodePayload.warnings = [
    { type: 'token-resolution', message: 'An unresolved consumer reference was preserved.' }
  ]
  modern.respond = (message) => {
    assert.equal(message.route.gatewayId, modern.id)
    assert.equal(message.route.sessionId, session.sessionId)
    assert.equal(message.route.fileKey, session.fileKey)
    if (message.payload.name === '__begin_design') return message.payload.args
    return message.payload.name === 'get_code' ? modernCodePayload : structure
  }
  const currentStructure = await call('get_structure')
  assert.deepEqual(currentStructure.structuredContent, structure)
  recordBridgeMetric('current_get_structure', modern, structure, currentStructure)
  const immediateResponse = modern.respond
  let delayedStructureResponse = Promise.resolve()
  modern.respond = (message) => {
    if (message.payload.name !== 'get_structure') return immediateResponse(message)
    delayedStructureResponse = delay(1500).then(() => {
      send(modern, { type: 'toolResult', id: message.id, payload: structure })
    })
    return undefined
  }
  for (const args of [{ pageId: 'page-a' }, { pageKey: 'page-a' }]) {
    const coldPageStructure = await call('get_structure', args)
    assert.deepEqual(coldPageStructure.structuredContent, structure)
  }
  const slowSelectionStructure = await call('get_structure')
  assert.equal(slowSelectionStructure.isError, true)
  assert.match(JSON.stringify(slowSelectionStructure), /EXTENSION_TIMEOUT/)
  await delayedStructureResponse
  // The late result releases the operation fence before another call can use the file.
  modern.activeId = null
  await activate(modern)
  modern.respond = immediateResponse
  const currentCode = await call('get_code', { ...codeArgs, resolveTokens: true })
  assert.equal(currentCode.isError, undefined, JSON.stringify(currentCode))
  assert.equal(currentCode.structuredContent.code, modernCodePayload.code)
  assert.deepEqual(currentCode.structuredContent.tokens, modernCodePayload.tokens)
  assert.deepEqual(currentCode.structuredContent.warnings, modernCodePayload.warnings)
  recordBridgeMetric('current_get_code', modern, modernCodePayload, currentCode)
  const codeWithoutAssets = { ...modernCodePayload }
  delete codeWithoutAssets.assets
  const batchCode = {
    results: [
      { nodeId: '1:2', result: modernCodePayload },
      { nodeId: '1:3', error: { code: 'NODE_NOT_VISIBLE', message: 'Hidden node' } },
      { nodeId: '1:4', result: codeWithoutAssets }
    ],
    remainingNodeIds: ['1:5']
  }
  modern.respond = () => batchCode
  const batchArgs = { nodeIds: ['1:2', '1:3', '1:4', '1:5'], preferredLang: 'jsx' }
  const batchResponse = await call('get_code', batchArgs)
  assert.equal(batchResponse.isError, undefined)
  assert.deepEqual(modern.calls.at(-1).payload.args, batchArgs)
  assert.deepEqual(batchResponse.structuredContent.remainingNodeIds, ['1:5'])
  assert.deepEqual(batchResponse.structuredContent.results.slice(1), batchCode.results.slice(1))
  assert.deepEqual(
    await readFile(batchResponse.structuredContent.results[0].result.assets[0].localPath),
    bytes
  )
  const batchScreenshot = {
    results: [
      {
        nodeId: '1:2',
        result: {
          format: 'png',
          width: 1,
          height: 1,
          scale: 1,
          bytes: bytes.length,
          asset: modernCodePayload.assets[0]
        }
      },
      { nodeId: '1:3', error: { code: 'NODE_NOT_VISIBLE', message: 'Hidden node' } }
    ]
  }
  modern.respond = () => batchScreenshot
  const screenshots = await call('get_screenshot', { nodeIds: ['1:2', '1:3'] })
  assert.equal(screenshots.content.filter(({ type }) => type === 'resource_link').length, 1)
  assert.deepEqual(screenshots.structuredContent.results[1], batchScreenshot.results[1])
  assert.deepEqual(
    await readFile(screenshots.structuredContent.results[0].result.asset.localPath),
    bytes
  )
  const nearBudgetBatch = { results: [{ nodeId: '1:2', result: { ...modernCodePayload } }] }
  low = 0
  high = MCP_TOOL_INLINE_BUDGET_BYTES
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    nearBudgetBatch.results[0].result.code = 'x'.repeat(middle)
    if (
      measureCallToolResultBytes(buildGetCodeToolResult(nearBudgetBatch)) <=
      MCP_TOOL_INLINE_BUDGET_BYTES
    )
      low = middle
    else high = middle - 1
  }
  nearBudgetBatch.results[0].result.code = 'x'.repeat(low)
  modern.respond = () => nearBudgetBatch
  const boundedBatch = await call('get_code', { nodeIds: ['1:2'] })
  assert.equal(boundedBatch.isError, undefined)
  assert.equal(boundedBatch.structuredContent.results[0].result.assets[0].localPath, undefined)
  assert.ok(measureCallToolResultBytes(boundedBatch) <= MCP_TOOL_INLINE_BUDGET_BYTES)
  modern.respond = immediateResponse
  send(modern, {
    type: 'sessions',
    browserId: 'browser-a',
    activeSessionId: null,
    sessions: [session]
  })
  await until(async () => {
    const inactive = await call('get_code')
    return inactive.isError && JSON.stringify(inactive).includes('NO_ACTIVE_EXTENSION')
  }, 'inactive default Figma session')
  await activate(old)
  const exactCode = await call('get_code', { ...codeArgs, sessionId: session.sessionId })
  assert.equal(exactCode.structuredContent.code, modernCodePayload.code)
  assert.deepEqual(modern.calls.at(-1).payload.args, codeArgs)
  recordBridgeMetric('exact_session_get_code', modern, modernCodePayload, exactCode)
  assert.equal(old.calls.length, count, 'exact session reads must bypass the active legacy peer')
  const exactStructure = await call('get_structure', { sessionId: session.sessionId })
  assert.deepEqual(exactStructure.structuredContent, structure)
  assert.deepEqual(modern.calls.at(-1).payload.args, {})
  recordBridgeMetric('exact_session_get_structure', modern, structure, exactStructure)
  const designSystem = {
    catalogId: 'ds_slow-discovery',
    components: [],
    variables: [],
    collections: [],
    styles: []
  }
  const regularResponse = modern.respond
  const pageIndex = {
    scope: 'pages',
    pages: [{ id: '4:216', name: 'Local components', index: 0, active: false }]
  }
  modern.respond = (message) => {
    if (message.payload.name !== 'get_design_system') return regularResponse(message)
    return message.payload.args.scope === 'pages' ? pageIndex : designSystem
  }
  const pages = await call('get_design_system', {
    scope: 'pages',
    sessionId: session.sessionId
  })
  assert.deepEqual(pages.structuredContent, pageIndex)
  assert.deepEqual(modern.calls.at(-1).payload.args, { scope: 'pages' })
  recordBridgeMetric('exact_session_page_index', modern, pageIndex, pages)
  const scopedResources = await call('get_design_system', {
    pageId: '4:216',
    sessionId: session.sessionId
  })
  assert.deepEqual(scopedResources.structuredContent, designSystem)
  assert.deepEqual(modern.calls.at(-1).payload.args, { pageId: '4:216' })
  recordBridgeMetric('exact_session_scoped_resources', modern, designSystem, scopedResources)
  modern.respond = (message) => {
    if (message.payload.name !== 'get_design_system') return regularResponse(message)
    setTimeout(() => {
      send(modern, { type: 'toolResult', id: message.id, payload: designSystem })
    }, 1500)
    return undefined
  }
  const slowDesignSystem = await call('get_design_system', { sessionId: session.sessionId })
  assert.deepEqual(slowDesignSystem.structuredContent, designSystem)
  modern.respond = regularResponse
  assert.match(
    JSON.stringify(await call('get_code', { sessionId: 'missing-session' })),
    /NO_ACTIVE_EXTENSION/
  )
  const lifecycle = (args) => call('manage_design_task', args)
  const advertisedTools = (await client.listTools()).tools
  assert.equal(advertisedTools.length, 10)
  assert.ok(
    !advertisedTools.some(({ name }) =>
      ['begin_design', 'resume_design', 'end_design'].includes(name)
    )
  )
  const lifecycleSchema = advertisedTools.find(
    ({ name }) => name === 'manage_design_task'
  ).inputSchema
  assert.equal(lifecycleSchema.type, 'object')
  assert.deepEqual(lifecycleSchema.properties.action.enum, [
    'begin',
    'resume',
    'complete',
    'cancel'
  ])
  assert.ok(lifecycleSchema.properties.requestId)
  assert.ok(lifecycleSchema.properties.epoch)
  const beginArgs = {
    action: 'begin',
    title: 'Current task',
    requestId: randomUUID(),
    sessionId: session.sessionId
  }
  const begin = await lifecycle(beginArgs)
  let task = begin.structuredContent
  assert.ok(task.taskId, JSON.stringify(begin))
  assert.equal((await lifecycle(beginArgs)).structuredContent.taskId, task.taskId)
  const taskStructure = await call('get_structure', { taskId: task.taskId })
  assert.deepEqual(taskStructure.structuredContent, structure)
  recordBridgeMetric('task_get_structure', modern, structure, taskStructure)
  const taskCode = await call('get_code', { ...codeArgs, taskId: task.taskId })
  assert.equal(taskCode.structuredContent.code, modernCodePayload.code)
  recordBridgeMetric('task_get_code', modern, modernCodePayload, taskCode)
  assert.equal(modern.calls.at(-1).route.taskId, task.taskId)
  const routedCount = modern.calls.length
  assert.match(
    JSON.stringify(
      await call('get_code', { ...codeArgs, taskId: task.taskId, sessionId: 'missing-session' })
    ),
    /DESIGN_TARGET_CHANGED/
  )
  assert.equal(modern.calls.length, routedCount, 'conflicting task/session must not dispatch')
  assert.equal(old.calls.length, count, 'task-bound reads must not follow legacy activation')

  const completed = await lifecycle({
    action: 'complete',
    taskId: task.taskId,
    epoch: 0,
    summary: 'Verified'
  })
  assert.equal(completed.structuredContent.status, 'completed')
  assert.ok(!completed.structuredContent.reviewClosed)
  assert.equal(
    (await lifecycle({ action: 'complete', taskId: task.taskId, epoch: 0 })).structuredContent
      .status,
    'completed'
  )
  const resumed = await lifecycle({ action: 'resume', taskId: task.taskId, epoch: 0 })
  assert.equal(resumed.structuredContent.status, 'active')
  assert.equal(resumed.structuredContent.epoch, 1)
  assert.equal(resumed.structuredContent.needsRead, true)
  assert.equal(
    (await lifecycle({ action: 'resume', taskId: task.taskId, epoch: 1 })).structuredContent.epoch,
    1
  )
  assert.equal(
    (await lifecycle({ action: 'complete', taskId: task.taskId, epoch: 0 })).isError,
    true
  )
  assert.equal((await lifecycle({ action: 'cancel', taskId: task.taskId })).isError, true)
  assert.equal(
    (await call('get_design_task', { taskId: task.taskId })).structuredContent.status,
    'active'
  )
  assert.equal(
    (await call('get_structure', { taskId: task.taskId, taskEpoch: 1 })).isError,
    undefined
  )
  assert.equal(
    (await call('get_design_task', { taskId: task.taskId })).structuredContent.needsRead,
    false
  )
  const cancelled = await lifecycle({ action: 'cancel', taskId: task.taskId, epoch: 1 })
  assert.equal(cancelled.structuredContent.status, 'cancelled')
  assert.equal((await lifecycle({ action: 'resume', taskId: task.taskId, epoch: 1 })).isError, true)
  assert.equal(
    (await lifecycle({ action: 'cancel', taskId: task.taskId, epoch: 1 })).structuredContent.status,
    'cancelled'
  )
  task = (await lifecycle({ ...beginArgs, requestId: randomUUID() })).structuredContent
  assert.ok(task.taskId)

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
  if (metricSamples.length) {
    process.stdout.write(`Bridge byte samples: ${JSON.stringify(metricSamples)}\n`)
  }
  process.stdout.write(
    'Bridge compatibility passed: protocol 13 reads/writes/tasks/assets/reconnect, legacy reads/assets/reconnect, upgrade errors, current routing and task fences.\n'
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
