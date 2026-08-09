import type {
  GetCodeParametersInput,
  GetCodeResult,
  GetScreenshotParametersInput,
  GetScreenshotResult,
  GetStructureParametersInput,
  GetStructureResult,
  GetTokenDefsParametersInput,
  GetTokenDefsResult
} from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { selection } from '@/ui/state'

import type { GetCodeRuntimeOptions } from './tools/code'

import { createCodedError } from './errors'
import { handleApplyCanvas } from './tools/canvas'
import { handleGetCode as runGetCode } from './tools/code'
import { handleGetDesignSystem } from './tools/design-system'
import { handleGetScreenshot as runGetScreenshot } from './tools/screenshot'
import { handleGetStructure as runGetStructure } from './tools/structure'
import { handleGetTokenDefs as runGetTokenDefs } from './tools/token'

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return !!node && 'visible' in node && 'type' in node
}

function resolveSingleNode(nodeId?: string): SceneNode {
  if (nodeId) {
    const node = figma.getNodeById(nodeId)
    if (!node) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
        `Node "${nodeId}" does not exist in the current document.`
      )
    }
    if (!isSceneNode(node)) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
        `Node "${nodeId}" exists but is not a supported scene node.`
      )
    }
    if (!node.visible) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
        `Node "${nodeId}" exists but is hidden.`
      )
    }
    return node
  }

  const [selectedNode] = selection.value
  if (selection.value.length !== 1 || !selectedNode?.visible) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION,
      'Select exactly one visible node (or provide nodeId) to proceed.'
    )
  }

  return selectedNode
}

export type WindowGetCodeParametersInput = GetCodeParametersInput & {
  _unbounded?: boolean
}

async function handleGetCode(
  args?: GetCodeParametersInput,
  runtimeOptions?: GetCodeRuntimeOptions
): Promise<GetCodeResult> {
  const node = resolveSingleNode(args?.nodeId)
  const { preferredLang, resolveTokens, vectorMode } = args ?? {}
  return runGetCode([node], preferredLang, resolveTokens, vectorMode, runtimeOptions)
}

async function handleWindowGetCode(args?: WindowGetCodeParametersInput): Promise<GetCodeResult> {
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
): Promise<GetScreenshotResult> {
  const node = resolveSingleNode(args?.nodeId)
  return runGetScreenshot(node)
}

async function handleGetStructure(args?: GetStructureParametersInput): Promise<GetStructureResult> {
  const { nodeId, options } = args ?? {}
  const root = resolveSingleNode(nodeId)
  const depth = options?.depth
  return runGetStructure([root], depth, options?.native)
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
  get_code: (args?: WindowGetCodeParametersInput) => Promise<GetCodeResult>
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
