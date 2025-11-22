import { generateCodeBlocksForNode } from '@/utils/codegen'
import { activePlugin, options, selection } from '@/ui/state'

import type {
  GetCodeParametersInput,
  GetCodeResult,
  GetStructureParametersInput,
  GetStructureResult,
  GetScreenshotParametersInput,
  GetScreenshotResult,
  GetTokenDefsParametersInput,
  GetTokenDefsResult
} from '@/mcp/src/tools'
import type { CodegenConfig } from '@/utils/codegen'
import type { CodeBlock } from '@/types/codegen'
import type { SelectionNode } from '@/ui/state'

const DEFAULT_LANG: GetCodeResult['lang'] = 'jsx'

function isSceneNode(node: BaseNode | null): node is SelectionNode {
  return !!node && 'visible' in node && 'type' in node
}

function resolveNodes(nodeIds?: string[]): SelectionNode[] {
  if (nodeIds && nodeIds.length > 0) {
    const nodes = nodeIds
      .map((id) => figma.getNodeById(id))
      .filter(isSceneNode)
      .filter((node) => node.visible)

    if (nodes.length === 0) throw new Error('No valid nodes found for provided nodeIds.')
    return nodes
  }

  if (selection.value.length === 0) throw new Error('Select at least one node to proceed.')
  return selection.value.slice()
}

function pickPreferredBlock(blocks: CodeBlock[]): CodeBlock {
  const component = blocks.find(({ name }) => name === 'component')
  if (component) return component

  const vue = blocks.find(({ lang }) => lang === 'vue')
  if (vue) return vue

  const jsx = blocks.find(({ lang }) => lang === 'jsx' || lang === 'tsx')
  if (jsx) return jsx

  return blocks[0]
}

function codegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}

export async function runNodeCodegen(
  node: SelectionNode,
  config: CodegenConfig,
  pluginCode?: string
): Promise<CodeBlock[]> {
  return generateCodeBlocksForNode(node, config, pluginCode)
}

export async function runTreeCodegen(): Promise<never> {
  throw new Error('Tree codegen worker is not implemented yet.')
}

export async function runTokenTransforms(): Promise<never> {
  throw new Error('Token transform worker is not implemented yet.')
}

async function handleGetCode(args?: GetCodeParametersInput): Promise<GetCodeResult> {
  const nodes = resolveNodes(args?.nodeIds)
  if (nodes.length !== 1) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  const blocks = await runNodeCodegen(nodes[0], codegenConfig(), activePlugin.value?.code)
  if (!blocks.length) throw new Error('No code available for the current selection.')

  const preferred = pickPreferredBlock(blocks)
  const lang = preferred.lang ?? DEFAULT_LANG

  return { lang, code: preferred.code }
}

async function handleGetTokenDefs(
  args?: GetTokenDefsParametersInput
): Promise<GetTokenDefsResult> {
  resolveNodes(args?.nodeIds) // validation hook; real extraction to be added.
  return { tokens: [] }
}

async function handleGetScreenshot(
  _args?: GetScreenshotParametersInput
): Promise<GetScreenshotResult> {
  throw new Error('get_screenshot is not implemented yet.')
}

async function handleGetStructure(
  args?: GetStructureParametersInput
): Promise<GetStructureResult> {
  resolveNodes(args?.nodeIds) // validation hook; real traversal to be added.
  return { roots: [] }
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
