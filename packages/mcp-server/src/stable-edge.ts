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

import { ClientBindingUpdateSchema, type ClientBindingUpdate } from './client-binding'

export interface StableEdgeOptions {
  version: string
  requestTimeoutMs: number
  open: (initialize: InitializeRequest, signal: AbortSignal) => Promise<Transport>
  register?: (client: Client) => Promise<void>
  onBinding?: (binding: ClientBindingUpdate) => void
  onError?: (error: Error) => void
}

/** Own the host's MCP session without carrying any tool implementation or schema. */
export async function startStableEdge(host: Transport, options: StableEdgeOptions) {
  const lifetime = new AbortController()
  let backend: Client | undefined
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
      backend = new Client(request.params.clientInfo, {
        capabilities: request.params.capabilities
      })
      backend.onerror = options.onError
      backend.fallbackRequestHandler = (request, extra) => {
        if (!server) throw new McpError(ErrorCode.InvalidRequest, 'Host is not initialized.')
        return forward(server, request, extra)
      }
      backend.fallbackNotificationHandler = async (notification) => {
        if (notification.method === ClientBindingUpdateSchema.shape.method.value) {
          options.onBinding?.(ClientBindingUpdateSchema.parse(notification).params)
        } else if (notification.method !== 'notifications/tools/list_changed') {
          await server?.notification(notification)
        }
      }
      const transport = await options.open(request, lifetime.signal)
      if (lifetime.signal.aborted) {
        await transport.close()
        return
      }
      await backend.connect(transport, {
        signal: lifetime.signal,
        timeout: options.requestTimeoutMs
      })
      await options.register?.(backend)

      // Freeze every advertised page. A runtime may paginate, but must not make
      // later tools/list calls quietly replace this session's guidance.
      const pages = new Map<string, Awaited<ReturnType<Client['listTools']>>>()
      let cursor: string | undefined
      let catalogBytes = 0
      do {
        if (pages.has(cursor ?? '') || pages.size >= 64)
          throw new Error('Runtime returned a cyclic or oversized tool catalog.')
        const page = await backend.request(
          { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
          ListToolsResultSchema,
          { signal: lifetime.signal, timeout: options.requestTimeoutMs }
        )
        catalogBytes += Buffer.byteLength(JSON.stringify(page))
        if (catalogBytes > STDIO_DEFAULT_MAX_BUFFER_SIZE)
          throw new Error('Runtime tool catalog exceeded the MCP buffer limit.')
        pages.set(cursor ?? '', page)
        cursor = page.nextCursor
      } while (cursor !== undefined)

      lifetime.signal.throwIfAborted()
      const runtimeInfo = backend.getServerVersion()!
      server = new Server(
        { ...runtimeInfo, version: options.version },
        {
          capabilities: backend.getServerCapabilities(),
          instructions: backend.getInstructions()
        }
      )
      server.onerror = options.onError
      server.setRequestHandler(ListToolsRequestSchema, ({ params }) => {
        const page = pages.get(params?.cursor ?? '')
        if (!page) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool catalog cursor.')
        return structuredClone(page)
      })
      server.fallbackRequestHandler = (request, extra) => forward(backend!, request, extra)
      server.fallbackNotificationHandler = (notification) => backend!.notification(notification)
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
  return { close, closed }
}
