import {
  TEMPAD_MCP_ERROR_CODES,
  type GetCodeParametersInput,
  type GetCodeResult,
  type GetScreenshotParametersInput,
  type GetScreenshotResult,
  type GetStructureParametersInput,
  type GetStructureResult,
  type GetTokenDefsParametersInput,
  type GetTokenDefsResult
} from '@tempad-dev/mcp-shared'

import { selection } from '@/ui/state'

import { createCodedError } from './errors'
import { handleGetCode as runGetCode } from './tools/code'
import { handleGetScreenshot as runGetScreenshot } from './tools/screenshot'
import { handleGetStructure as runGetStructure } from './tools/structure'
import { handleGetTokenDefs as runGetTokenDefs } from './tools/token'

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return !!node && 'visible' in node && 'type' in node
}

function resolveSingleNode(nodeId?: string): SceneNode {
  if (nodeId) {
    const node = figma.getNodeById(nodeId)
    if (!isSceneNode(node) || !node.visible) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
        'No visible node found for the provided nodeId.'
      )
    }
    return node
  }

  if (selection.value.length !== 1 || !selection.value[0].visible) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION,
      'Select exactly one visible node (or provide nodeId) to proceed.'
    )
  }

  return selection.value[0]
}

async function handleGetCode(args?: GetCodeParametersInput): Promise<GetCodeResult> {
  const node = resolveSingleNode(args?.nodeId)
  const { preferredLang, resolveTokens } = args ?? {}
  return runGetCode([node], preferredLang, resolveTokens)
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
  return runGetStructure([root], depth)
}

export type MCPHandlers = {
  get_code: (args?: GetCodeParametersInput) => Promise<GetCodeResult>
  get_token_defs: (args?: GetTokenDefsParametersInput) => Promise<GetTokenDefsResult>
  get_screenshot: (args?: GetScreenshotParametersInput) => Promise<GetScreenshotResult>
  get_structure: (args?: GetStructureParametersInput) => Promise<GetStructureResult>
}

export const MCP_TOOL_HANDLERS: MCPHandlers = {
  get_code: handleGetCode,
  get_token_defs: handleGetTokenDefs,
  get_screenshot: handleGetScreenshot,
  get_structure: handleGetStructure
}

export type McpToolName = keyof MCPHandlers
export type McpToolArgs<T extends McpToolName> = Parameters<MCPHandlers[T]>[0]

function exposeToolsOnWindow(): void {
  if (typeof window === 'undefined') {
    return
  }
  const target = window as Window & { tempadTools?: Partial<MCPHandlers> }
  target.tempadTools = {
    ...(target.tempadTools ?? {}),
    ...MCP_TOOL_HANDLERS
  }
}

exposeToolsOnWindow()
