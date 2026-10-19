import type { TempadMcpErrorCode } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { nanoid } from 'nanoid'

import type { PendingToolCall } from './types'

import { log } from './shared'

const pendingCalls = new Map<string, PendingToolCall>()
const UNKNOWN_WRITE_OUTCOME =
  'The canvas operation outcome is unknown. Do not replay this write; inspect the canvas or reload the executing Figma tab before continuing.'

type RegisterOptions = {
  waitForDefinitiveResult?: boolean
  signal?: AbortSignal
}

function createToolError(
  code: TempadMcpErrorCode,
  message: string
): Error & { code: TempadMcpErrorCode } {
  const err = new Error(message) as Error & { code: TempadMcpErrorCode }
  err.code = code
  return err
}

export function register<T>(
  extensionId: string,
  timeout: number,
  options: RegisterOptions = {}
): { promise: Promise<T>; requestId: string } {
  options.signal?.throwIfAborted()
  const requestId = nanoid()
  const promise = new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(call.timer)
      options.signal?.removeEventListener('abort', abort)
      pendingCalls.delete(requestId)
    }
    const abort = () =>
      call.reject(
        new DOMException(
          'The tool request was cancelled. Any dispatched Figma operation may still be running; do not replay a canvas write.',
          'AbortError'
        )
      )
    const timer = setTimeout(() => {
      if (options.waitForDefinitiveResult) {
        log.warn(
          { reqId: requestId, extId: extensionId, timeout },
          'Extension call exceeded its warning threshold; waiting for a definitive result.'
        )
        const call = pendingCalls.get(requestId)
        if (call)
          call.timer = setTimeout(() => {
            call.reject(
              createToolError(TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT, UNKNOWN_WRITE_OUTCOME)
            )
          }, timeout)
        return
      }
      call.reject(
        createToolError(
          TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT,
          `Extension did not respond within ${timeout / 1000}s.`
        )
      )
    }, timeout)

    const call: PendingToolCall = {
      resolve: (value) => {
        cleanup()
        resolve(value as T)
      },
      reject: (error) => {
        cleanup()
        if (
          options.waitForDefinitiveResult &&
          error &&
          'code' in error &&
          error.code === TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED
        ) {
          reject(
            createToolError(TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED, UNKNOWN_WRITE_OUTCOME)
          )
          return
        }
        reject(error)
      },
      timer,
      extensionId
    }
    pendingCalls.set(requestId, call)
    options.signal?.addEventListener('abort', abort, { once: true })
  })
  return { promise, requestId }
}

function pendingResponse(
  requestId: string,
  extensionId: string,
  outcome: 'result' | 'error'
): PendingToolCall | undefined {
  const call = pendingCalls.get(requestId)
  if (!call) {
    log.warn({ reqId: requestId }, `Received ${outcome} for unknown/timed-out call.`)
    return
  }
  if (call.extensionId !== extensionId) {
    log.warn(
      { reqId: requestId, expectedExtId: call.extensionId, receivedExtId: extensionId },
      `Ignored tool ${outcome} from the wrong extension.`
    )
    return
  }
  return call
}

export function resolve(requestId: string, extensionId: string, payload: unknown): void {
  const call = pendingResponse(requestId, extensionId, 'result')
  if (!call) return
  call.resolve(payload)
}

export function reject(requestId: string, extensionId: string, error: Error): void {
  const call = pendingResponse(requestId, extensionId, 'error')
  if (!call) return
  call.reject(error)
}

export function cleanupForExtension(extensionId: string): void {
  for (const [reqId, call] of pendingCalls.entries()) {
    const { reject: fail, extensionId: extId } = call
    if (extId === extensionId) {
      fail(
        createToolError(
          TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
          'Extension disconnected before providing a result.'
        )
      )
      log.warn({ reqId, extId: extensionId }, 'Rejected pending call from disconnected extension.')
    }
  }
}

export function cleanupAll(): void {
  pendingCalls.forEach((call, reqId) => {
    const { reject: fail } = call
    fail(new Error('Hub is shutting down.'))
    log.debug({ reqId }, 'Rejected pending tool call due to shutdown.')
  })
  pendingCalls.clear()
}
