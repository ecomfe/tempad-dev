import type { TempadMcpErrorCode } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

export type ToolErrorPayload = {
  message: string
  code?: TempadMcpErrorCode
}

const TEMPAD_MCP_ERROR_CODE_SET = new Set<string>(Object.values(TEMPAD_MCP_ERROR_CODES))

function isTempadMcpErrorCode(value: unknown): value is TempadMcpErrorCode {
  return typeof value === 'string' && TEMPAD_MCP_ERROR_CODE_SET.has(value)
}

function hasCode(value: unknown): value is { code?: unknown } {
  return !!value && typeof value === 'object' && 'code' in value
}

function hasMessage(value: unknown): value is { message?: unknown; code?: unknown } {
  return !!value && typeof value === 'object'
}

export function createCodedError(
  code: TempadMcpErrorCode,
  message: string
): Error & { code: TempadMcpErrorCode } {
  return Object.assign(new Error(message), { code })
}

export function coerceToolErrorPayload(error: unknown): ToolErrorPayload {
  if (error instanceof Error) {
    const message = error.message || 'Unknown error'
    const code = hasCode(error) && isTempadMcpErrorCode(error.code) ? error.code : undefined
    return code ? { message, code } : { message }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (hasMessage(error) && typeof error.message === 'string' && error.message.trim()) {
    const code = isTempadMcpErrorCode(error.code) ? error.code : undefined
    if (code) {
      return { message: error.message, code }
    }
    return { message: error.message }
  }

  return { message: String(error ?? 'Unknown error') }
}
