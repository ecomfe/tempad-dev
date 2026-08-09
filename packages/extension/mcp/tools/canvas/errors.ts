import type { ZodError } from 'zod'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { createCodedError } from '../../errors'

const MAX_SCHEMA_ISSUES = 4
const MAX_SCHEMA_MESSAGE_CHARS = 384
const READ_ONLY_ERROR_PATTERN = /\b(?:read|view)[ -]?only\b|\bedit access\b|\bpermission to edit\b/i

export function errorMessage(error: unknown, fallback = ''): string {
  if (typeof error === 'string') return error || fallback
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export function formatSchemaError(error: ZodError): string {
  const issues = error.issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => {
    const source =
      issue.code === 'unrecognized_keys'
        ? `Unrecognized key${issue.keys.length === 1 ? '' : 's'}: ${issue.keys
            .map((key) => JSON.stringify(key))
            .join(', ')}`
        : issue.code === 'invalid_type' && issue.message === 'Invalid input'
          ? `Expected ${issue.expected}.`
          : issue.message
    const message =
      source.length <= MAX_SCHEMA_MESSAGE_CHARS
        ? source
        : `${source.slice(0, MAX_SCHEMA_MESSAGE_CHARS - 3)}...`
    return `${formatPath(issue.path)}: ${message}`
  })
  const omitted = error.issues.length - issues.length
  if (omitted > 0)
    issues.push(`${omitted} more validation issue${omitted === 1 ? '' : 's'} omitted.`)
  return issues.join('\n') || 'Canvas input is invalid.'
}

function formatPath(path: PropertyKey[]): string {
  if (!path.length) return 'input'
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === 'number'
        ? `${result}[${segment}]`
        : result
          ? `${result}.${String(segment)}`
          : String(segment),
    ''
  )
}

export function specError(message: string): never {
  throw createCodedError(TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC, message)
}

export function scopeError(message: string): never {
  throw createCodedError(TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE, message)
}

export function canvasReadOnlyError(error: unknown): Error | null {
  // The Plugin API exposes no file-permission flag, so normalize its native mutation error.
  if (
    !error ||
    (typeof error !== 'string' && typeof error !== 'object') ||
    (typeof error === 'object' && 'code' in error) ||
    !READ_ONLY_ERROR_PATTERN.test(errorMessage(error))
  ) {
    return null
  }
  return createCodedError(
    TEMPAD_MCP_ERROR_CODES.CANVAS_READ_ONLY,
    'Canvas authoring requires edit access to the current Figma Design file.'
  )
}
