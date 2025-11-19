import type { RequestPayload, ResponsePayload, SerializeOptions, CodeBlock } from '@/types/codegen'
import type { DesignComponent } from '@/types/plugin'

import Codegen from '@/codegen/codegen?worker&inline'
import { createWorkerRequester } from '@/codegen/worker'
import { getDesignComponent } from './component'

export async function codegen(
  style: Record<string, string>,
  component: DesignComponent | null,
  options: SerializeOptions,
  pluginCode?: string
): Promise<ResponsePayload> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return await request({
    style,
    component: component ?? undefined,
    options,
    pluginCode
  })
}

export type CodegenConfig = {
  cssUnit: 'px' | 'rem'
  rootFontSize: number
  scale: number
}

export async function generateCodeBlocksForNode(
  node: SceneNode,
  config: CodegenConfig,
  pluginCode?: string
): Promise<CodeBlock[]> {
  const style = await node.getCSSAsync()
  const component = getDesignComponent(node)
  const serializeOptions: SerializeOptions = {
    useRem: config.cssUnit === 'rem',
    rootFontSize: config.rootFontSize,
    scale: config.scale
  }

  const { codeBlocks } = await codegen(style, component, serializeOptions, pluginCode)
  return codeBlocks
}
