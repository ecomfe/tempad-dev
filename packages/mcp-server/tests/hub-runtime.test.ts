import {
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
  type DesignTask,
  type ToolCallMessage
} from '@tempad-dev/shared'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { connect, createServer, type Server, type Socket } from 'node:net'
import lockfile from 'proper-lockfile'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

const fixture = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { basename, join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'tempad-hub-test-'))
  return {
    directory,
    socketPath:
      process.platform === 'win32'
        ? `\\\\.\\pipe\\${basename(directory)}`
        : join(directory, 'mcp.sock')
  }
})

// Keep real locks, private filesystem state and consumer sockets; substitute only
// public listeners so this test cannot reach an installed Hub or Codex session.
vi.mock('node:net', async (load) => {
  const actual = await load<typeof import('node:net')>()
  return { ...actual, createServer: vi.fn(actual.createServer) }
})
vi.mock('../src/shared', async () => {
  const fs = await import('node:fs')
  return {
    ASSET_DIR: `${fixture.directory}/assets`,
    RUNTIME_DIR: fixture.directory,
    SOCK_PATH: fixture.socketPath,
    HUB_LOCK_PATH: `${fixture.directory}/hub.lock`,
    HUB_LOCK_STALE_MS: 10000,
    HUB_LOCK_UPDATE_MS: 5000,
    HUB_BUSY_EXIT_CODE: 17,
    HUB_RUNTIME_IDENTITY_PATH: `${fixture.directory}/hub-runtime.json`,
    PACKAGE_VERSION: '1.0.0',
    resolveStateDir: vi.fn(() => `${fixture.directory}/state`),
    ensureDir: (path: string) => fs.mkdirSync(path, { recursive: true }),
    assertTrustedSocket: vi.fn(),
    ensureFile: (path: string) => fs.closeSync(fs.openSync(path, 'a')),
    getRecordProperty: (value: unknown, key: string) =>
      value && typeof value === 'object' ? Reflect.get(value, key) : undefined,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  }
})
vi.mock('../src/asset-http-server', () => ({ createAssetHttpServer: vi.fn() }))
vi.mock('../src/websocket-server', () => ({ startExtensionWebSocketServer: vi.fn() }))
vi.mock('../src/runtime-identity', async (load) => {
  const actual = await load<typeof import('../src/runtime-identity')>()
  return {
    ...actual,
    writeHubRuntimeIdentity: vi.fn(actual.writeHubRuntimeIdentity),
    removeHubRuntimeIdentityIfOwned: vi.fn(actual.removeHubRuntimeIdentityIfOwned)
  }
})
vi.mock('../src/asset-store', async (load) => {
  const actual = await load<typeof import('../src/asset-store')>()
  return { ...actual, createAssetStore: vi.fn(actual.createAssetStore) }
})

import { CodexAppFeedback } from '../src/agent-clients/codex-feedback'
import { AgentClients } from '../src/agent-clients/registry'
import { createAssetHttpServer } from '../src/asset-http-server'
import { createAssetStore } from '../src/asset-store'
import { DesignTasks } from '../src/design-tasks'
import { removeHubRuntimeIdentityIfOwned, writeHubRuntimeIdentity } from '../src/runtime-identity'
import { log, resolveStateDir } from '../src/shared'
import { startExtensionWebSocketServer } from '../src/websocket-server'

let netServer: Server | undefined
let previousSignals: Map<'SIGINT' | 'SIGTERM', NodeJS.SignalsListener[]>
let previousBeforeExit: NodeJS.BeforeExitListener[]
const assetStart = vi.fn<() => Promise<void>>()
const assetStop = vi.fn()
let websocket: WebSocketServer
const consumerSockets: Socket[] = []

async function connectConsumer(clientEventFirst = false, clientName = 'isolated-test') {
  const socket = connect(fixture.socketPath)
  consumerSockets.push(socket)
  await once(socket, 'connect')
  const replies = new Map<
    number,
    {
      result?: { isError?: boolean; content?: unknown[]; tools?: { name: string }[] }
      error?: unknown
    }
  >()
  let buffer = ''
  const bindingUpdates: unknown[] = []
  socket.on('data', (chunk) => {
    buffer += String(chunk)
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      if (typeof message.id === 'number') replies.set(message.id, message)
      if (message.method === 'notifications/tempad/client-binding')
        bindingUpdates.push(message.params)
    }
  })
  const send = (message: object) =>
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const reply = async (id: number) => {
    await vi.waitFor(() => expect(replies.has(id)).toBe(true), { interval: 1 })
    return replies.get(id)!
  }
  if (clientEventFirst)
    send({
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'other' }
    })
  send({
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: '1' }
    }
  })
  await reply(0)
  send({ method: 'notifications/initialized' })
  return { socket, send, reply, replies, bindingUpdates }
}

function connectExtension() {
  const calls: ToolCallMessage[] = []
  const peer = Object.assign(new EventEmitter(), {
    protocol: TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
    send: vi.fn((data: string) => {
      const message = JSON.parse(data)
      if (message.type === 'toolCall') calls.push(message)
    }),
    close: vi.fn()
  })
  const send = (message: object) =>
    peer.emit('message', Buffer.from(JSON.stringify(message)), false)
  websocket.emit('connection', peer, { headers: { origin: 'chrome-extension://isolated-test' } })
  send({
    type: 'runtimeHello',
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
    extensionVersion: '0.23.4',
    extensionRuntimeFingerprint: 'a'.repeat(64)
  })
  const publishSession = (sessionId = 'session', documentId = 'document') =>
    send({
      type: 'sessions',
      browserId: 'browser',
      activeSessionId: sessionId,
      sessions: [
        {
          sessionId,
          documentId,
          tabId: 1,
          fileKey: 'file',
          fileName: 'Fixture',
          pageId: 'page',
          busy: false
        },
        {
          sessionId: 'other-session',
          fileKey: 'other-file',
          fileName: 'Other fixture',
          pageId: 'other-page',
          busy: false
        }
      ]
    })
  publishSession()
  send({ type: 'activate' })
  const call = async (index: number) => {
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(index), { interval: 1 })
    return calls[index]!
  }
  return { calls, call, send, publishSession }
}

