import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const ZERO_ID = 'tempad:request:zero'
const STRING_ID = 'tempad:request:string:'

function encode(id: RequestId): RequestId {
  return typeof id === 'string' ? STRING_ID + id : id === 0 ? ZERO_ID : id
}

function decode(id: RequestId): RequestId {
  if (id === ZERO_ID) return 0
  return typeof id === 'string' && id.startsWith(STRING_ID) ? id.slice(STRING_ID.length) : id
}

export function encodeConsumerMessage(message: JSONRPCMessage): JSONRPCMessage {
  if ('method' in message && 'id' in message) return { ...message, id: encode(message.id) }
  if ('method' in message && message.method === 'notifications/cancelled') {
    const id = message.params?.requestId
    if (typeof id === 'string' || typeof id === 'number')
      return { ...message, params: { ...message.params, requestId: encode(id) } }
  }
  return message
}

export function decodeConsumerMessage(message: JSONRPCMessage): JSONRPCMessage {
  return !('method' in message) && message.id !== undefined
    ? { ...message, id: decode(message.id) }
    : message
}

/** SDK 1.32 ignores cancellation of falsy request IDs. Keep wire IDs unchanged
 * while giving its existing cancellation machinery nonempty, collision-free IDs. */
export class ConsumerTransport extends StdioServerTransport {
  private started = false

  override async start(): Promise<void> {
    if (this.started) return super.start()
    this.started = true
    const receive = this.onmessage
    this.onmessage = (message) => {
      receive?.(encodeConsumerMessage(message))
    }
    await super.start()
  }

  override send(message: JSONRPCMessage): Promise<void> {
    // Server-initiated requests and their incoming responses use the server's
    // independent ID space. Only replies to client requests need decoding.
    return super.send(decodeConsumerMessage(message))
  }
}
