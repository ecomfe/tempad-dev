import type {
  GetCodeParametersInput,
  GetCodeReadResult,
  GetScreenshotParametersInput,
  GetScreenshotReadResult,
  GetStructureParametersInput,
  GetStructureResult,
  GetTokenDefsParametersInput,
  GetTokenDefsResult
} from '@tempad-dev/shared'

import {
  TEMPAD_MCP_ERROR_CODES,
  buildGetCodeToolResult,
  buildGetScreenshotToolResult
} from '@tempad-dev/shared'

import type { GetCodeRuntimeOptions } from './tools/code'

import { coerceToolErrorPayload, createCodedError } from './errors'
import { readNodeBatch, resolveReadTargets, singleReadTarget } from './node-reads'
import { handleApplyCanvas } from './tools/canvas'
import { pageById, pageSnapshot, pagesByKey } from './tools/canvas/identity'
import { handleGetCode as runGetCode } from './tools/code'
import { createGetCodeCacheContext } from './tools/code/cache'
import { handleGetDesignSystem } from './tools/design-system'
import { handleGetScreenshot as runGetScreenshot } from './tools/screenshot'
import { handleGetStructure as runGetStructure } from './tools/structure'
import { handleGetTokenDefs as runGetTokenDefs } from './tools/token'

export type WindowGetCodeParametersInput = GetCodeParametersInput & {
  _unbounded?: boolean
}

async function handleGetCode(
  args?: GetCodeParametersInput,
  runtimeOptions?: GetCodeRuntimeOptions
): Promise<GetCodeReadResult> {
  const { targets, batch } = resolveReadTargets(args)
  const { preferredLang, resolveTokens, vectorMode } = args ?? {}
  if (!batch)
    return runGetCode(
      [singleReadTarget(targets)],
      preferredLang,
      resolveTokens,
      vectorMode,
      runtimeOptions
    )
  const cache = createGetCodeCacheContext()
  return readNodeBatch(
    targets,
    (node, formatResult) =>
      runGetCode([node], preferredLang, resolveTokens, vectorMode, {
        ...runtimeOptions,
        cache,
        formatResult
      }),
    buildGetCodeToolResult
  )
}

async function handleWindowGetCode(
  args?: WindowGetCodeParametersInput
): Promise<GetCodeReadResult> {
  const { _unbounded, ...rest } = args ?? {}
  return handleGetCode(rest, {
    unbounded: _unbounded
  })
}

async function handleGetTokenDefs(args?: GetTokenDefsParametersInput): Promise<GetTokenDefsResult> {
  const { names, includeAllModes } = args ?? {}
  if (!names?.length) {
    throw new Error('names is required and must include at least one canonical token name.')
  }
  return runGetTokenDefs(names, includeAllModes)
}

async function handleGetScreenshot(
  args?: GetScreenshotParametersInput
): Promise<GetScreenshotReadResult> {
  const { targets, batch } = resolveReadTargets(args)
  if (!batch) return runGetScreenshot(singleReadTarget(targets))
  return readNodeBatch(targets, (node) => runGetScreenshot(node), buildGetScreenshotToolResult)
}

async function handleGetStructure(args?: GetStructureParametersInput): Promise<GetStructureResult> {
  const { pageId, pageKey, options } = args ?? {}
  const depth = options?.depth
  if (!pageId && !pageKey) {
    const { targets, batch } = resolveReadTargets(args)
    if (!batch) return runGetStructure([singleReadTarget(targets)], depth, options?.native)
    const roots = targets.flatMap((target) => (target.node ? [target.node] : []))
    const errors = targets.flatMap((target) =>
      target.error ? [{ nodeId: target.nodeId, error: coerceToolErrorPayload(target.error) }] : []
    )
    return runGetStructure(roots, depth, options?.native, undefined, errors)
  }

  const idMatch = pageId ? pageById(pageId) : undefined
  const keyMatches = pageKey ? pagesByKey(pageKey) : []
  if (keyMatches.length > 1) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
      `Page key "${pageKey}" identifies more than one local page.`
    )
  }
  const keyMatch = keyMatches[0]
  if (idMatch && keyMatch && idMatch.id !== keyMatch.id) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
      `Page key "${pageKey}" does not identify page "${pageId}".`
    )
  }
  const page = idMatch ?? keyMatch
  if (!page) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
      pageId ? `Page "${pageId}" does not exist.` : `Page key "${pageKey}" does not exist.`
    )
  }
  if (page.id !== figma.currentPage.id) await page.loadAsync()
  return runGetStructure([...page.children], depth, options?.native, pageSnapshot(page))
}

export const MCP_TOOL_HANDLERS = {
  apply_canvas: handleApplyCanvas,
  get_code: handleGetCode,
  get_design_system: handleGetDesignSystem,
  get_token_defs: handleGetTokenDefs,
  get_screenshot: handleGetScreenshot,
  get_structure: handleGetStructure
}

export type MCPHandlers = typeof MCP_TOOL_HANDLERS

export type TempadWindowHandlers = Omit<MCPHandlers, 'get_code'> & {
  get_code: (args?: WindowGetCodeParametersInput) => Promise<GetCodeReadResult>
}

declare global {
  interface Window {
    tempadTools?: Partial<TempadWindowHandlers>
  }
}

export const WINDOW_TEMPAD_TOOL_HANDLERS: TempadWindowHandlers = {
  ...MCP_TOOL_HANDLERS,
  get_code: handleWindowGetCode
}

function isMcpToolName(name: string): name is keyof MCPHandlers {
  return Object.hasOwn(MCP_TOOL_HANDLERS, name)
}

export async function runMcpTool(name: string, args: unknown): Promise<unknown> {
  if (!isMcpToolName(name)) {
    throw new Error(`No handler registered for tool "${name}".`)
  }
  const handler = MCP_TOOL_HANDLERS[name] as (args?: unknown) => Promise<unknown>
  return handler(args)
}

function exposeToolsOnWindow(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.tempadTools = {
    ...(window.tempadTools ?? {}),
    ...WINDOW_TEMPAD_TOOL_HANDLERS
  }
}

exposeToolsOnWindow()
