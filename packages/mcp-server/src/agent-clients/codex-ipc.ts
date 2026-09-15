import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

type Message = Record<string, unknown>
const WINDOWS_PIPE = String.raw`\\.\pipe\codex-ipc`
export class CodexIpcError extends Error {
  constructor(
    message: string,
    readonly uncertain = false
  ) {
    super(message)
  }
}

export class CodexDiscoveryError extends CodexIpcError {
  constructor() {
    super(
      'Could not locate the original Codex conversation. No comments were sent. Open it in Codex and retry.'
    )
  }
}

export function codexSocketPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform === 'win32') return [WINDOWS_PIPE]
  if (!process.getuid) return []
  const uid = process.getuid()
  return [
    join(env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock'),
    join(tmpdir(), 'codex-ipc', uid ? `ipc-${uid}.sock` : 'ipc.sock')
  ]
}

/** Use the host's fixed local pipe or existing current-user Unix sockets. */
async function trustedSocket(path: string): Promise<boolean> {
  // Named pipes have no filesystem inode/uid. Windows enforces pipe access on connect;
  // accept only the host's local name, never a remote pipe or an arbitrary endpoint.
  if (process.platform === 'win32') return path === WINDOWS_PIPE
  try {
    const [socket, parent] = await Promise.all([lstat(path), lstat(dirname(path))])
    const uid = process.getuid?.()
    return (
      uid !== undefined &&
      socket.isSocket() &&
      socket.uid === uid &&
      parent.isDirectory() &&
      parent.uid === uid &&
      !(parent.mode & 0o022)
    )
  } catch {
    return false
  }
}

