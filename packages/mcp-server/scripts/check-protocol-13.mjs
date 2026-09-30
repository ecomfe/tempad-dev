import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'

import {
  MessageToExtensionSchema,
  GetCodeParametersSchema,
  GetScreenshotParametersSchema,
  GetStructureParametersSchema
} from './fixtures/extension-0.22.0.mjs'
import { DesignTaskSchema } from './fixtures/protocol-13-design-task.mjs'

// Run against the built Hub using the released receiving schemas, not current shared imports.
export async function checkProtocol13({ port, peer, send, activate, until, call, origin }) {
  const session = {
    sessionId: 'tab-13',
    fileKey: 'file-13',
    fileName: 'Released',
    pageId: 'page-13',
    busy: false
  }
  const connect = async () => {
    const extension = await peer(port, false, MessageToExtensionSchema)
    assert.ok(extension.frames[0].supportedProtocolVersions.includes(13))
    // Exactly the old hello: no new protocol field, and no package-version inference.
    send(extension, {
      type: 'runtimeHello',
      extensionVersion: '0.22.0',
      extensionRuntimeFingerprint: 'b'.repeat(64)
    })
    send(extension, {
      type: 'sessions',
      browserId: 'browser-13',
      activeSessionId: session.sessionId,
      sessions: [session]
    })
    await activate(extension)
    return extension
  }
  const released = await connect()
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
  const upload = await globalThis.fetch(asset.url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': asset.mimeType },
    body: bytes
  })
  assert.equal(upload.status, 201)
  const code = {
    code: '<div class="text-[var(--semantic)]" />',
    lang: 'jsx',
    assets: [asset],
    tokens: { '--semantic': { kind: 'color', value: '--palette' } },
    codegen: { plugin: 'default', config: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
  }
  const structure = {
    roots: [
      { id: '1:2', name: 'Released frame', type: 'FRAME', x: 0, y: 0, width: 100, height: 100 }
    ]
  }
  const screenshot = { format: 'png', width: 1, height: 1, scale: 1, bytes: bytes.length, asset }
  const pages = {
    scope: 'pages',
    pages: [{ id: 'page-13', name: 'Released page', index: 0, active: true }]
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
  const readSchemas = {
    get_code: GetCodeParametersSchema,
    get_screenshot: GetScreenshotParametersSchema,
    get_structure: GetStructureParametersSchema
  }
  const respond = (message) => {
    assert.equal(message.route.gatewayId, released.id)
    assert.equal(message.route.sessionId, session.sessionId)
    const { name, args } = message.payload
    if (readSchemas[name])
      assert.deepEqual(
        readSchemas[name].parse(args),
        args,
        'no unknown options may be stripped by the released schema'
      )
    if (name === '__begin_design') return DesignTaskSchema.parse(args)
    if (name === 'get_code') return code
    if (name === 'get_screenshot') return screenshot
    if (name === 'get_structure') return structure
    if (name === 'get_design_system') {
      assert.deepEqual(args, { scope: 'pages' })
      return pages
    }
    assert.equal(name, 'apply_canvas')
    assert.deepEqual(args, { mode: 'update', targetNodeId: '1:2', markup: '<frame key="root" />' })
    return written
  }
  released.respond = respond
  const result = await call('get_code', { nodeId: '1:2', resolveTokens: false })
  assert.equal(result.isError, undefined, JSON.stringify(result))
  assert.equal(result.structuredContent.code, code.code)
  assert.deepEqual(result.structuredContent.tokens, code.tokens)
  assert.match(
    JSON.stringify(result.content),
    /complete modes and alias dependencies are not guaranteed/
  )
  assert.deepEqual(await readFile(result.structuredContent.assets[0].localPath), bytes)
  const originalCode = code.code
  code.code = 'x'.repeat(
    65536 -
      Buffer.byteLength(JSON.stringify(result)) +
      Buffer.byteLength(JSON.stringify(originalCode)) -
      2 +
      20
  )
  const bounded = await call('get_code', { nodeId: '1:2' })
  assert.equal(bounded.isError, undefined, JSON.stringify(bounded))
  assert.equal(bounded.structuredContent.assets[0].localPath, undefined)
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 65536)
  assert.match(JSON.stringify(bounded.content), /Protocol 13 compatibility/)
  code.code = originalCode
  assert.deepEqual(Buffer.from(await (await globalThis.fetch(asset.url)).arrayBuffer()), bytes)
  assert.equal((await call('get_screenshot', { nodeId: '1:2' })).structuredContent.asset.hash, hash)
  assert.deepEqual(
    (await call('get_structure', { pageId: 'page-13', options: { depth: 1, native: true } }))
      .structuredContent,
    structure
  )
  assert.deepEqual((await call('get_design_system', { scope: 'pages' })).structuredContent, pages)
  assert.ok(
    (await call('list_design_sessions')).structuredContent.sessions.some(
      (value) => value.sessionId === session.sessionId
    )
  )

  const initialCalls = released.calls.length
  for (const [name, args] of [
    ['get_code', { nodeIds: ['1:2'] }],
    ['get_screenshot', { nodeIds: ['1:2'] }],
    ['get_structure', { nodeIds: ['1:2'] }],
    ['get_structure', { options: { depth: 0 } }],
    ['get_code', { nodeId: '1:2', resolveTokens: true }]
  ]) {
    const unsupported = await call(name, { ...args, sessionId: session.sessionId })
    assert.equal(unsupported.isError, true)
    assert.match(JSON.stringify(unsupported), /EXTENSION_UPGRADE_REQUIRED/)
  }
  assert.equal(released.calls.length, initialCalls)

  const begin = () =>
    call('manage_design_task', {
      action: 'begin',
      requestId: randomUUID(),
      title: 'Protocol 13 task',
      sessionId: session.sessionId
    })
  let task = (await begin()).structuredContent
  assert.ok(task?.taskId)
  assert.deepEqual(
    (await call('get_structure', { taskId: task.taskId, nodeId: '1:2' })).structuredContent,
    structure
  )
  const write = await call('apply_canvas', {
    taskId: task.taskId,
    taskEpoch: task.epoch,
    mode: 'update',
    targetNodeId: '1:2',
    markup: '<frame key="root" />'
  })
  assert.equal(write.isError, undefined, JSON.stringify(write))
  assert.equal(write.structuredContent.mutationCount, 1)
  assert.equal(write.structuredContent.runtime.extension.version, '0.22.0')
  assert.equal(released.calls.at(-1).route.taskId, task.taskId)

  const other = await peer(port, false)
  send(other, {
    type: 'runtimeHello',
    protocolVersion: 15,
    extensionVersion: '0.23.0',
    extensionRuntimeFingerprint: 'c'.repeat(64)
  })
  send(other, {
    type: 'sessions',
    browserId: 'browser-15',
    activeSessionId: 'tab-15',
    sessions: [{ ...session, sessionId: 'tab-15', fileKey: 'file-15' }]
  })
  await activate(other)
  const routedCount = released.calls.length
  assert.match(
    JSON.stringify(await call('get_code', { taskId: task.taskId, nodeIds: ['1:2'] })),
    /EXTENSION_UPGRADE_REQUIRED/
  )
  assert.equal(released.calls.length, routedCount)
  assert.equal(other.calls.length, 0, 'task-bound reads must never switch to a newer active peer')
  assert.equal(
    (await call('get_code', { sessionId: session.sessionId, nodeId: '1:2' })).structuredContent
      .code,
    code.code
  )
  const completed = await call('manage_design_task', {
    action: 'complete',
    taskId: task.taskId,
    epoch: task.epoch
  })
  assert.equal(completed.structuredContent.status, 'completed')
  task = (
    await call('manage_design_task', { action: 'resume', taskId: task.taskId, epoch: task.epoch })
  ).structuredContent
  assert.equal(task.status, 'active')
  assert.equal(task.epoch, 1)
  assert.equal(
    (await call('manage_design_task', { action: 'cancel', taskId: task.taskId, epoch: task.epoch }))
      .structuredContent.status,
    'cancelled'
  )
  assert.equal(
    (await call('manage_design_task', { action: 'resume', taskId: task.taskId, epoch: task.epoch }))
      .isError,
    true
  )
  await activate(released)
  task = (await begin()).structuredContent
  const stopId = randomUUID()
  send(released, {
    type: 'designAction',
    sessionId: session.sessionId,
    action: { requestId: stopId, taskId: task.taskId, epoch: task.epoch, action: 'stop' }
  })
  await until(
    () =>
      released.frames.some(
        (frame) => frame.type === 'designActionResult' && frame.result.requestId === stopId
      ),
    'protocol 13 Stop response'
  )
  await until(
    async () =>
      (await call('get_design_task', { taskId: task.taskId })).structuredContent.status ===
      'cancelled',
    'protocol 13 Stop fence'
  )
  assert.equal(
    (await call('manage_design_task', { action: 'resume', taskId: task.taskId, epoch: task.epoch }))
      .isError,
    true
  )
  task = (await begin()).structuredContent
  released.respond = null
  const count = released.calls.length
  const pending = call('get_structure', { taskId: task.taskId, nodeId: '1:2' })
  await until(() => released.calls.length > count, 'protocol 13 pending read')
  released.socket.close()
  assert.match(JSON.stringify(await pending), /EXTENSION_DISCONNECTED/)
  const replacement = await connect()
  replacement.respond = () => structure
  assert.notEqual(replacement.id, released.id)
  assert.deepEqual((await call('get_structure', { nodeId: '1:2' })).structuredContent, structure)
  const replacementCalls = replacement.calls.length
  const fenced = await call('get_structure', { taskId: task.taskId, nodeId: '1:2' })
  assert.equal(fenced.isError, true, 'old task lease must not migrate to a reconnected peer')
  assert.equal(replacement.calls.length, replacementCalls)
  assert.deepEqual(Buffer.from(await (await globalThis.fetch(asset.url)).arrayBuffer()), bytes)
  for (const extension of [other, replacement]) {
    extension.socket.close()
    await once(extension.socket, 'close')
  }
}
