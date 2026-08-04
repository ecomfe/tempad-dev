import type { ZodError } from 'zod'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { createCodedError } from '../../errors'

const MAX_SCHEMA_ISSUES = 4
const MAX_SCHEMA_MESSAGE_CHARS = 240
const READ_ONLY_ERROR_PATTERN = /\b(?:read|view)[ -]?only\b|\bedit access\b|\bpermission to edit\b/i

export function formatSchemaError(error: ZodError): string {
  const issues = error.issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => {
    const message =
      issue.message.length <= MAX_SCHEMA_MESSAGE_CHARS
        ? issue.message
        : `${issue.message.slice(0, MAX_SCHEMA_MESSAGE_CHARS - 3)}...`
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
    !(error instanceof Error) ||
    'code' in error ||
    !READ_ONLY_ERROR_PATTERN.test(error.message)
  ) {
    return null
  }
  return createCodedError(
    TEMPAD_MCP_ERROR_CODES.CANVAS_READ_ONLY,
    'Canvas authoring requires edit access to the current Figma Design file.'
  )
}
