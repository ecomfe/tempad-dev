import { generateCodeBlocksForNode } from '@/utils/codegen'
import { activePlugin, options } from '@/ui/state'

import type { GetCodeResult } from '@/mcp/src/tools'
import type { CodegenConfig } from '@/utils/codegen'
import type { CodeBlock } from '@/types/codegen'

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

export async function handleGetCode(node: SceneNode): Promise<GetCodeResult> {
  const blocks = await generateCodeBlocksForNode(node, codegenConfig(), activePlugin.value?.code)
  if (!blocks.length) throw new Error('No code available for the current selection.')

  const preferred = pickPreferredBlock(blocks)
  const lang: GetCodeResult['lang'] = preferred.lang === 'vue' ? 'vue' : 'jsx'

  return { lang, code: preferred.code }
}
