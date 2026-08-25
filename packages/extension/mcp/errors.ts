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

function getErrorCode(value: unknown): TempadMcpErrorCode | undefined {
  return value && typeof value === 'object' && 'code' in value && isTempadMcpErrorCode(value.code)
    ? value.code
    : undefined
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
    const code = getErrorCode(error)
    return code ? { message, code } : { message }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    const code = getErrorCode(error)
    if (code) {
      return { message: error.message, code }
    }
    return { message: error.message }
  }

  return { message: String(error ?? 'Unknown error') }
}
