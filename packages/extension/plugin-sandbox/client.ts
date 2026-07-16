import type { PluginSandboxErrorCode, PluginSandboxResponse, PluginSandboxWorker } from './protocol'

import { inspectSandboxValue, PLUGIN_SANDBOX_LIMITS } from './limits'
import {
  isPluginSandboxErrorCode,
  PLUGIN_SANDBOX_MESSAGE,
  PLUGIN_SANDBOX_PROTOCOL_VERSION
} from './protocol'

const CONNECT_TIMEOUT_MS = 5000

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export class PluginSandboxError extends Error {
  readonly code: PluginSandboxErrorCode

  constructor(code: PluginSandboxErrorCode, message: string) {
    super(message)
    this.name = 'PluginSandboxError'
    this.code = code
  }
}

export class PluginSandboxClient {
  readonly #sandboxUrl: string
  readonly #pending = new Map<number, PendingRequest>()

  #connectPromise: Promise<MessagePort> | null = null
  #iframe: HTMLIFrameElement | null = null
  #nextId = 0
  #port: MessagePort | null = null

  constructor(sandboxUrl: string) {
    const url = new URL(sandboxUrl)
    if (url.protocol !== 'chrome-extension:') {
      throw new Error('Plugin sandbox URL must use the chrome-extension protocol.')
    }
    this.#sandboxUrl = url.href
  }

  async request<T, U>(worker: PluginSandboxWorker, payload: T): Promise<U> {
    const inspection = inspectSandboxValue(payload)
    if (!inspection.ok) {
      throw new PluginSandboxError(
        inspection.reason,
        inspection.reason === 'payload-too-large'
          ? 'Plugin request exceeds the sandbox payload limit.'
          : 'Plugin request contains unsupported values.'
      )
    }

    const port = await this.#connect()
    const id = this.#nextId
    this.#nextId += 1

    return await new Promise<U>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#reset(
          new PluginSandboxError(
            'timeout',
            `Plugin sandbox timed out after ${PLUGIN_SANDBOX_LIMITS.requestTimeoutMs}ms.`
          )
        )
      }, PLUGIN_SANDBOX_LIMITS.requestTimeoutMs)

      this.#pending.set(id, {
        reject,
        resolve: (value) => resolve(value as U),
        timer
      })

      try {
        port.postMessage({
          id,
          type: PLUGIN_SANDBOX_MESSAGE.request,
          worker,
          payload
        })
      } catch (error) {
        this.#reset(normalizeError(error, 'Unable to send the plugin request.'))
      }
    })
  }

  dispose(): void {
    this.#reset(new Error('Plugin sandbox client was disposed.'))
  }

  async #connect(): Promise<MessagePort> {
    if (this.#port) return this.#port
    if (this.#connectPromise) return await this.#connectPromise

    this.#connectPromise = this.#createConnection()
    try {
      return await this.#connectPromise
    } finally {
      this.#connectPromise = null
    }
  }

  #createConnection(): Promise<MessagePort> {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe')
      iframe.hidden = true
      iframe.sandbox.add('allow-scripts')
      iframe.src = this.#sandboxUrl
      iframe.setAttribute('aria-hidden', 'true')
      this.#iframe = iframe

      let port: MessagePort | null = null
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        window.removeEventListener('message', onReady)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        port?.close()
        iframe.remove()
        if (this.#iframe === iframe) this.#iframe = null
        reject(error)
      }
      const timer = setTimeout(
        () => fail(new Error(`Plugin sandbox connection timed out after ${CONNECT_TIMEOUT_MS}ms.`)),
        CONNECT_TIMEOUT_MS
      )
      const onReady = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.origin !== 'null') return
        if (event.data?.type !== PLUGIN_SANDBOX_MESSAGE.ready) return
        if (event.data?.version !== PLUGIN_SANDBOX_PROTOCOL_VERSION) {
          fail(new Error('Plugin sandbox protocol version mismatch.'))
          return
        }

        const channel = new MessageChannel()
        port = channel.port1
        port.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (isConnectedMessage(data)) {
            if (settled) return
            const connectedPort = port
            if (!connectedPort) {
              fail(new Error('Plugin sandbox connection port is unavailable.'))
              return
            }
            settled = true
            cleanup()
            this.#port = connectedPort
            resolve(connectedPort)
            return
          }
          this.#handleResponse(data)
        }
        port.onmessageerror = () => {
          this.#reset(
            new PluginSandboxError('worker-message-error', 'Sandbox message was unreadable.')
          )
        }
        port.start()
        iframe.contentWindow?.postMessage(
          {
            type: PLUGIN_SANDBOX_MESSAGE.connect,
            version: PLUGIN_SANDBOX_PROTOCOL_VERSION
          },
          '*',
          [channel.port2]
        )
      }

      window.addEventListener('message', onReady)
      document.documentElement.append(iframe)
    })
  }

  #handleResponse(data: unknown): void {
    if (!isPluginSandboxResponse(data)) {
      this.#reset(new PluginSandboxError('protocol-error', 'Invalid sandbox response envelope.'))
      return
    }

    const pending = this.#pending.get(data.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pending.delete(data.id)

    if (data.error) {
      pending.reject(new PluginSandboxError(data.error.code, data.error.message))
      return
    }

    pending.resolve(data.payload)
  }

  #reset(error: Error): void {
    this.#port?.close()
    this.#port = null
    this.#iframe?.remove()
    this.#iframe = null
    this.#connectPromise = null

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

function isConnectedMessage(
  value: unknown
): value is { type: typeof PLUGIN_SANDBOX_MESSAGE.connected; version: number } {
  return (
    isRecord(value) &&
    value.type === PLUGIN_SANDBOX_MESSAGE.connected &&
    value.version === PLUGIN_SANDBOX_PROTOCOL_VERSION
  )
}

function isPluginSandboxResponse(value: unknown): value is PluginSandboxResponse {
  if (
    !isRecord(value) ||
    value.type !== PLUGIN_SANDBOX_MESSAGE.response ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id)
  ) {
    return false
  }

  if (Object.hasOwn(value, 'error')) {
    return (
      isRecord(value.error) &&
      isPluginSandboxErrorCode(value.error.code) &&
      typeof value.error.message === 'string'
    )
  }
  return Object.hasOwn(value, 'payload')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
}
