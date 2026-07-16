import type { TransformVariableResponsePayload } from '@/mcp/transform-variables/worker'
import type { ResponsePayload } from '@/types/codegen'
import type { DevComponent, SupportedLang } from '@/types/plugin'

import { PluginSandboxError } from './client'

const supportedLanguages = new Set<SupportedLang>([
  'text',
  'tsx',
  'jsx',
  'ts',
  'js',
  'vue',
  'html',
  'css',
  'sass',
  'scss',
  'less',
  'stylus',
  'json'
])

export function validateCodegenResponse(value: unknown): ResponsePayload {
  if (!isRecord(value) || !Array.isArray(value.codeBlocks)) return invalid('codegen response')
  if (value.pluginName !== undefined && typeof value.pluginName !== 'string') {
    return invalid('plugin name')
  }

  for (const block of value.codeBlocks) {
    if (
      !isRecord(block) ||
      typeof block.name !== 'string' ||
      typeof block.title !== 'string' ||
      typeof block.code !== 'string' ||
      !supportedLanguages.has(block.lang as SupportedLang)
    ) {
      return invalid('code block')
    }
  }

  if (value.devComponent !== undefined && !isDevComponent(value.devComponent)) {
    return invalid('development component')
  }
  return value as unknown as ResponsePayload
}

export function validateCodegenBatchResponse(value: unknown): ResponsePayload[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return invalid('codegen batch response')
  }
  return value.results.map(validateCodegenResponse)
}

export function validateTransformVariableResponse(
  value: unknown
): TransformVariableResponsePayload {
  if (
    !isRecord(value) ||
    !Array.isArray(value.results) ||
    value.results.some((result) => typeof result !== 'string')
  ) {
    return invalid('variable transform response')
  }
  return { results: value.results }
}

function isDevComponent(value: unknown): value is DevComponent {
  const stack = [value]
  while (stack.length) {
    const current = stack.pop()
    if (
      !isRecord(current) ||
      typeof current.name !== 'string' ||
      !isRecord(current.props) ||
      !Array.isArray(current.children)
    ) {
      return false
    }
    for (const child of current.children) {
      if (typeof child !== 'string') stack.push(child)
    }
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(label: string): never {
  throw new PluginSandboxError('protocol-error', `Invalid plugin ${label}.`)
}
