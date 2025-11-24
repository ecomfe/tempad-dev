import { selection } from '@/ui/state'
import { handleGetCode as runGetCode } from './tools/code'
import { handleGetScreenshot as runGetScreenshot } from './tools/screenshot'
import { handleGetStructure as runGetStructure } from './tools/structure'
import { handleGetTokenDefs as runGetTokenDefs } from './tools/token-defs'

import type {
  GetCodeParametersInput,
  GetCodeResult,
  GetStructureParametersInput,
  GetStructureResult,
  GetScreenshotParametersInput,
  GetScreenshotResult,
  GetTokenDefsParametersInput,
  GetTokenDefsResult
} from '@/mcp-server/src/tools'

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return !!node && 'visible' in node && 'type' in node
}

function resolveNodes(nodeIds?: string[]): SceneNode[] {
  if (nodeIds?.length) {
    const nodes = nodeIds
      .map((id) => figma.getNodeById(id))
      .filter(isSceneNode)
      .filter((node) => node.visible)

    if (nodes.length === 0) throw new Error('No valid nodes found for provided nodeIds.')
    return nodes
  }

  if (selection.value.length === 0) throw new Error('Select at least one node to proceed.')
  return [...selection.value]
}

async function handleGetCode(args?: GetCodeParametersInput): Promise<GetCodeResult> {
  const nodes = resolveNodes(args?.nodeIds)
  const { preferredLang } = args ?? {}
  return runGetCode(nodes, preferredLang)
}

async function handleGetTokenDefs(args?: GetTokenDefsParametersInput): Promise<GetTokenDefsResult> {
  const nodes = resolveNodes(args?.nodeIds)
  return runGetTokenDefs(nodes)
}

async function handleGetScreenshot(
  args?: GetScreenshotParametersInput
): Promise<GetScreenshotResult> {
  const nodes = args?.nodeId ? resolveNodes([args.nodeId]) : resolveNodes()
  if (nodes.length !== 1) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  return runGetScreenshot(nodes[0])
}

async function handleGetStructure(args?: GetStructureParametersInput): Promise<GetStructureResult> {
  const { nodeIds, options } = args ?? {}
  const roots = resolveNodes(nodeIds)
  const depth = options?.depth
  return runGetStructure(roots, depth)
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