async function loadRuntime() {
  const runtime = await import('../src/hub-runtime')
  // Dependencies may install their own exit handlers during import. Only the
  // handlers registered by startHub belong to this test's shutdown lifecycle.
  previousSignals = new Map(
    (['SIGINT', 'SIGTERM'] as const).map((signal) => [signal, process.listeners(signal)])
  )
  previousBeforeExit = process.listeners('beforeExit')
  return runtime
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveStateDir).mockReturnValue(`${fixture.directory}/state`)
  vi.useFakeTimers()
  vi.stubEnv('TEMPAD_MCP_ASSET_TTL_MS', '0')
  previousSignals = new Map(
    (['SIGINT', 'SIGTERM'] as const).map((signal) => [signal, process.listeners(signal)])
  )
  previousBeforeExit = process.listeners('beforeExit')
  mkdirSync(`${fixture.directory}/assets`, { recursive: true })
  rmSync(`${fixture.directory}/state`, { recursive: true, force: true })
  writeFileSync(`${fixture.directory}/hub.lock`, '')
  assetStart.mockResolvedValue()
  vi.mocked(createAssetHttpServer).mockReturnValue({
    start: assetStart,
    stop: assetStop,
    getBaseUrl: () => 'http://127.0.0.1:0'
  } as ReturnType<typeof createAssetHttpServer>)
  websocket = new WebSocketServer({ noServer: true })
  vi.spyOn(websocket, 'close')
  vi.mocked(startExtensionWebSocketServer).mockResolvedValue({
    server: websocket,
    port: 6220
  })
})

afterEach(async () => {
  for (const socket of consumerSockets.splice(0)) socket.destroy()
  // Also stop a successfully started Hub when an assertion fails before the test's
  // explicit shutdown, so lock ownership and listeners cannot leak into the next test.
  const shutdown = process
    .listeners('SIGTERM')
    .find((listener) => !previousSignals.get('SIGTERM')!.includes(listener))
  if (shutdown) {
    shutdown('SIGTERM')
    await vi.waitFor(() => expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(false))
  }
  for (const listener of process.listeners('beforeExit')) {
    if (!previousBeforeExit.includes(listener)) process.removeListener('beforeExit', listener)
  }
  // The in-process fixture does not exit; release locks normally owned until
  // process exit only after its clients and shutdown callbacks are stopped.
  for (const directory of ['assets', 'state'])
    await lockfile
      .unlock(`${fixture.directory}/${directory}`, {
        lockfilePath: `${fixture.directory}/${directory}/.tempad-hub-writer.lock`
      })
      .catch(() => {})
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!previousSignals.get(signal)?.includes(listener)) process.removeListener(signal, listener)
    }
  }
  netServer ??= vi.mocked(createServer).mock.results.find((result) => result.type === 'return')
    ?.value as Server | undefined
  if (netServer?.listening) await new Promise<void>((resolve) => netServer!.close(() => resolve()))
  netServer = undefined
  if (!vi.mocked(websocket.close).mock.calls.length) websocket.close()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

afterAll(() => rmSync(fixture.directory, { recursive: true, force: true }))

