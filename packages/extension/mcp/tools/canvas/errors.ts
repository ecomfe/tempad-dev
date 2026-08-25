import type { ZodError, ZodIssue } from 'zod'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { createCodedError } from '../../errors'

const MAX_SCHEMA_ISSUES = 4
const MAX_SCHEMA_MESSAGE_CHARS = 384
const READ_ONLY_ERROR_PATTERN = /\b(?:read|view)[ -]?only\b|\bedit access\b|\bpermission to edit\b/i

type SchemaIssue = {
  issue: ZodIssue
  path: PropertyKey[]
  groupable: boolean
}

type SchemaIssueGroup = SchemaIssue & { count: number; source: string }

export function errorMessage(error: unknown, fallback = ''): string {
  if (typeof error === 'string') return error || fallback
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export function formatSchemaError(error: ZodError): string {
  const expanded = error.issues.flatMap((issue) => expandSchemaIssue(issue))
  const groups: SchemaIssueGroup[] = []
  const groupedBySource = new Map<string, SchemaIssueGroup>()

  for (const item of expanded) {
    const source = schemaIssueSource(item.issue)
    const existing = item.groupable ? groupedBySource.get(source) : undefined
    if (existing) {
      existing.count += 1
      continue
    }
    const group = { ...item, count: 1, source }
    groups.push(group)
    if (item.groupable) groupedBySource.set(source, group)
  }

  const visible = groups.slice(0, MAX_SCHEMA_ISSUES)
  const issues = visible.map(({ count, path, source }) => {
    const message =
      source.length <= MAX_SCHEMA_MESSAGE_CHARS
        ? source
        : `${source.slice(0, MAX_SCHEMA_MESSAGE_CHARS - 3)}...`
    const repeats = count > 1 ? ` (${count - 1} similar validation issues)` : ''
    return `${formatPath(path)}: ${message}${repeats}`
  })
  const omitted = expanded.length - visible.reduce((count, issue) => count + issue.count, 0)
  if (omitted > 0)
    issues.push(`${omitted} more validation issue${omitted === 1 ? '' : 's'} omitted.`)
  return issues.join('\n') || 'Canvas input is invalid.'
}

function expandSchemaIssue(
  issue: ZodIssue,
  prefix: PropertyKey[] = [],
  groupable = false
): SchemaIssue[] {
  const path = [...prefix, ...issue.path]
  if (issue.code !== 'invalid_union') return [{ issue, path, groupable }]

  const branches = issue.errors.map((branch) =>
    branch.flatMap((nested) => expandSchemaIssue(nested, path, true))
  )
  return branches.reduce<SchemaIssue[]>((best, branch) => {
    if (!best.length || branch.length < best.length) return branch
    if (branch.length > best.length) return best
    const branchDepth = branch.reduce((sum, item) => sum + item.path.length, 0)
    const bestDepth = best.reduce((sum, item) => sum + item.path.length, 0)
    return branchDepth > bestDepth ? branch : best
  }, [])
}

function schemaIssueSource(issue: ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    return `Unrecognized key${issue.keys.length === 1 ? '' : 's'}: ${issue.keys
      .map((key) => JSON.stringify(key))
      .join(', ')}`
  }
  if (issue.code === 'invalid_type' && issue.message === 'Invalid input') {
    return `Expected ${issue.expected}.`
  }
  return issue.message
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
