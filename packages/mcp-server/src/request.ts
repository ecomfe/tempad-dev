import { TEMPAD_MCP_ERROR_CODES, type TempadMcpErrorCode } from '@tempad-dev/mcp-shared'
import { nanoid } from 'nanoid'

import type { PendingToolCall } from './types'

import { log } from './shared'

const pendingCalls = new Map<string, PendingToolCall>()

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
  timeout: number
): { promise: Promise<T>; requestId: string } {
  const requestId = nanoid()
  const promise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(requestId)
      reject(
        createToolError(
          TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT,
          `Extension did not respond within ${timeout / 1000}s.`
        )
      )
    }, timeout)

    pendingCalls.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
      extensionId
    })
  })
  return { promise, requestId }
}

export function resolve(requestId: string, payload: unknown): void {
  const call = pendingCalls.get(requestId)
  if (call) {
    const { timer, resolve: finish } = call
    clearTimeout(timer)
    finish(payload)
    pendingCalls.delete(requestId)
  } else {
    log.warn({ reqId: requestId }, 'Received result for unknown/timed-out call.')
  }
}

export function reject(requestId: string, error: Error): void {
  const call = pendingCalls.get(requestId)
  if (call) {
    const { timer, reject: fail } = call
    clearTimeout(timer)
    fail(error)
    pendingCalls.delete(requestId)
  } else {
    log.warn({ reqId: requestId }, 'Received error for unknown/timed-out call.')
  }
}

export function cleanupForExtension(extensionId: string): void {
  for (const [reqId, call] of pendingCalls.entries()) {
    const { timer, reject: fail, extensionId: extId } = call
    if (extId === extensionId) {
      clearTimeout(timer)
      fail(
        createToolError(
          TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
          'Extension disconnected before providing a result.'
        )
      )
      pendingCalls.delete(reqId)
      log.warn({ reqId, extId: extensionId }, 'Rejected pending call from disconnected extension.')
    }
  }
}

export function cleanupAll(): void {
  pendingCalls.forEach((call, reqId) => {
    const { timer, reject: fail } = call
    clearTimeout(timer)
    fail(new Error('Hub is shutting down.'))
    log.debug({ reqId }, 'Rejected pending tool call due to shutdown.')
  })
  pendingCalls.clear()
}
