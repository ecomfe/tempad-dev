import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import { Transform, type TransformCallback } from 'node:stream'
import { z } from 'zod'

export const ClientBindingSubscribeSchema = z.object({
  method: z.literal('notifications/tempad/subscribe-client-binding'),
  params: z
    .object({ sessionId: z.string().min(1).max(256).optional() })
    .strict()
    .optional()
})
export const ClientBindingUpdateSchema = z.object({
  method: z.literal('notifications/tempad/client-binding'),
  params: z.union([
    z
      .object({
        kind: z.literal('claude'),
        sessionId: z.string().min(1).max(256).optional()
      })
      .strict(),
    z.object({ clearSessionHint: z.literal(true) }).strict()
  ])
})
export type ClientBindingUpdate = z.infer<typeof ClientBindingUpdateSchema>['params']
export type ClaudeBinding = Extract<ClientBindingUpdate, { kind: 'claude' }>

/** Private Hub-to-CLI state never reaches the MCP host. The SDK bounds each
 * frame; splitting chunks at newlines avoids rejecting batches of small frames. */
export class ClientBindingFilter extends Transform {
  private readonly buffer = new ReadBuffer()

  constructor(private readonly update: (binding: ClientBindingUpdate) => void) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      let offset = 0
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset)
        const end = newline === -1 ? chunk.length : newline + 1
        this.buffer.append(chunk.subarray(offset, end))
        offset = end
        const message = this.buffer.readMessage()
        if (!message) continue
        if (
          'method' in message &&
          message.method === ClientBindingUpdateSchema.shape.method.value
        ) {
          this.update(ClientBindingUpdateSchema.parse(message).params)
        } else this.push(serializeMessage(message))
      }
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
