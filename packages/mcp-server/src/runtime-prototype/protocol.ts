import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  JSONRPCMessage,
  Request,
  Notification,
  Result
} from '@modelcontextprotocol/sdk/types.js'
import type { Socket } from 'node:net'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Protocol } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
  serializeMessage,
  STDIO_DEFAULT_MAX_BUFFER_SIZE
} from '@modelcontextprotocol/sdk/shared/stdio.js'
import {
  isJSONRPCRequest,
  JSONRPCMessageSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { HostContextSchema } from '../agent-clients/host-context'
import { decodeConsumerMessage, encodeConsumerMessage } from '../consumer-transport'

// Version 2 includes replacement, bounded waiting and admission barriers.
// Version 1 was an unpublished prototype without hook admission provenance.
export const CONTROL_VERSIONS = [2] as const
export const LEASE_MS = 10_000
export const RENEW_MS = 2_000
export const RECOVER_MS = 90_000
export const REQUEST_TIMEOUT_MS = 330_000

export const IdSchema = z.uuid()
export const RegistrationSchema = z
  .object({
    sessionId: IdSchema,
    token: IdSchema,
    context: HostContextSchema,
    updates: z
      .object({
        policy: z.enum(['off', 'stable', 'pinned']),
        version: z.string(),
        manifestHash: z.string().regex(/^[a-f0-9]{64}$/)
      })
      .strict()
      .optional(),
    versions: z.array(z.number().int().positive()).min(1).max(16)
  })
  .strict()
export type Registration = z.infer<typeof RegistrationSchema>
export const GrantSchema = z
  .object({
    version: z.number().int().positive(),
    generation: z.number().int().positive(),
    hubId: IdSchema,
    hubPid: z.number().int().positive(),
    supervisorPid: z.number().int().positive()
  })
  .strict()
export type Grant = z.infer<typeof GrantSchema>
export const FrameSchema = z.object({
  method: z.literal('tempad/runtime-frame'),
  params: z
    .object({
      generation: z.number().int().positive(),
      deadline: z.number().finite().positive().optional(),
      message: JSONRPCMessageSchema
    })
    .strict()
})

export function unavailable(
  message = 'Runtime recovery is in progress; this call was not dispatched.'
) {
  return new McpError(-32001, message, { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false })
}

export function isRuntimeUnavailable(error: unknown): boolean {
  return (
    error instanceof McpError &&
    error.code === -32001 &&
    (error.data as { code?: unknown } | undefined)?.code === 'MCP_RUNTIME_UNAVAILABLE' &&
    (error.data as { dispatched?: unknown }).dispatched === false
  )
}

export function negotiate(
  versions: readonly number[],
  supported: readonly number[] = CONTROL_VERSIONS
) {
  const version = Math.max(...supported.filter((value) => versions.includes(value)))
  if (Number.isFinite(version)) return version
  throw new McpError(
    -32002,
    'MCP_RUNTIME_RESTART_REQUIRED: restart MCP with a compatible runtime.',
    {
      offered: versions,
      supported
    }
  )
}

/** Private control RPC uses the SDK's IDs, errors and cancellation, without MCP initialization. */
export class ControlPeer extends Protocol<Request, Notification, Result> {
  protected assertCapabilityForMethod() {}
  protected assertNotificationCapability() {}
  protected assertRequestHandlerCapability() {}
  protected assertTaskCapability() {}
  protected assertTaskHandlerCapability() {}
}

/** Socket ownership and write callbacks also settle pending sends on close/error. */
export class SocketTransport extends StdioServerTransport {
  private closed = false
  private pendingBytes = 0

  constructor(
    private readonly socket: Socket,
    private readonly afterSend?: (message: JSONRPCMessage) => Promise<void>
  ) {
    super(socket, socket)
    socket.once('close', () => void this.close())
  }

  override async start() {
    if (this.closed || this.socket.destroyed) throw new Error('Runtime socket is closed.')
    const error = this.onerror
    this.onerror = (value) => {
      error?.(value)
      void this.close()
    }
    await super.start()
  }

  override async send(message: JSONRPCMessage) {
    const data = serializeMessage(message)
    const size = Buffer.byteLength(data)
    if (this.closed || this.pendingBytes + size > STDIO_DEFAULT_MAX_BUFFER_SIZE)
      throw new Error('Runtime socket is closed or its output buffer is full.')
    this.pendingBytes += size
    try {
      await new Promise<void>((resolve, reject) => {
        const closed = () => reject(new Error('Runtime socket closed during send.'))
        this.socket.once('close', closed)
        this.socket.write(data, (error) => {
          this.socket.off('close', closed)
          if (error) reject(error)
          else resolve()
        })
      })
    } finally {
      this.pendingBytes -= size
    }
    await this.afterSend?.(message)
  }

  override async close() {
    if (this.closed) return
    this.closed = true
    this.socket.destroy()
    await super.close()
  }
}

/** Direct edge/Hub data survives a supervisor crash; the lease still gates new requests. */
export class RuntimeDataTransport implements Transport {
  onmessage?: Transport['onmessage']
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']

  constructor(
    private readonly wire: Transport,
    private readonly options: {
      generation: () => number
      admit: (generation: number, method?: string) => boolean
      role: 'edge' | 'hub'
      timeoutMs?: number
      started?: boolean
    }
  ) {}

  async start() {
    this.wire.onclose = () => this.onclose?.()
    this.wire.onerror = (error) => this.onerror?.(error)
    this.wire.onmessage = (value) => {
      try {
        const { params } = FrameSchema.parse(value)
        const message =
          this.options.role === 'hub' ? encodeConsumerMessage(params.message) : params.message
        if (
          isJSONRPCRequest(message) &&
          (!this.options.admit(params.generation, message.method) ||
            !params.deadline ||
            params.deadline <= Date.now())
        ) {
          void this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Runtime unavailable; request was not dispatched.',
              data: { code: 'MCP_RUNTIME_UNAVAILABLE', dispatched: false }
            }
          }).catch((error: Error) => this.onerror?.(error))
          return
        }
        this.onmessage?.(message)
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)))
        void this.close()
      }
    }
    if (!this.options.started) await this.wire.start()
  }

  async send(value: JSONRPCMessage) {
    const generation = this.options.generation()
    const message = this.options.role === 'hub' ? decodeConsumerMessage(value) : value
    const request = 'method' in message && 'id' in message
    if (request && !this.options.admit(generation, message.method)) throw unavailable()
    await this.wire.send({
      jsonrpc: '2.0',
      method: 'tempad/runtime-frame',
      params: {
        generation,
        message,
        ...(request
          ? { deadline: Date.now() + (this.options.timeoutMs ?? REQUEST_TIMEOUT_MS) }
          : {})
      }
    })
  }

  close() {
    return this.wire.close()
  }
}
