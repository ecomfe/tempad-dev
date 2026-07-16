import type { CodeBlock, ResponsePayload } from '@/types/codegen'
import type { DevComponent } from '@/types/plugin'

import { generateCodeBlocksForNode, generateCodeBlocksForNodes } from '@/utils/codegen'

import type { CodeLanguage, RenderContext } from './types'

export type PluginComponent = { component?: DevComponent; code?: string; lang?: CodeLanguage }

export async function renderPluginComponent(
  node: InstanceNode,
  ctx: RenderContext
): Promise<PluginComponent | null> {
  if (!ctx.pluginCode) return null
  return resolvePluginComponent(node, ctx.config, ctx.pluginCode, ctx.preferredLang)
}

export async function resolvePluginComponent(
  node: InstanceNode,
  config: RenderContext['config'],
  pluginCode: string,
  preferredLang?: CodeLanguage
): Promise<PluginComponent | null> {
  const response = await generateCodeBlocksForNode(node, config, pluginCode, {
    returnDevComponent: true
  })
  return resolvePluginComponentResponse(response, preferredLang)
}

export async function resolvePluginComponents(
  nodes: InstanceNode[],
  config: RenderContext['config'],
  pluginCode: string,
  preferredLang?: CodeLanguage
): Promise<Array<PluginComponent | null>> {
  const responses = await generateCodeBlocksForNodes(nodes, config, pluginCode, {
    returnDevComponent: true
  })
  return responses.map((response) => resolvePluginComponentResponse(response, preferredLang))
}

function resolvePluginComponentResponse(
  { codeBlocks, devComponent }: ResponsePayload,
  preferredLang?: CodeLanguage
): PluginComponent | null {
  const detectedLang = detectLang(codeBlocks, preferredLang)
  const componentBlock = findComponentBlock(codeBlocks, detectedLang)
  const code = componentBlock?.code.trim()
  if (!code && !devComponent) return null
  return { component: devComponent ?? undefined, code: code ?? undefined, lang: detectedLang }
}

function detectLang(blocks: CodeBlock[], preferredLang?: CodeLanguage): CodeLanguage | undefined {
  if (preferredLang) return preferredLang
  const normalized = blocks.map((b) => normalizeBlockLang(b.lang))
  if (normalized.includes('vue')) return 'vue'
  if (normalized.includes('jsx')) return 'jsx'
  return undefined
}

function normalizeBlockLang(lang?: string): CodeLanguage | undefined {
  if (!lang || lang === 'jsx' || lang === 'vue') return lang as CodeLanguage
  if (lang === 'tsx') return 'jsx'
  return 'jsx'
}

function findComponentBlock(
  blocks: CodeBlock[],
  preferredLang?: CodeLanguage
): CodeBlock | undefined {
  const comps = blocks.filter((b) => b.name === 'component')
  if (preferredLang) return comps.find((b) => normalizeBlockLang(b.lang) === preferredLang)
  return (
    comps.find((b) => normalizeBlockLang(b.lang) === 'vue') ??
    comps.find((b) => normalizeBlockLang(b.lang) === 'jsx')
  )
}