describe('Hub runtime module', () => {
  it('deduplicates a shared state and asset directory', async () => {
    vi.mocked(resolveStateDir).mockReturnValue(`${fixture.directory}/assets`)
    const { startHub } = await loadRuntime()
    await startHub()
    expect(createAssetStore).toHaveBeenCalledOnce()
    expect(existsSync(`${fixture.directory}/assets/.tempad-hub-writer.lock`)).toBe(true)
  })

  it.each(['assets', 'state'])(
    'rejects an existing %s writer before touching stores and releases partial locks',
    async (directory) => {
      const path = `${fixture.directory}/${directory}`
      mkdirSync(path, { recursive: true, mode: 0o755 })
      const release = await lockfile.lock(path, { lockfilePath: `${path}/.tempad-hub-writer.lock` })
      const restore = vi.spyOn(DesignTasks.prototype, 'restore')
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('test exit')
      })
      try {
        const { startHub } = await loadRuntime()
        await expect(startHub()).rejects.toThrow('test exit')
        expect(exit).toHaveBeenCalledWith(1)
        expect(createAssetStore).not.toHaveBeenCalled()
        expect(restore).not.toHaveBeenCalled()
        expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(false)
        if (directory === 'state')
          expect(existsSync(`${fixture.directory}/assets/.tempad-hub-writer.lock`)).toBe(false)
      } finally {
        await release()
      }
    }
  )

  it('advertises only the supported tools and rejects retired asset/token tool calls', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const consumer = await connectConsumer()
    consumer.send({ id: 1, method: 'tools/list' })
    expect((await consumer.reply(1)).result?.tools?.map(({ name }) => name)).toEqual([
      'get_design_task',
      'list_design_sessions',
      'manage_design_task',
      'set_design_anchor',
      'get_code',
      'get_design_system',
      'apply_canvas',
      'get_screenshot',
      'get_structure',
      'upload_asset'
    ])
    for (const [index, name] of ['get_assets', 'get_token_defs'].entries()) {
      const id = index + 2
      consumer.send({ id, method: 'tools/call', params: { name, arguments: {} } })
      expect(await consumer.reply(id)).toMatchObject({ result: { isError: true } })
    }
  })

  it('handles a standalone lifecycle hook without registering tools or shutting down the Hub', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const socket = connect(fixture.socketPath)
    consumerSockets.push(socket)
    await once(socket, 'connect')
    const response = once(socket, 'data')
    socket.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempad/client-hook',
        params: {
          version: 1,
          kind: 'claude',
          sessionId: 'fixture-session',
          event: 'PreToolUse',
          invocationId: 'd50ec516-a8d9-4ddc-abd9-b24d5857fcfe'
        }
      }) + '\n'
    )
    expect(JSON.parse(String((await response)[0]))).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    socket.destroy()
    await once(socket, 'close')
    expect(log.debug).not.toHaveBeenCalledWith(expect.anything(), 'Registered tools.')
    expect(log.info).not.toHaveBeenCalledWith('Consumer connected. Total: 1')
    expect(assetStop).not.toHaveBeenCalled()
    const consumer = await connectConsumer(true)
    consumer.send({
      id: 1,
      method: 'tools/call',
      params: { name: 'list_design_sessions', arguments: {} }
    })
    expect((await consumer.reply(1)).result?.isError).not.toBe(true)
    expect(log.info).toHaveBeenCalledWith('Consumer connected. Total: 1')
  })

  it.each(['idle', 'malformed', 'oversized'] as const)(
    'closes a %s first frame without creating a consumer',
    async (kind) => {
      const { startHub } = await loadRuntime()
      await startHub()
      const socket = connect(fixture.socketPath)
      consumerSockets.push(socket)
      await once(socket, 'connect')
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
      socket.on('error', () => {})
      if (kind === 'malformed') socket.write('not-json\n')
      else if (kind === 'oversized') socket.write(Buffer.alloc(10 * 1024 * 1024 + 1, 32))
      else await vi.advanceTimersByTimeAsync(5000)
      await closed
      expect(log.debug).not.toHaveBeenCalledWith(expect.anything(), 'Registered tools.')
      expect(assetStop).not.toHaveBeenCalled()
    }
  )

  it('rejects invalid hook parameters before lifecycle effects and does not allow hook transport promotion', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const hook = vi.spyOn(AgentClients.prototype, 'clientHook')
    const socket = connect(fixture.socketPath)
    consumerSockets.push(socket)
    await once(socket, 'connect')
    const response = once(socket, 'data')
    socket.write(
      [
        { jsonrpc: '2.0', id: 0, method: 'tempad/client-hook', params: {} },
        { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      ]
        .map((message) => JSON.stringify(message))
        .join('\n') + '\n'
    )
    expect(JSON.parse(String((await response)[0]))).toEqual({
      jsonrpc: '2.0',
      id: 0,
      error: { code: -32602, message: 'Invalid lifecycle hook parameters.' }
    })
    await once(socket, 'close')
    expect(hook).not.toHaveBeenCalled()
    expect(log.debug).not.toHaveBeenCalledWith(expect.anything(), 'Registered tools.')
    expect(assetStop).not.toHaveBeenCalled()
  })

  it('keeps extension registration, hello and state broadcasts working after diagnostic identity IO failures', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const failure = Object.assign(new Error('Identity write failed'), { code: 'EIO' })
    vi.mocked(writeHubRuntimeIdentity).mockImplementation(() => {
      throw failure
    })
    try {
      const extension = connectExtension()
      const consumer = await connectConsumer()
      consumer.send({
        id: 1,
        method: 'tools/call',
        params: { name: 'get_structure', arguments: {} }
      })
      const call = await extension.call(0)
      extension.send({ type: 'toolResult', id: call.id, payload: { roots: [] } })
      expect(await consumer.reply(1)).toMatchObject({
        result: { structuredContent: { roots: [] } }
      })
      expect(log.warn).toHaveBeenCalledWith(
        { error: failure },
        'Could not update Hub runtime identity.'
      )
    } finally {
      const actual =
        await vi.importActual<typeof import('../src/runtime-identity')>('../src/runtime-identity')
      vi.mocked(writeHubRuntimeIdentity).mockImplementation(actual.writeHubRuntimeIdentity)
    }
  })

  it('continues shutdown through failed asset flush and identity cleanup', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    netServer = vi.mocked(createServer).mock.results[0]!.value as Server
    const failure = Object.assign(new Error('Storage IO failed'), { code: 'EIO' })
    const store = vi.mocked(createAssetStore).mock.results[0]!.value as ReturnType<
      typeof createAssetStore
    >
    vi.spyOn(store, 'flush').mockImplementation(() => {
      throw failure
    })
    vi.mocked(removeHubRuntimeIdentityIfOwned).mockImplementationOnce(() => {
      throw failure
    })
    const shutdown = process
      .listeners('SIGTERM')
      .find((listener) => !previousSignals.get('SIGTERM')!.includes(listener))!
    try {
      expect(() => shutdown('SIGTERM')).not.toThrow()
      await vi.waitFor(() => expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(false))
      expect(netServer.listening).toBe(false)
      expect(assetStop).toHaveBeenCalledOnce()
      expect(websocket.close).toHaveBeenCalledOnce()
      expect(log.warn).toHaveBeenCalledWith(
        { error: failure },
        'Could not flush assets during shutdown.'
      )
      expect(log.warn).toHaveBeenCalledWith(
        { error: failure },
        'Could not remove Hub runtime identity.'
      )
    } finally {
      // Also clean the isolated lock when exercising the old, throwing shutdown.
      rmSync(`${fixture.directory}/hub.lock.lock`, { recursive: true, force: true })
      vi.mocked(removeHubRuntimeIdentityIfOwned)
        .mockReset()
        .mockImplementation(
          (
            await vi.importActual<typeof import('../src/runtime-identity')>(
              '../src/runtime-identity'
            )
          ).removeHubRuntimeIdentityIfOwned
        )
    }
  })

  it('still fails closed and releases ownership when initial identity publication fails', async () => {
    const failure = Object.assign(new Error('Initial identity denied'), { code: 'EACCES' })
    vi.mocked(writeHubRuntimeIdentity).mockImplementationOnce(() => {
      throw failure
    })
    vi.mocked(removeHubRuntimeIdentityIfOwned).mockImplementationOnce(() => {
      throw failure
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('test exit')
    })
    const { startHub } = await loadRuntime()
    await expect(startHub()).rejects.toThrow('test exit')
    expect(exit).toHaveBeenCalledWith(1)
    expect(assetStart).not.toHaveBeenCalled()
    expect(startExtensionWebSocketServer).not.toHaveBeenCalled()
    expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(false)
  })

  it.each([false, true])(
    'pushes Claude binding and clear only to an opted-in CLI (subscribe=%s)',
    async (subscribe) => {
      const { startHub } = await loadRuntime()
      await startHub()
      const extension = connectExtension()
      const consumer = await connectConsumer(true, 'claude-code')
      if (subscribe) consumer.send({ method: 'notifications/tempad/subscribe-client-binding' })
      consumer.send({
        id: 1,
        method: 'tools/call',
        params: {
          name: 'manage_design_task',
          arguments: {
            action: 'begin',
            title: 'Reconnect fixture',
            requestId: '00000000-0000-4000-8000-000000000008'
          }
        }
      })
      const bind = await extension.call(0)
      const task = bind.payload.args as DesignTask
      extension.send({ type: 'toolResult', id: bind.id, payload: task })
      expect((await consumer.reply(1)).result?.isError).not.toBe(true)
      consumer.send({
        id: 2,
        method: 'tempad/client-hook',
        params: {
          version: 1,
          kind: 'claude',
          event: 'PostToolUse',
          sessionId: 'claude-session',
          taskId: task.taskId,
          invocationId: '00000000-0000-4000-8000-000000000009'
        }
      })
      await consumer.reply(2)
      expect(consumer.bindingUpdates).toEqual(
        subscribe ? [{ kind: 'claude', sessionId: 'claude-session' }] : []
      )
      consumer.send({
        id: 3,
        method: 'tempad/client-hook',
        params: {
          version: 1,
          kind: 'claude',
          event: 'SessionEnd',
          sessionId: 'claude-session',
          invocationId: '00000000-0000-4000-8000-000000000010'
        }
      })
      await consumer.reply(3)
      expect(consumer.bindingUpdates).toEqual(
        subscribe ? [{ kind: 'claude', sessionId: 'claude-session' }, { kind: 'claude' }] : []
      )
    }
  )

  it('distinguishes begin content conflicts without changing the original task or its Stop fence', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    const args = {
      action: 'begin',
      title: 'Original task',
      requestId: '00000000-0000-4000-8000-000000000011'
    }
    const send = (id: number, arguments_: object) =>
      consumer.send({
        id,
        method: 'tools/call',
        params: { name: 'manage_design_task', arguments: arguments_ }
      })
    send(1, args)
    const binding = await extension.call(0)
    const task = binding.payload.args as DesignTask
    extension.send({ type: 'toolResult', id: binding.id, payload: task })
    const original = (await consumer.reply(1)).result
    for (const [index, change] of [
      { title: 'Different title' },
      { sessionId: 'another-session' }
    ].entries()) {
      const id = index + 2
      send(id, { ...args, ...change })
      expect(await consumer.reply(id)).toMatchObject({
        result: {
          isError: true,
          content: [{ text: expect.stringContaining('[REQUEST_ID_CONFLICT]') }]
        }
      })
    }
    send(4, { ...args, sessionId: task.target.sessionId })
    expect((await consumer.reply(4)).result).toEqual(original)
    expect(extension.calls).toHaveLength(1)
    send(5, { action: 'cancel', taskId: task.taskId, epoch: task.epoch ?? 0 })
    const cancelled = (await consumer.reply(5)).result
    expect(cancelled).toMatchObject({ structuredContent: { status: 'cancelled' } })
    send(6, args)
    expect((await consumer.reply(6)).result).toEqual(cancelled)
    send(7, { action: 'resume', taskId: task.taskId, epoch: task.epoch ?? 0 })
    expect(await consumer.reply(7)).toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining('[DESIGN_TASK_INACTIVE]') }]
      }
    })
    expect(extension.calls).toHaveLength(1)
  })

  it('captures a new completion after resume, required reread and a zero-mutation write', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    const send = (id: number, name: string, args: object) =>
      consumer.send({ id, method: 'tools/call', params: { name, arguments: args } })
    send(1, 'manage_design_task', {
      action: 'begin',
      title: 'Repeated review',
      requestId: '00000000-0000-4000-8000-000000000004'
    })
    const binding = await extension.call(0)
    const task = binding.payload.args as DesignTask
    extension.send({ type: 'toolResult', id: binding.id, payload: task })
    expect((await consumer.reply(1)).result?.isError).not.toBe(true)
    send(2, 'manage_design_task', {
      action: 'complete',
      taskId: task.taskId,
      epoch: 0,
      summary: 'First summary'
    })
    const first = ((await consumer.reply(2)).result as { structuredContent: DesignTask })
      .structuredContent
    expect(first.result?.summary).toBe('First summary')
    send(3, 'manage_design_task', { action: 'resume', taskId: task.taskId, epoch: 0 })
    const resumed = await extension.call(1)
    extension.send({ type: 'toolResult', id: resumed.id, payload: resumed.payload.args })
    expect(await consumer.reply(3)).toMatchObject({
      result: { structuredContent: { epoch: 1, needsRead: true } }
    })
    const write = {
      mode: 'update',
      targetNodeId: 'root-a',
      markup: '<div class="w-10 h-10"></div>',
      taskId: task.taskId,
      taskEpoch: 1
    }
    send(4, 'apply_canvas', write)
    const blocked = await consumer.reply(4)
    expect(blocked.result?.isError).toBe(true)
    expect(JSON.stringify(blocked)).toContain('Read the bound canvas')
    expect(extension.calls).toHaveLength(2)
    send(5, 'get_structure', { taskId: task.taskId, taskEpoch: 1 })
    const read = await extension.call(2)
    extension.send({ type: 'toolResult', id: read.id, payload: { roots: [] } })
    expect((await consumer.reply(5)).result?.isError).not.toBe(true)
    send(6, 'apply_canvas', write)
    const update = await extension.call(3)
    extension.send({
      type: 'toolResult',
      id: update.id,
      payload: {
        rootNodeId: 'root-a',
        nodeIdsByKey: {},
        createdNodeIds: [],
        updatedNodeIds: [],
        removedNodeIds: [],
        mutationCount: 0,
        verification: { status: 'passed', nodesChecked: 1, referencesChecked: 0, warnings: [] }
      }
    })
    expect((await consumer.reply(6)).result?.isError).not.toBe(true)
    vi.setSystemTime(first.result!.capturedAt + 1000)
    send(7, 'manage_design_task', {
      action: 'complete',
      taskId: task.taskId,
      epoch: 1,
      summary: 'Corrected summary'
    })
    const final = ((await consumer.reply(7)).result as { structuredContent: DesignTask })
      .structuredContent
    expect(final.result).toEqual({
      nodeIds: ['root-a'],
      summary: 'Corrected summary',
      capturedAt: expect.any(Number)
    })
    expect(final.result!.capturedAt).toBeGreaterThan(first.result!.capturedAt)
    send(8, 'manage_design_task', {
      action: 'complete',
      taskId: task.taskId,
      epoch: 1,
      summary: 'Retry summary'
    })
    expect(await consumer.reply(8)).toMatchObject({
      result: { structuredContent: { result: final.result } }
    })
  })

  it.each([1, 0, ''])(
    'does not dispatch an upload cancelled before its local handler starts (ID %j)',
    async (requestId) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const { startHub } = await loadRuntime()
      await startHub()
      const consumer = await connectConsumer()
      consumer.socket.write(
        [
          {
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/call',
            params: {
              name: 'upload_asset',
              arguments: { dataUrl: 'data:image/png;base64,aGVsbG8=' }
            }
          },
          { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } }
        ]
          .map((message) => JSON.stringify(message))
          .join('\n') + '\n'
      )
      consumer.send({
        id: 2,
        method: 'tools/call',
        params: { name: 'list_design_sessions', arguments: {} }
      })
      await consumer.reply(2)
      expect(fetch).not.toHaveBeenCalled()
      expect(consumer.replies.has(1)).toBe(false)
    }
  )

  it.each(['notification', 'disconnect'] as const)(
    'aborts local upload response reads on consumer %s and closes unused success bodies',
    async (cancellation) => {
      let requests = 0
      const closed = vi.fn()
      const http = createHttpServer((request, response) => {
        request.resume()
        requests++
        response.once('close', closed)
        response.writeHead(requests === 1 ? 500 : 200)
        response.write('unfinished response')
      })
      try {
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
        const address = http.address()
        if (!address || typeof address === 'string') throw new Error('Expected isolated HTTP port')
        vi.mocked(createAssetHttpServer).mockReturnValue({
          start: assetStart,
          stop: assetStop,
          getBaseUrl: () => `http://127.0.0.1:${address.port}`
        } as ReturnType<typeof createAssetHttpServer>)
        const { startHub } = await loadRuntime()
        await startHub()
        let consumer = await connectConsumer()
        const survivor = cancellation === 'disconnect' ? await connectConsumer() : consumer
        const params = {
          name: 'upload_asset',
          arguments: { dataUrl: 'data:image/png;base64,aGVsbG8=' }
        }
        consumer.send({ id: 1, method: 'tools/call', params })
        await vi.waitFor(() => expect(requests).toBe(1), { interval: 1 })
        if (cancellation === 'notification')
          consumer.send({ method: 'notifications/cancelled', params: { requestId: 1 } })
        else consumer.socket.destroy()
        await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1), { interval: 1 })
        expect(consumer.replies.has(1)).toBe(false)
        if (cancellation === 'disconnect') consumer = survivor
        consumer.send({ id: 2, method: 'tools/call', params })
        expect((await consumer.reply(2)).result?.isError).not.toBe(true)
        await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(2), { interval: 1 })
      } finally {
        http.closeAllConnections()
        await new Promise<void>((resolve) => http.close(() => resolve()))
      }
    }
  )

  it.each(['begin', 'resume'] as const)(
    'does not mutate task state when %s is cancelled during client discovery',
    async (action) => {
      const { startHub } = await loadRuntime()
      await startHub()
      const extension = connectExtension()
      const consumer = await connectConsumer()
      const beginArgs = {
        action: 'begin',
        title: 'Cancellation fixture',
        requestId: '00000000-0000-4000-8000-000000000001'
      }
      let args: object = beginArgs
      if (action === 'resume') {
        consumer.send({
          id: 10,
          method: 'tools/call',
          params: { name: 'manage_design_task', arguments: beginArgs }
        })
        const binding = await extension.call(0)
        const task = binding.payload.args as DesignTask
        extension.send({ type: 'toolResult', id: binding.id, payload: task })
        await consumer.reply(10)
        args = { action: 'resume', taskId: task.taskId, epoch: task.epoch ?? 0 }
      }
      const gate = Promise.withResolvers<void>()
      const describe = AgentClients.prototype.describe
      const discovery = vi
        .spyOn(AgentClients.prototype, 'describe')
        .mockImplementationOnce(async function (this: AgentClients, ownerId) {
          const result = await describe.call(this, ownerId)
          await gate.promise
          return result
        })
      const begin = vi.spyOn(DesignTasks.prototype, 'begin')
      const resume = vi.spyOn(DesignTasks.prototype, 'resume')
      consumer.send({
        id: 1,
        method: 'tools/call',
        params: { name: 'manage_design_task', arguments: args }
      })
      await vi.waitFor(() => expect(discovery).toHaveBeenCalled(), { interval: 1 })
      consumer.send({ method: 'notifications/cancelled', params: { requestId: 1 } })
      await vi.waitFor(
        () =>
          expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ tool: 'manage_design_task' }),
            'Local tool invocation failed.'
          ),
        { interval: 1 }
      )
      gate.resolve()
      consumer.send({
        id: 2,
        method: 'tools/call',
        params: { name: 'list_design_sessions', arguments: {} }
      })
      await consumer.reply(2)
      expect(begin).not.toHaveBeenCalled()
      expect(resume).not.toHaveBeenCalled()
      expect(extension.calls).toHaveLength(action === 'begin' ? 0 : 1)
    }
  )

  it('finishes an already-dispatched task binding after cancellation and reuses its requestId', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    const params = {
      name: 'manage_design_task',
      arguments: {
        action: 'begin',
        title: 'Binding fixture',
        requestId: '00000000-0000-4000-8000-000000000002'
      }
    }
    consumer.send({ id: 1, method: 'tools/call', params })
    const binding = await extension.call(0)
    expect(binding.payload.name).toBe('__begin_design')
    consumer.send({ method: 'notifications/cancelled', params: { requestId: 1 } })
    await vi.waitFor(
      () =>
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ tool: 'manage_design_task' }),
          'Local tool invocation failed.'
        ),
      { interval: 1 }
    )
    extension.send({ type: 'toolResult', id: binding.id, payload: binding.payload.args })
    consumer.send({ id: 2, method: 'tools/call', params })
    const result = await consumer.reply(2)
    expect(result.result?.isError).not.toBe(true)
    expect(JSON.stringify(result)).toContain((binding.payload.args as DesignTask).taskId)
    expect(extension.calls).toHaveLength(1)
    expect(consumer.replies.has(1)).toBe(false)
  })

  it('observes a late binding rejection after consumer cancellation and records its actual interrupted state', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    const stop = vi.spyOn(DesignTasks.prototype, 'stop')
    consumer.send({
      id: 1,
      method: 'tools/call',
      params: {
        name: 'manage_design_task',
        arguments: {
          action: 'begin',
          title: 'Failed binding',
          requestId: '00000000-0000-4000-8000-000000000003'
        }
      }
    })
    const binding = await extension.call(0)
    const taskId = (binding.payload.args as DesignTask).taskId
    consumer.send({ method: 'notifications/cancelled', params: { requestId: 1 } })
    await vi.waitFor(
      () =>
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ tool: 'manage_design_task' }),
          'Local tool invocation failed.'
        ),
      { interval: 1 }
    )
    expect(stop).not.toHaveBeenCalled()
    extension.send({
      type: 'toolResult',
      id: binding.id,
      error: { message: 'Page refused binding' }
    })
    await vi.waitFor(() => expect(stop).toHaveBeenCalledWith(taskId, 'interrupted'), {
      interval: 1
    })
    consumer.send({
      id: 2,
      method: 'tools/call',
      params: { name: 'get_design_task', arguments: { taskId } }
    })
    expect(JSON.stringify(await consumer.reply(2))).toContain('interrupted')
  })

  it('can be imported without opening listeners or starting lifecycle timers', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    try {
      const runtime = await loadRuntime()
      expect(typeof runtime.startHub).toBe('function')
      expect(createServer).not.toHaveBeenCalled()
      expect(interval).not.toHaveBeenCalled()
    } finally {
      interval.mockRestore()
    }
  })

  it('starts in isolation and releases its identity, listeners and lock once on shutdown', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    netServer = vi.mocked(createServer).mock.results[0]!.value as Server
    expect(netServer.listening).toBe(true)
    expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(true)
    expect(existsSync(`${fixture.directory}/hub-runtime.json`)).toBe(true)
    const shutdown = process
      .listeners('SIGTERM')
      .find((listener) => !previousSignals.get('SIGTERM')!.includes(listener))!
    shutdown('SIGTERM')
    shutdown('SIGTERM')
    await vi.waitFor(() => expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(false))
    expect(netServer.listening).toBe(false)
    expect(existsSync(`${fixture.directory}/hub-runtime.json`)).toBe(false)
    expect(assetStop).toHaveBeenCalledTimes(1)
    expect(websocket.close).toHaveBeenCalledTimes(1)
  })

  it('flushes each beforeExit while retaining store ownership and tolerates flush failure', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const store = vi.mocked(createAssetStore).mock.results[0]!.value as ReturnType<
      typeof createAssetStore
    >
    const flush = vi.spyOn(store, 'flush')
    const shutdown = process
      .listeners('SIGTERM')
      .find((listener) => !previousSignals.get('SIGTERM')!.includes(listener))!
    shutdown('SIGTERM')
    shutdown('SIGTERM')
    const listeners = process
      .listeners('beforeExit')
      .filter((listener) => !previousBeforeExit.includes(listener))
    expect(listeners).toHaveLength(1)
    const listener = listeners[0]!
    const invoke = process
      .rawListeners('beforeExit')
      .find((callback) => callback === listener || Reflect.get(callback, 'listener') === listener)!
    const failure = new Error('Final flush failed')
    flush.mockImplementationOnce(() => {
      throw failure
    })
    expect(() => invoke(0)).not.toThrow()
    expect(log.warn).toHaveBeenCalledWith(
      { error: failure },
      'Could not flush assets during shutdown.'
    )
    store.upsert({ hash: 'late', filePath: '/fixture/late.png', mimeType: 'image/png', size: 1 })
    invoke(0)
    expect(flush).toHaveBeenCalledTimes(3)
    expect(process.listeners('beforeExit')).toContain(listener)
    expect(existsSync(`${fixture.directory}/assets/.tempad-hub-writer.lock`)).toBe(true)
  })

  it('releases startup ownership when the asset listener fails before accepting consumers', async () => {
    assetStart.mockRejectedValueOnce(new Error('Asset listener unavailable'))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('test exit')
    })
    const { startHub } = await loadRuntime()
    await expect(startHub()).rejects.toThrow('test exit')
    expect(exit).toHaveBeenCalledWith(1)
    expect(assetStop).toHaveBeenCalledTimes(1)
    expect(startExtensionWebSocketServer).not.toHaveBeenCalled()
    expect(existsSync(`${fixture.directory}/hub.lock.lock`)).toBe(false)
    expect(existsSync(`${fixture.directory}/hub-runtime.json`)).toBe(false)
    netServer = vi.mocked(createServer).mock.results[0]!.value as Server
    expect(netServer.listening).toBe(false)
    expect(process.listeners('SIGTERM')).toEqual(previousSignals.get('SIGTERM'))
  })

  it('rejects feedback to a browser-supplied legacy conversation without a Hub-owned task', async () => {
    const enqueue = vi.spyOn(CodexAppFeedback.prototype, 'enqueue').mockResolvedValue()
    const action = vi.spyOn(AgentClients.prototype, 'action')
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const task: DesignTask = {
      taskId: 'invented-task',
      title: 'Unverified browser recovery',
      target: { sessionId: 'session', fileKey: 'file', fileName: 'Fixture', pageId: 'page' },
      client: { kind: 'codex-app', name: 'Codex App', sessionId: 'victim-conversation' },
      status: 'completed',
      operation: null,
      epoch: 0,
      revision: 1,
      expiresAt: Date.now()
    }
    extension.send({
      type: 'sessions',
      browserId: 'browser',
      activeSessionId: 'session',
      sessions: [{ ...task.target, tabId: 1, documentId: 'document', busy: false }],
      reviews: [{ sessionId: 'session', task }]
    })
    const requestId = '00000000-0000-4000-8000-000000000099'
    extension.send({
      type: 'designAction',
      sessionId: 'session',
      action: {
        requestId,
        taskId: task.taskId,
        epoch: 1,
        action: 'feedback',
        feedback: {
          id: requestId,
          mode: 'queue',
          fileKey: 'file',
          comment: 'Forged browser text',
          items: [],
          createdAt: Date.now()
        }
      }
    })
    expect(action).toHaveBeenCalledOnce()
    await expect(action.mock.results[0]!.value).resolves.toMatchObject({ status: 'failed' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each(['read', 'write'] as const)(
    'keeps only an uncertain write fenced after a malformed %s result',
    async (operation) => {
      const { startHub } = await loadRuntime()
      await startHub()
      const extension = connectExtension()
      const consumer = await connectConsumer()
      const read = { name: 'get_structure', arguments: {} }
      const write = {
        name: 'apply_canvas',
        arguments: { mode: 'create', markup: '<div class="w-10 h-10"></div>' }
      }
      consumer.send({ id: 1, method: 'tools/call', params: operation === 'read' ? read : write })
      const first = await extension.call(0)
      extension.send({
        type: 'toolResult',
        id: first.id,
        error: { code: 123, message: 'Malformed result' }
      })
      expect(JSON.stringify(await consumer.reply(1))).toContain('EXTENSION_DISCONNECTED')
      consumer.send({ id: 2, method: 'tools/call', params: read })
      if (operation === 'write') {
        expect(JSON.stringify(await consumer.reply(2))).toContain('DESIGN_TASK_BUSY')
        expect(extension.calls).toHaveLength(1)
        extension.send({
          type: 'toolResult',
          id: first.id,
          error: { message: 'Definitive completion' }
        })
        consumer.send({ id: 3, method: 'tools/call', params: read })
      }
      const next = await extension.call(1)
      extension.send({ type: 'toolResult', id: next.id, error: { message: 'Next read completed' } })
      expect(JSON.stringify(await consumer.reply(operation === 'read' ? 2 : 3))).toContain(
        'Next read completed'
      )
    }
  )

  it('keeps a dispatched cancelled write fenced until its late definitive result arrives', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    const write = {
      name: 'apply_canvas',
      arguments: { mode: 'create', markup: '<div class="w-10 h-10"></div>' }
    }
    consumer.send({ id: 1, method: 'tools/call', params: write })
    const first = await extension.call(0)
    expect(first.route).toMatchObject({ sessionId: 'session', fileKey: 'file' })
    consumer.send({
      method: 'notifications/cancelled',
      params: { requestId: 1, reason: 'User cancelled' }
    })
    await vi.waitFor(
      () =>
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ req: first.id, message: expect.stringContaining('cancelled') }),
          'Tool invocation failed.'
        ),
      { interval: 1 }
    )
    extension.publishSession()
    consumer.send({ id: 2, method: 'tools/call', params: write })
    const blocked = await consumer.reply(2)
    expect(blocked.result?.isError).toBe(true)
    expect(JSON.stringify(blocked)).toContain('DESIGN_TASK_BUSY')
    expect(extension.calls).toHaveLength(1)
    expect(consumer.replies.has(1)).toBe(false)
    extension.send({
      type: 'toolResult',
      id: first.id,
      error: { message: 'Native operation definitively failed' }
    })
    expect(log.warn).toHaveBeenCalledWith(
      { reqId: first.id },
      'Received error for unknown/timed-out call.'
    )
    consumer.send({ id: 3, method: 'tools/call', params: write })
    const next = await extension.call(1)
    extension.send({
      type: 'toolResult',
      id: next.id,
      error: { message: 'Definitive second result' }
    })
    expect(JSON.stringify(await consumer.reply(3))).toContain('Definitive second result')
  })

  it('releases a cancelled operation after its native document is replaced', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    const read = { name: 'get_structure', arguments: {} }
    consumer.send({ id: 1, method: 'tools/call', params: read })
    const first = await extension.call(0)
    consumer.send({ method: 'notifications/cancelled', params: { requestId: 1 } })
    await vi.waitFor(
      () =>
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ req: first.id, message: expect.stringContaining('cancelled') }),
          'Tool invocation failed.'
        ),
      { interval: 1 }
    )
    extension.publishSession('reloaded-session', 'new-document')
    consumer.send({ id: 2, method: 'tools/call', params: read })
    const next = await extension.call(1)
    expect(next.route).toMatchObject({ sessionId: 'reloaded-session' })
    extension.send({ type: 'toolResult', id: next.id, payload: { roots: [] } })
    expect(await consumer.reply(2)).toMatchObject({ result: { structuredContent: { roots: [] } } })
  })

  it.each([1, 0, ''])(
    'does not dispatch a tool request already cancelled in the consumer input stream (ID %j)',
    async (requestId) => {
      const { startHub } = await loadRuntime()
      await startHub()
      const extension = connectExtension()
      const consumer = await connectConsumer()
      consumer.socket.write(
        [
          {
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/call',
            params: { name: 'get_structure', arguments: {} }
          },
          { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } }
        ]
          .map((message) => JSON.stringify(message))
          .join('\n') + '\n'
      )
      consumer.send({
        id: 2,
        method: 'tools/call',
        params: { name: 'list_design_sessions', arguments: {} }
      })
      expect((await consumer.reply(2)).result?.isError).not.toBe(true)
      expect(extension.calls).toHaveLength(0)
    }
  )

  it('cancels a disconnected consumer wait while another consumer observes the native work fence', async () => {
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const first = await connectConsumer()
    const other = await connectConsumer()
    first.send({ id: 1, method: 'tools/call', params: { name: 'get_structure', arguments: {} } })
    const dispatched = await extension.call(0)
    first.socket.destroy()
    await vi.waitFor(
      () =>
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            req: dispatched.id,
            message: expect.stringContaining('cancelled')
          }),
          'Tool invocation failed.'
        ),
      { interval: 1 }
    )
    extension.publishSession()
    other.send({ id: 2, method: 'tools/call', params: { name: 'get_structure', arguments: {} } })
    expect(JSON.stringify(await other.reply(2))).toContain('DESIGN_TASK_BUSY')
    extension.send({
      type: 'toolResult',
      id: dispatched.id,
      error: { message: 'Native work completed' }
    })
    expect(log.warn).toHaveBeenCalledWith(
      { reqId: dispatched.id },
      'Received error for unknown/timed-out call.'
    )
    other.send({ id: 3, method: 'tools/call', params: { name: 'get_structure', arguments: {} } })
    const next = await extension.call(1)
    extension.send({
      type: 'toolResult',
      id: next.id,
      payload: { roots: [] }
    })
    expect(await other.reply(3)).toMatchObject({ result: { structuredContent: { roots: [] } } })
  })

  it('uses the requested session and adds the batch read budget without leaving a timed-out file writable', async () => {
    vi.stubEnv('TEMPAD_MCP_TOOL_TIMEOUT', '100')
    const { startHub } = await loadRuntime()
    await startHub()
    const extension = connectExtension()
    const consumer = await connectConsumer()
    consumer.send({
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_screenshot',
        arguments: { sessionId: 'other-session', nodeIds: ['1:1', '1:2'] }
      }
    })
    const batch = await extension.call(0)
    expect(batch.route).toMatchObject({ sessionId: 'other-session', fileKey: 'other-file' })
    expect(batch.payload.args).toEqual({ nodeIds: ['1:1', '1:2'] })
    await vi.advanceTimersByTimeAsync(200)
    expect(consumer.replies.has(1)).toBe(false)
    extension.send({ type: 'toolResult', id: batch.id, error: { message: 'Batch done' } })
    await consumer.reply(1)
    consumer.send({
      id: 2,
      method: 'tools/call',
      params: { name: 'get_screenshot', arguments: { sessionId: 'other-session', nodeId: '1:1' } }
    })
    const single = await extension.call(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(JSON.stringify(await consumer.reply(2))).toContain('EXTENSION_TIMEOUT')
    extension.publishSession()
    consumer.send({
      id: 3,
      method: 'tools/call',
      params: { name: 'get_structure', arguments: { sessionId: 'other-session' } }
    })
    expect(JSON.stringify(await consumer.reply(3))).toContain('DESIGN_TASK_BUSY')
    extension.send({ type: 'toolResult', id: single.id, error: { message: 'Late completion' } })
  })
})
