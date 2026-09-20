import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

import { CodexIpcError } from './codex-ipc'

export type ServerQueuedMessage = {
  id: string
  clientUserMessageId: string | null
  input: { type: string; text?: string }[]
}

/** Use the running desktop's bundled binary, never an unrelated CLI on PATH. */
export async function codexQueueExecutable(): Promise<string> {
  const { stdout } =
    process.platform === 'win32'
      ? await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '(Get-Process codex -ErrorAction Stop).Path'
          ],
          { timeout: 3000 }
        )
      : await promisify(execFile)('ps', ['-U', String(process.getuid!()), '-o', 'comm='], {
          timeout: 3000
        })
  const paths = [...new Set(stdout.split(/\r?\n/).map((path) => path.trim()))].filter((path) =>
    /[/\\]resources[/\\]codex(?:\.exe)?$/i.test(path)
  )
  if (paths.length !== 1)
    throw new Error('The running Codex desktop executable could not be identified.')
  return paths[0]!
}

/** A queue-only connection: the desktop remains the sole executor of its tasks. */
export class CodexQueueRpc {
  private child?: ChildProcessWithoutNullStreams
  private ready?: Promise<void>
  private closed = false
  private nextId = 0
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >()

  constructor(private readonly executable = codexQueueExecutable) {}

  async list(threadId: string, signal?: AbortSignal): Promise<ServerQueuedMessage[]> {
    await this.connect()
    const messages: ServerQueuedMessage[] = []
    let cursor: string | null = null
    do {
      const page = (await this.request('thread/queue/list', { threadId, cursor }, signal)) as {
        data: ServerQueuedMessage[]
        nextCursor: string | null
      }
      if (
        !Array.isArray(page?.data) ||
        page.data.some(
          (item) =>
            !item ||
            typeof item.id !== 'string' ||
            !item.id ||
            !Array.isArray(item.input) ||
            (item.clientUserMessageId !== null && typeof item.clientUserMessageId !== 'string')
        )
      )
        throw new Error('Codex returned an incompatible server queue.')
      messages.push(...page.data)
      if (
        page.nextCursor != null &&
        (typeof page.nextCursor !== 'string' || page.nextCursor === cursor)
      )
        throw new Error('Codex returned an incompatible queue cursor.')
      cursor = page.nextCursor ?? null
    } while (cursor !== null)
    return messages
  }

  async add(
    threadId: string,
    clientUserMessageId: string,
    text: string,
    signal: AbortSignal
  ): Promise<void> {
    await this.connect()
    const result = (await this.request(
      'thread/queue/add',
      {
        threadId,
        clientUserMessageId,
        input: [{ type: 'text', text, text_elements: [] }]
      },
      signal
    )) as { queuedSubmission?: ServerQueuedMessage }
    if (
      typeof result?.queuedSubmission?.id !== 'string' ||
      !result.queuedSubmission.id ||
      result.queuedSubmission.clientUserMessageId !== clientUserMessageId
    )
      throw new CodexIpcError('Codex did not confirm queue admission.', true)
  }

  async remove(threadId: string, queuedSubmissionId: string, signal: AbortSignal): Promise<void> {
    await this.connect()
    const result = (await this.request(
      'thread/queue/delete',
      { threadId, queuedSubmissionId },
      signal
    )) as { deleted?: boolean }
    if (typeof result?.deleted !== 'boolean')
      throw new CodexIpcError('Codex did not confirm queue removal.', true)
  }

  private async connect(): Promise<void> {
    if (this.closed) throw new Error('Codex queue connection is closed.')
    this.ready ??= this.start()
    const ready = this.ready
    try {
      await ready
    } catch (error) {
      if (this.ready === ready) this.disconnect()
      throw error
    }
  }

  private async start(): Promise<void> {
    const executable = await this.executable()
    if (this.closed) throw new Error('Codex queue connection is closed.')
    const child = spawn(executable, ['app-server'], { stdio: 'pipe', windowsHide: true })
    this.child = child
    child.stderr.resume()
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (this.child !== child) return
      try {
        const response = JSON.parse(line)
        const pending = this.pending.get(response.id)
        if (!pending) return
        if (response.error)
          pending.reject(
            new CodexIpcError(String(response.error.message ?? 'Codex queue request failed.'))
          )
        else if ('result' in response) pending.resolve(response.result)
        else this.disconnect()
      } catch {
        this.disconnect()
      }
    })
    const disconnected = () => {
      if (this.child === child) this.disconnect()
    }
    child.on('error', disconnected)
    child.on('exit', disconnected)
    child.stdin.on('error', disconnected)
    child.on('close', () => lines.close())
    await this.request('initialize', {
      clientInfo: { name: 'tempad-dev-queue', version: '1' },
      capabilities: { experimentalApi: true }
    })
    child.stdin.write('{"method":"initialized"}\n')
  }

  private request(
    method: 'initialize' | 'thread/queue/list' | 'thread/queue/add' | 'thread/queue/delete',
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    signal?.throwIfAborted()
    const child = this.child
    if (!child || child.stdin.destroyed)
      throw new CodexIpcError('Codex queue connection is unavailable.')
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: unknown) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.pending.delete(id)
        if (error) reject(error)
        else resolve(value)
      }
      const abort = () =>
        finish(new CodexIpcError('Codex queue request was cancelled after dispatch.', true))
      const timer = setTimeout(
        () => finish(new CodexIpcError('Codex queue request timed out.', true)),
        10000
      )
      this.pending.set(id, {
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error)
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      } catch (cause) {
        finish(new CodexIpcError(`Codex queue write failed: ${String(cause)}`, true))
      }
    })
  }

  private disconnect(): void {
    const child = this.child
    this.child = undefined
    this.ready = undefined
    for (const pending of this.pending.values())
      pending.reject(new CodexIpcError('Codex queue connection closed after dispatch.', true))
    child?.kill()
  }

  close(): void {
    this.closed = true
    this.disconnect()
  }
}
