import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  InitializeRequest,
  JSONRPCMessage,
  Notification,
  Request
} from '@modelcontextprotocol/sdk/types.js'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js'
import {
  ErrorCode,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
  ResultSchema
} from '@modelcontextprotocol/sdk/types.js'
import { isDeepStrictEqual } from 'node:util'

import { runtimeContract } from '../scripts/runtime-contract.mjs'
import { ClientBindingUpdateSchema, type ClientBindingUpdate } from './client-binding'

export interface StableEdgeOptions {
  version: string
  requestTimeoutMs: number
  open: (initialize: InitializeRequest, signal: AbortSignal) => Promise<Transport>
  register?: (client: Client) => Promise<void>
  onBinding?: (binding: ClientBindingUpdate) => void
  onError?: (error: Error) => void
  onBackendClose?: () => void
  onBackendReady?: () => Promise<void>
  validateContract?: (
    contract: RuntimeContract,
    version: string,
    previous?: RuntimeContract
  ) => void
}
type RuntimeContract = Awaited<ReturnType<typeof readRuntimeContract>>

export function contractHashes(contract: RuntimeContract) {
  return runtimeContract({
    initialize: {
      serverInfo: { ...contract.info, version: '0' },
      capabilities: contract.capabilities,
      instructions: contract.instructions
    },
    tools: [...contract.pages.values()].flatMap((page) => page.tools)
  })
}

