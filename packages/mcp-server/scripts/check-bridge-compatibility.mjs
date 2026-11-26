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
import { access, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import { WebSocket } from 'ws'

import {
  GetCodeParametersSchema,
  GetDesignSystemParametersSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema,
  MessageToExtensionSchema as ReleasedMessages,
  releasedHello,
  releasedHelloAfterRegistration
} from './fixtures/extension-1.0.0.mjs'

const structure = {
  roots: [{ id: '1:2', name: 'Released frame', type: 'FRAME', x: 0, y: 0, width: 320, height: 240 }]
}
const releasedReadSchemas = new Map([
  ['get_code', GetCodeParametersSchema],
  ['get_design_system', GetDesignSystemParametersSchema],
  ['get_screenshot', GetScreenshotParametersSchema],
  ['get_structure', GetStructureParametersSchema]
])
const releasedReceiver = {
  parse(value) {
    const message = ReleasedMessages.parse(value)
    if (message.type === 'toolCall') {
      const schema = releasedReadSchemas.get(message.payload.name)
      if (schema) assert.deepEqual(schema.parse(message.payload.args), message.payload.args)
    }
    return message
  }
}

if (process.platform === 'win32') {
  throw new Error(
    'Bridge compatibility checks cannot run safely on Windows: the fixed named pipe is not isolated by TEMPAD_MCP_RUNTIME_DIR. Run this harness on Linux or macOS.'
  )
}

// Also accepts an unpacked/installed package, using the same frozen receiving fixtures.
const packageDir = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
await Promise.all(['hub.mjs', 'cli.mjs'].map((file) => access(join(packageDir, 'dist', file))))
// Exercise the shipped Hub, without connecting to the user's Hub or Figma sessions.
// A dedicated Origin allowlist prevents the browser from joining this test Hub.
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const directory = await realpath(await mkdtemp(join(tmpdir(), 'tempad-bridge-')))
const peers = []
const failures = []
const metricSamples = []
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TEMPAD_MCP_RUNTIME_DIR: directory,
  TEMPAD_MCP_LOG_DIR: directory,
  TEMPAD_MCP_ASSET_DIR: join(directory, 'assets'),
  TEMPAD_MCP_STATE_DIR: join(directory, 'state'),
  TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS: origin,
  TEMPAD_MCP_TOOL_TIMEOUT: '1000',
  TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT: '2000',
  TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT: '2000',
  TEMPAD_MCP_AUTO_ACTIVATE_GRACE: '10'
}
const hub = spawn(process.execPath, [join(packageDir, 'dist/hub.mjs')], {
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
  args: [join(packageDir, 'dist/cli.mjs')],
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

async function peer(port, receivingSchema = MessageToExtensionSchema) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`, [TEMPAD_MCP_BRIDGE_SUBPROTOCOL], {
    origin
  })
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
      const message = receivingSchema.parse(JSON.parse(raw.toString()))
      state.frames.push(message)
      if (message.type === 'registered') state.id = message.id
      if (message.type === 'state') {
        if (state.assetServerUrl) assert.equal(message.assetServerUrl, state.assetServerUrl)
        Object.assign(state, { activeId: message.activeId, assetServerUrl: message.assetServerUrl })
      }
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
  assert.equal(state.activeId, null)
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
try {
  const port = await until(async () => {
    const files = (await readdir(directory)).filter((name) => name.endsWith('.log'))
    const logs = (
      await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')))
    ).join('\n')
    return Number(logs.match(/WebSocket server ready\.[\s\S]*?port: (\d+)/)?.[1])
  }, 'isolated Hub startup')
  await client.connect(transport, { timeout: 5000 })

  const unversioned = new WebSocket(`ws://127.0.0.1:${port}/`, { origin })
  await assert.rejects(once(unversioned, 'open'), /Unexpected server response: 401/)

  for (const protocolVersion of [undefined, 13]) {
    const unsupported = await peer(port)
    const closed = once(unsupported.socket, 'close')
    send(unsupported, { ...releasedHello, protocolVersion, extensionVersion: '0.22.0' })
    const [code, reason] = await closed
    assert.equal(code, 1008)
    assert.match(reason.toString(), /extension 1\.0 or later.*reload Figma/)
    assert.equal(unsupported.calls.length, 0)
  }

  const session = {
    sessionId: 'tab-a',
    fileKey: 'file-a',
    fileName: 'Released',
    pageId: 'page-a',
    tabId: 13,
    documentId: 'document-a',
    busy: false
  }
  function publishReleasedSession(extension, target = session, active = true, reviews) {
    send(extension, {
      type: 'sessions',
      browserId: 'browser-a',
      activeSessionId: active ? target.sessionId : null,
      sessions: [target],
      ...(reviews ? { reviews } : {})
    })
  }
  const missingHello = await peer(port)
  const rejectMissingHello = once(missingHello.socket, 'close')
  publishReleasedSession(missingHello)
  assert.equal((await rejectMissingHello)[0], 1008)

  async function connectReleased(target = session, reviews) {
    const extension = await peer(port, releasedReceiver)
    const [registration] = extension.frames
    assert.equal(registration.protocolVersion, 15)
    assert.deepEqual(registration.supportedProtocolVersions ?? [registration.protocolVersion], [15])
    send(extension, releasedHelloAfterRegistration(registration))
    publishReleasedSession(extension, target, true, reviews)
    await activate(extension)
    return extension
  }

  const released = await connectReleased()
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9WQAAAAASUVORK5CYII=',
    'base64'
  )
  const hash = createHash('sha256').update(bytes).digest('hex')
  const asset = {
    hash,
    url: `${released.assetServerUrl}/assets/${hash}`,
    mimeType: 'image/png',
    size: bytes.length,
    width: 1,
    height: 1
  }
  const upload = (url) =>
    globalThis.fetch(url, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': asset.mimeType },
      body: bytes
    })
  assert.equal((await upload(asset.url)).status, 201)
  assert.equal((await upload(`${released.assetServerUrl}/assets/${hash.slice(0, 8)}`)).ok, false)
  assert.deepEqual(Buffer.from(await (await globalThis.fetch(asset.url)).arrayBuffer()), bytes)

  const codeArgs = {
    nodeId: '1:2',
    preferredLang: 'jsx',
    vectorMode: 'smart',
    resolveTokens: false
  }
  const codePayload = {
    code: '<div class="text-[var(--semantic)]" />',
    lang: 'jsx',
    assets: [asset],
    tokens: {
      '--semantic': { kind: 'color', value: '--palette' },
      '--palette': { kind: 'color', value: { 'Palette:Light': '#FFF', 'Palette:Dark': '#000' } }
    },
    codegen: { plugin: 'default', config: { cssUnit: 'px', rootFontSize: 16, scale: 1 } },
    warnings: [
      { type: 'token-resolution', message: 'An unresolved consumer reference was preserved.' }
    ]
  }
  released.respond = (message) => {
    assert.equal(message.route.gatewayId, released.id)
    assert.equal(message.route.sessionId, session.sessionId)
    assert.equal(message.route.fileKey, session.fileKey)
    if (message.payload.name === '__begin_design') return message.payload.args
    if (message.payload.name === 'apply_canvas') {
      assert.deepEqual(message.payload.args, {
        mode: 'update',
        targetNodeId: '1:2',
        markup: '<frame key="root" />'
      })
      return {
        rootNodeId: '1:2',
        nodeIdsByKey: { root: '1:2' },
        createdNodeIds: [],
        updatedNodeIds: ['1:2'],
        removedNodeIds: [],
        mutationCount: 1,
        verification: { status: 'passed', nodesChecked: 1, referencesChecked: 0, warnings: [] }
      }
    }
    return message.payload.name === 'get_code' ? codePayload : structure
  }
  const rootOnly = await call('get_structure', {
    nodeIds: ['1:2'],
    options: { depth: 0, native: true }
  })
  assert.deepEqual(rootOnly.structuredContent, structure)
  recordBridgeMetric('released_get_structure', released, structure, rootOnly)
  const immediateResponse = released.respond
  let delayedStructureResponse = Promise.resolve()
  released.respond = (message) => {
    if (message.payload.name !== 'get_structure') return immediateResponse(message)
    delayedStructureResponse = delay(1500).then(() => {
      send(released, { type: 'toolResult', id: message.id, payload: structure })
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
  released.activeId = null
  await activate(released)
  released.respond = immediateResponse
  const releasedCode = await call('get_code', { ...codeArgs, resolveTokens: true })
  assert.equal(releasedCode.isError, undefined, JSON.stringify(releasedCode))
  assert.equal(releasedCode.structuredContent.code, codePayload.code)
  assert.deepEqual(releasedCode.structuredContent.tokens, codePayload.tokens)
  assert.deepEqual(releasedCode.structuredContent.warnings, codePayload.warnings)
  recordBridgeMetric('released_get_code', released, codePayload, releasedCode)
  const codeWithoutAssets = { ...codePayload }
  delete codeWithoutAssets.assets
  const batchCode = {
    results: [
      { nodeId: '1:2', result: codePayload },
      { nodeId: '1:3', error: { code: 'NODE_NOT_VISIBLE', message: 'Hidden node' } },
      { nodeId: '1:4', result: codeWithoutAssets }
    ],
    remainingNodeIds: ['1:5']
  }
  released.respond = () => batchCode
  const batchArgs = { nodeIds: ['1:2', '1:3', '1:4', '1:5'], preferredLang: 'jsx' }
  const batchResponse = await call('get_code', batchArgs)
  assert.equal(batchResponse.isError, undefined)
  assert.deepEqual(released.calls.at(-1).payload.args, batchArgs)
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
          asset: codePayload.assets[0]
        }
      },
      { nodeId: '1:3', error: { code: 'NODE_NOT_VISIBLE', message: 'Hidden node' } }
    ]
  }
  released.respond = () => batchScreenshot
  const screenshots = await call('get_screenshot', { nodeIds: ['1:2', '1:3'] })
  assert.equal(screenshots.content.filter(({ type }) => type === 'resource_link').length, 1)
  assert.deepEqual(screenshots.structuredContent.results[1], batchScreenshot.results[1])
  assert.deepEqual(
    await readFile(screenshots.structuredContent.results[0].result.asset.localPath),
    bytes
  )
  const nearBudgetBatch = { results: [{ nodeId: '1:2', result: { ...codePayload } }] }
  let low = 0
  let high = MCP_TOOL_INLINE_BUDGET_BYTES
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
  released.respond = () => nearBudgetBatch
  const boundedBatch = await call('get_code', { nodeIds: ['1:2'] })
  assert.equal(boundedBatch.isError, undefined)
  assert.equal(boundedBatch.structuredContent.results[0].result.assets[0].localPath, undefined)
  assert.ok(measureCallToolResultBytes(boundedBatch) <= MCP_TOOL_INLINE_BUDGET_BYTES)
  released.respond = immediateResponse
  publishReleasedSession(released, session, false)
  await until(async () => {
    const inactive = await call('get_code')
    return inactive.isError && JSON.stringify(inactive).includes('NO_ACTIVE_EXTENSION')
  }, 'inactive default Figma session')
  const currentSession = {
    ...session,
    sessionId: 'tab-b',
    fileKey: 'file-b',
    tabId: 14,
    documentId: 'document-b'
  }
  const current = await peer(port)
  send(current, {
    ...releasedHello,
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
    extensionVersion: '1.1.1',
    extensionRuntimeFingerprint: 'c'.repeat(64)
  })
  send(current, {
    type: 'sessions',
    browserId: 'browser-b',
    activeSessionId: currentSession.sessionId,
    sessions: [currentSession]
  })
  current.respond = (message) => {
    assert.equal(message.route.sessionId, currentSession.sessionId)
    return structure
  }
  await activate(current)
  assert.deepEqual((await call('get_structure')).structuredContent, structure)
  const activeCalls = current.calls.length
  const exactCode = await call('get_code', { ...codeArgs, sessionId: session.sessionId })
  assert.equal(exactCode.structuredContent.code, codePayload.code)
  assert.deepEqual(released.calls.at(-1).payload.args, codeArgs)
  recordBridgeMetric('exact_session_get_code', released, codePayload, exactCode)
  assert.equal(current.calls.length, activeCalls, 'exact reads must bypass the active peer')
  const exactStructure = await call('get_structure', { sessionId: session.sessionId })
  assert.deepEqual(exactStructure.structuredContent, structure)
  assert.deepEqual(released.calls.at(-1).payload.args, {})
  recordBridgeMetric('exact_session_get_structure', released, structure, exactStructure)
  const designSystem = {
    catalogId: 'ds_slow-discovery',
    components: [],
    variables: [],
    collections: [],
    styles: []
  }
  const regularResponse = released.respond
  const pageIndex = {
    scope: 'pages',
    pages: [{ id: '4:216', name: 'Local components', index: 0, active: false }]
  }
  released.respond = (message) => {
    if (message.payload.name !== 'get_design_system') return regularResponse(message)
    return message.payload.args.scope === 'pages' ? pageIndex : designSystem
  }
  const pages = await call('get_design_system', {
    scope: 'pages',
    sessionId: session.sessionId
  })
  assert.deepEqual(pages.structuredContent, pageIndex)
  assert.deepEqual(released.calls.at(-1).payload.args, { scope: 'pages' })
  recordBridgeMetric('exact_session_page_index', released, pageIndex, pages)
  const scopedResources = await call('get_design_system', {
    pageId: '4:216',
    sessionId: session.sessionId
  })
  assert.deepEqual(scopedResources.structuredContent, designSystem)
  assert.deepEqual(released.calls.at(-1).payload.args, { pageId: '4:216' })
  recordBridgeMetric('exact_session_scoped_resources', released, designSystem, scopedResources)
  released.respond = (message) => {
    if (message.payload.name !== 'get_design_system') return regularResponse(message)
    setTimeout(() => {
      send(released, { type: 'toolResult', id: message.id, payload: designSystem })
    }, 1500)
    return undefined
  }
  const slowDesignSystem = await call('get_design_system', { sessionId: session.sessionId })
  assert.deepEqual(slowDesignSystem.structuredContent, designSystem)
  released.respond = regularResponse
  assert.match(
    JSON.stringify(await call('get_code', { sessionId: 'missing-session' })),
    /NO_ACTIVE_EXTENSION/
  )
  const lifecycle = (args) => call('manage_design_task', args)
  const advertisedTools = (await client.listTools()).tools
  assert.equal(advertisedTools.length, 10)
  assert.ok(
    !advertisedTools.some(({ name }) =>
      ['begin_design', 'resume_design', 'end_design', 'get_token_defs'].includes(name)
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
  recordBridgeMetric('task_get_structure', released, structure, taskStructure)
  const taskCode = await call('get_code', { ...codeArgs, taskId: task.taskId })
  assert.equal(taskCode.structuredContent.code, codePayload.code)
  recordBridgeMetric('task_get_code', released, codePayload, taskCode)
  assert.equal(released.calls.at(-1).route.taskId, task.taskId)
  const routedCount = released.calls.length
  assert.match(
    JSON.stringify(
      await call('get_code', { ...codeArgs, taskId: task.taskId, sessionId: 'missing-session' })
    ),
    /DESIGN_TARGET_CHANGED/
  )
  assert.equal(released.calls.length, routedCount, 'conflicting task/session must not dispatch')
  assert.equal(current.calls.length, activeCalls, 'task reads must stay bound to the released peer')
  const write = await call('apply_canvas', {
    taskId: task.taskId,
    taskEpoch: task.epoch,
    mode: 'update',
    targetNodeId: '1:2',
    markup: '<frame key="root" />'
  })
  assert.equal(write.isError, undefined, JSON.stringify(write))
  assert.equal(write.structuredContent.mutationCount, 1)
  assert.equal(write.structuredContent.runtime.extension.version, releasedHello.extensionVersion)
  const releasedWrite = released.calls.at(-1)
  assert.equal(releasedWrite.route.taskId, task.taskId)
  assert.ok(releasedWrite.terminalReceipt)
  send(released, { type: 'toolCompletion', id: releasedWrite.id, ...releasedWrite.terminalReceipt })
  await until(
    () =>
      released.frames.some(
        (frame) =>
          frame.type === 'toolCompletionAck' && frame.id === releasedWrite.id && frame.accepted
      ),
    'released write completion acknowledgment'
  )
  assert.equal(
    current.calls.length,
    activeCalls,
    'task writes must stay bound to the released peer'
  )

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
  const requestId = randomUUID()
  send(released, {
    type: 'designAction',
    sessionId: session.sessionId,
    action: { requestId, taskId: task.taskId, epoch: task.epoch, action: 'stop' }
  })
  await until(
    () =>
      released.frames.some(
        (frame) => frame.type === 'designActionResult' && frame.result.requestId === requestId
      ),
    'released Stop acknowledgment'
  )
  const stopped = await until(async () => {
    const { structuredContent } = await call('get_design_task', { taskId: task.taskId })
    return structuredContent?.status === 'cancelled' && structuredContent
  }, 'released Stop fence')

  // A disconnected request keeps its executor fenced until the old document is gone.
  released.respond = null
  const pendingCount = released.calls.length
  const interrupted = call('get_structure', { sessionId: session.sessionId })
  await until(() => released.calls.length > pendingCount, 'pending released read')
  const disconnected = once(released.socket, 'close')
  released.socket.close()
  assert.match(JSON.stringify(await interrupted), /EXTENSION_DISCONNECTED/)
  await disconnected
  const replacement = await connectReleased(session, [
    { sessionId: session.sessionId, task: stopped }
  ])
  replacement.respond = () => structure
  assert.notEqual(replacement.id, released.id)
  assert.match(
    JSON.stringify(await call('get_structure', { sessionId: session.sessionId })),
    /DESIGN_TASK_BUSY/
  )
  assert.equal(replacement.calls.length, 0)
  assert.equal(
    (await lifecycle({ action: 'resume', taskId: task.taskId, epoch: task.epoch })).isError,
    true
  )
  const reloadedSession = { ...session, sessionId: 'reloaded-a', documentId: 'reloaded-document-a' }
  publishReleasedSession(replacement, reloadedSession)
  await until(
    async () =>
      (await call('list_design_sessions')).structuredContent.sessions.some(
        ({ sessionId }) => sessionId === reloadedSession.sessionId
      ),
    'reloaded released document'
  )
  assert.deepEqual((await call('get_structure')).structuredContent, structure)
  const replacementCalls = replacement.calls.length
  const unavailable = await call('get_structure', { taskId: task.taskId })
  assert.equal(unavailable.isError, true)
  assert.equal(replacement.calls.length, replacementCalls, 'Stop survives reconnect and reload')
  assert.equal(
    current.calls.length,
    activeCalls,
    'disconnected tasks cannot follow the active peer'
  )
  assert.deepEqual(Buffer.from(await (await globalThis.fetch(asset.url)).arrayBuffer()), bytes)

  // A current client can negotiate completion receipts independently of protocol 15.
  const receiptSession = {
    sessionId: 'receipt-session',
    fileKey: 'receipt-file',
    fileName: 'Receipt fixture',
    pageId: 'receipt-page',
    tabId: 42,
    documentId: 'receipt-document',
    busy: false
  }
  const receiptPeer = async () => {
    const extension = await peer(port)
    assert.equal(typeof extension.frames[0].terminalReceiptGeneration, 'string')
    send(extension, {
      type: 'runtimeHello',
      protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
      extensionVersion: '1.1.1',
      extensionRuntimeFingerprint: 'c'.repeat(64),
      terminalReceipts: true
    })
    send(extension, {
      type: 'sessions',
      browserId: 'receipt-browser',
      activeSessionId: receiptSession.sessionId,
      sessions: [receiptSession]
    })
    await activate(extension)
    return extension
  }
  const originalReceiptPeer = await receiptPeer()
  const lostWrite = call('apply_canvas', {
    mode: 'create',
    markup: '<div class="w-10 h-10"></div>'
  })
  await until(() => originalReceiptPeer.calls.length === 1, 'receipt write dispatch')
  const lostCall = originalReceiptPeer.calls[0]
  assert.ok(lostCall.terminalReceipt)
  originalReceiptPeer.socket.close()
  await once(originalReceiptPeer.socket, 'close')
  assert.match(JSON.stringify(await lostWrite), /EXTENSION_DISCONNECTED/)
  const reconnectedReceiptPeer = await receiptPeer()
  assert.equal(
    (await call('get_structure')).isError,
    true,
    'same-document idle must not release the write'
  )
  const completion = { type: 'toolCompletion', id: lostCall.id, ...lostCall.terminalReceipt }
  send(reconnectedReceiptPeer, completion)
  await until(
    () =>
      reconnectedReceiptPeer.frames.some(
        (frame) => frame.type === 'toolCompletionAck' && frame.id === lostCall.id && frame.accepted
      ),
    'same-Hub receipt acknowledgment'
  )
  reconnectedReceiptPeer.respond = () => structure
  assert.deepEqual((await call('get_structure')).structuredContent, structure)
  send(reconnectedReceiptPeer, completion)
  await until(
    () =>
      reconnectedReceiptPeer.frames.filter(
        (frame) => frame.type === 'toolCompletionAck' && frame.id === lostCall.id && frame.accepted
      ).length === 2,
    'duplicate receipt acknowledgment'
  )
  assert.deepEqual(failures, [])
  if (metricSamples.length) {
    process.stdout.write(`Bridge byte samples: ${JSON.stringify(metricSamples)}\n`)
  }
  process.stdout.write(
    'Bridge compatibility passed for extension 1.0.0 and current peers: reads, writes, assets, mixed routing, Stop, reconnect, and negotiated terminal receipts.\n'
  )
} catch (error) {
  throw new Error(`Bridge compatibility failed. Child diagnostics:\n${stderr.slice(-16_384)}`, {
    cause: error
  })
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