export class CodexIpc {
  private readonly broadcasts = new Set<(message: Message) => void>()
  private readonly disconnects = new Set<() => void>()
  private clientId = 'initializing-client'
  private readonly header = Buffer.alloc(4)
  private headerBytes = 0
  private payload?: Buffer
  private payloadBytes = 0
  private readonly pending = new Map<
    string,
    {
      method: string
      resolve: (message: Message) => void
      reject: (error: Error) => void
    }
  >()

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      let offset = 0
      while (offset < chunk.length && !socket.destroyed) {
        if (!this.payload) {
          const copied = chunk.copy(
            this.header,
            this.headerBytes,
            offset,
            offset + 4 - this.headerBytes
          )
          this.headerBytes += copied
          offset += copied
          if (this.headerBytes < 4) continue
          const size = this.header.readUInt32LE(0)
          // Match the host's IPC frame bound; long conversation snapshots can exceed 16 MiB.
          if (!size || size > 256 * 1024 * 1024) {
            this.close()
            return
          }
          this.payload = Buffer.allocUnsafe(size)
          this.payloadBytes = 0
          this.headerBytes = 0
        }
        const copied = chunk.copy(
          this.payload,
          this.payloadBytes,
          offset,
          offset + this.payload.length - this.payloadBytes
        )
        this.payloadBytes += copied
        offset += copied
        if (this.payloadBytes < this.payload.length) continue
        const payload = this.payload
        this.payload = undefined
        try {
          this.receive(JSON.parse(payload.toString('utf8')))
        } catch {
          this.close()
        }
      }
    })
    socket.on('error', () => this.close())
    socket.on('close', () => {
      this.payload = undefined
      for (const pending of this.pending.values())
        pending.reject(
          new CodexIpcError('Codex IPC disconnected; delivery may be uncertain.', true)
        )
      this.pending.clear()
      for (const listener of this.disconnects) listener()
      this.disconnects.clear()
      this.broadcasts.clear()
    })
  }

  static async open(paths = codexSocketPaths()): Promise<CodexIpc> {
    for (const path of paths) {
      if (!(await trustedSocket(path))) continue
      let client: CodexIpc | undefined
      try {
        const socket = connect(path)
        client = new CodexIpc(socket)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.destroy()
            reject(new Error('Connect timeout'))
          }, 750)
          socket.once('connect', () => {
            clearTimeout(timer)
            resolve()
          })
          socket.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
          })
        })
        const response = await client.request(
          'initialize',
          0,
          { clientType: 'tempad-dev' },
          undefined,
          undefined,
          2000
        )
        const result = response.result as Message | undefined
        if (typeof result?.clientId !== 'string' || !result.clientId)
          throw new Error('Invalid IPC identity')
        client.clientId = result.clientId
        return client
      } catch {
        client?.close()
      }
    }
    throw new CodexIpcError(
      'Codex App IPC is unavailable. Open the original conversation in Codex.'
    )
  }

  private receive(message: Message): void {
    if (message.type === 'broadcast') {
      for (const listener of this.broadcasts) listener(message)
      return
    }
    if (message.type === 'client-discovery-request') {
      this.write({
        type: 'client-discovery-response',
        requestId: message.requestId,
        response: { canHandle: false }
      })
      return
    }
    if (message.type !== 'response' || typeof message.requestId !== 'string') return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    if (message.resultType === 'success' && message.method === pending.method)
      pending.resolve(message)
    else
      pending.reject(
        new CodexIpcError(
          typeof message.error === 'string'
            ? message.error
            : 'Codex IPC returned an incompatible response.',
          message.resultType === 'success'
        )
      )
  }

  private write(message: Message): void {
    const data = Buffer.from(JSON.stringify(message))
    const header = Buffer.alloc(4)
    header.writeUInt32LE(data.length)
    this.socket.write(Buffer.concat([header, data]))
  }

  onBroadcast(listener: (message: Message) => void): () => void {
    this.broadcasts.add(listener)
    return () => this.broadcasts.delete(listener)
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnects.add(listener)
    return () => this.disconnects.delete(listener)
  }

  broadcast(method: string, version: number, params: Message, targetClientIds: string[]): void {
    if (this.socket.destroyed) throw new CodexIpcError('Codex IPC is disconnected.')
    this.write({
      type: 'broadcast',
      sourceClientId: this.clientId,
      method,
      version,
      params,
      targetClientIds
    })
  }

  request(
    method: string,
    version: number,
    params: Message,
    targetClientId?: string,
    signal?: AbortSignal,
    timeoutMs = 25000
  ): Promise<Message> {
    if (signal?.aborted || this.socket.destroyed)
      return Promise.reject(new CodexIpcError('Codex IPC request cancelled before dispatch.'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, response?: Message) => {
        this.pending.delete(requestId)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(response!)
      }
      const abort = () =>
        finish(
          new CodexIpcError(
            'Codex IPC delivery was cancelled after dispatch; check the conversation.',
            true
          )
        )
      const timer = setTimeout(
        () =>
          finish(
            new CodexIpcError(
              'Codex IPC delivery timed out; check the conversation before retrying.',
              true
            )
          ),
        timeoutMs
      )
      this.pending.set(requestId, {
        method,
        resolve: (message) => finish(undefined, message),
        reject: (error) => finish(error)
      })
      signal?.addEventListener('abort', abort, { once: true })
      this.write({
        type: 'request',
        requestId,
        sourceClientId: this.clientId,
        version,
        method,
        params,
        timeoutMs,
        ...(targetClientId ? { targetClientId } : {})
      })
    })
  }

  async owner(
    conversationId: string,
    signal?: AbortSignal,
    // The host router can take 10 seconds to reject a discovery with an unresponsive client.
    timeoutMs = 12000
  ): Promise<string> {
    let response: Message
    try {
      response = await this.request(
        'thread-owner-discovery',
        1,
        { hostId: 'local', conversationId },
        undefined,
        signal,
        timeoutMs
      )
    } catch (error) {
      // Discovery is read-only: its timeout/disconnection cannot mean comments were sent.
      if (error instanceof CodexIpcError && error.uncertain) throw new CodexDiscoveryError()
      throw error
    }
    if (
      typeof response.handledByClientId !== 'string' ||
      (response.result as Message | undefined)?.supportsUntrustedAppInput !== true
    )
      throw new CodexIpcError('The conversation owner does not support external comment input.')
    return response.handledByClientId
  }

  close(): void {
    this.socket.destroy()
  }
}