/** Capture the observable contract before admitting a backend into a host session. */
export async function readRuntimeContract(client: Client, signal: AbortSignal, timeout: number) {
  const pages = new Map<string, Awaited<ReturnType<Client['listTools']>>>()
  let cursor: string | undefined
  let bytes = 0
  do {
    if (pages.has(cursor ?? '') || pages.size >= 64)
      throw new Error('Runtime returned a cyclic or oversized tool catalog.')
    const page = await client.request(
      { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
      ListToolsResultSchema,
      { signal, timeout }
    )
    bytes += Buffer.byteLength(JSON.stringify(page))
    if (bytes > STDIO_DEFAULT_MAX_BUFFER_SIZE)
      throw new Error('Runtime tool catalog exceeded the MCP buffer limit.')
    pages.set(cursor ?? '', page)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  const { version: _version, ...info } = client.getServerVersion()!
  return {
    pages,
    info,
    capabilities: client.getServerCapabilities(),
    instructions: client.getInstructions()
  }
}

/** Own the host's MCP session without carrying any tool implementation or schema. */
export async function startStableEdge(host: Transport, options: StableEdgeOptions) {
  const lifetime = new AbortController()
  let backend: Client | undefined
  let initializedRequest: InitializeRequest | undefined
  let contract: Awaited<ReturnType<typeof readRuntimeContract>> | undefined
  let replacement: Promise<void> | undefined
  let server: Server | undefined
  let opening = false
  let openingId: string | number | undefined
  let failure: Error | undefined
  let bufferedBytes = 0
  const buffered: JSONRPCMessage[] = []
  let resolveClosed: (error?: Error) => void
  const closed = new Promise<Error | undefined>((resolve) => (resolveClosed = resolve))

  async function close() {
    if (lifetime.signal.aborted) return
    lifetime.abort()
    buffered.length = 0
    await Promise.allSettled([backend?.close(), server?.close(), host.close()])
    resolveClosed(failure)
  }

  function forward(
    target: Client | Server,
    request: Request,
    extra: RequestHandlerExtra<Request, Notification>
  ) {
    const progressToken = request.params?._meta?.progressToken
    return target.request(request, ResultSchema, {
      signal: extra.signal,
      timeout: options.requestTimeoutMs,
      ...(progressToken !== undefined
        ? {
            onprogress: (progress) => {
              void extra
                .sendNotification({
                  method: 'notifications/progress',
                  params: { ...progress, progressToken }
                })
                .catch(options.onError ?? (() => {}))
            }
          }
        : {})
    })
  }

  function unavailable() {
    return new McpError(
      -32001,
      'Runtime switching or recovery is in progress; this call was not dispatched.',
      { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false }
    )
  }

  async function openBackend(request: InitializeRequest) {
    const client = new Client(request.params.clientInfo, {
      capabilities: request.params.capabilities
    })
    client.onerror = options.onError
    client.onclose = () => {
      if (backend !== client) return
      backend = undefined
      if (!lifetime.signal.aborted) options.onBackendClose?.()
    }
    client.fallbackRequestHandler = (request, extra) => {
      if (!server) throw new McpError(ErrorCode.InvalidRequest, 'Host is not initialized.')
      return forward(server, request, extra)
    }
    client.fallbackNotificationHandler = async (notification) => {
      if (notification.method === ClientBindingUpdateSchema.shape.method.value)
        options.onBinding?.(ClientBindingUpdateSchema.parse(notification).params)
      else if (notification.method !== 'notifications/tools/list_changed')
        await server?.notification(notification)
    }
    try {
      const transport = await options.open(request, lifetime.signal)
      if (lifetime.signal.aborted) {
        await transport.close()
        lifetime.signal.throwIfAborted()
      }
      await client.connect(transport, {
        signal: lifetime.signal,
        timeout: options.requestTimeoutMs
      })
      await options.register?.(client)
      const observed = await readRuntimeContract(client, lifetime.signal, options.requestTimeoutMs)
      options.validateContract?.(observed, client.getServerVersion()!.version, contract)
      lifetime.signal.throwIfAborted()
      if (!client.transport) throw unavailable()
      return { client, observed }
    } catch (error) {
      await client.close()
      throw error
    }
  }

  async function replaceBackend(): Promise<void> {
    if (!initializedRequest || !server || !contract || lifetime.signal.aborted) throw unavailable()
    if (replacement) return replacement
    const replace = async () => {
      const previous = backend
      backend = undefined
      await previous?.close()
      const { client, observed } = await openBackend(initializedRequest!)
      if (!options.validateContract && !isDeepStrictEqual(contract, observed)) {
        await client.close()
        throw new McpError(
          -32002,
          'MCP_RUNTIME_RESTART_REQUIRED: replacement runtime changed this session’s frozen contract.'
        )
      }
      backend = client
      await options.onBackendReady?.()
    }
    replacement = replace()
    try {
      await replacement
    } finally {
      replacement = undefined
    }
  }

  async function initialize(message: JSONRPCMessage) {
    if (!('method' in message) || message.method !== 'initialize' || !('id' in message)) {
      if ('id' in message)
        await host.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: ErrorCode.InvalidRequest, message: 'Initialize the MCP session first.' }
        })
      return
    }
    opening = true
    openingId = message.id
    try {
      const request = InitializeRequestSchema.parse(message)
      const { client, observed } = await openBackend(request)
      backend = client
      initializedRequest = request
      contract = observed
      await options.onBackendReady?.()
      const runtimeInfo = backend.getServerVersion()!
      server = new Server(
        { ...runtimeInfo, version: options.version },
        {
          capabilities: contract.capabilities,
          instructions: contract.instructions
        }
      )
      server.onerror = options.onError
      server.setRequestHandler(ListToolsRequestSchema, ({ params }) => {
        const page = contract!.pages.get(params?.cursor ?? '')
        if (!page) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool catalog cursor.')
        return structuredClone(page)
      })
      server.fallbackRequestHandler = (request, extra) => {
        if (!backend) throw unavailable()
        return forward(backend, request, extra)
      }
      server.fallbackNotificationHandler = async (notification) => {
        if (!backend) throw unavailable()
        await backend.notification(notification)
      }
      // The host transport already started while the runtime was being opened.
      const session: Transport = {
        start: async () => {},
        send: (value, sendOptions) => host.send(value, sendOptions),
        close: async () => {
          session.onclose?.()
        }
      }
      await server.connect(session)
      host.onmessage = (value, extra) => session.onmessage?.(value, extra)
      host.onmessage(message)
      for (const value of buffered.splice(0)) host.onmessage(value)
      bufferedBytes = 0
    } catch (error) {
      if (!lifetime.signal.aborted) {
        failure = error instanceof Error ? error : new Error(String(error))
        options.onError?.(failure)
        await host.send({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: error instanceof McpError ? error.code : ErrorCode.InternalError,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof McpError && error.data !== undefined ? { data: error.data } : {})
          }
        })
      }
      await close()
    }
  }

  host.onerror = options.onError
  host.onclose = () => void close()
  host.onmessage = (message) => {
    if (lifetime.signal.aborted) return
    if (
      opening &&
      'method' in message &&
      message.method === 'notifications/cancelled' &&
      message.params?.requestId === openingId
    ) {
      void close()
      return
    }
    if (!opening) {
      void initialize(message).catch((error: Error) => {
        failure = error
        options.onError?.(error)
        void close()
      })
      return
    }
    bufferedBytes += Buffer.byteLength(JSON.stringify(message))
    if (buffered.length >= 64 || bufferedBytes > STDIO_DEFAULT_MAX_BUFFER_SIZE) {
      failure = new Error('Host initialization buffer exceeded the MCP buffer limit.')
      options.onError?.(failure)
      void close()
    } else buffered.push(message)
  }
  await host.start()
  return { close, closed, replaceBackend }
}
