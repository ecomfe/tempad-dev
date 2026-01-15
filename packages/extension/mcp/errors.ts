import type { TempadMcpErrorCode } from '@tempad-dev/mcp-shared'

export type ToolErrorPayload = {
  message: string
  code?: TempadMcpErrorCode
}

export function createCodedError(
  code: TempadMcpErrorCode,
  message: string
): Error & { code: TempadMcpErrorCode } {
  const err = new Error(message) as Error & { code: TempadMcpErrorCode }
  err.code = code
  return err
}

export function coerceToolErrorPayload(error: unknown): ToolErrorPayload {
  if (error instanceof Error) {
    const message = error.message || 'Unknown error'
    const rawCode = (error as { code?: unknown }).code
    const code = typeof rawCode === 'string' ? (rawCode as TempadMcpErrorCode) : undefined
    return code ? { message, code } : { message }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (error && typeof error === 'object') {
    const candidate = error as Partial<ToolErrorPayload & Record<string, unknown>>
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      const code =
        typeof candidate.code === 'string' ? (candidate.code as TempadMcpErrorCode) : undefined
      return code ? { message: candidate.message, code } : { message: candidate.message }
    }
  }

  return { message: String(error ?? 'Unknown error') }
}
