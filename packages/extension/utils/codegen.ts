import type { RequestPayload, ResponsePayload, SerializeOptions } from '@/types/codegen'
import type { DesignComponent } from '@/types/plugin'

import { createWorkerRequester } from '@/codegen/requester'
import Codegen from '@/codegen/worker?worker&inline'

import { getDesignComponent } from './component'

export async function codegen(
  style: Record<string, string>,
  component: DesignComponent | null,
  options: SerializeOptions,
  pluginCode?: string,
  returnDevComponent?: boolean
): Promise<ResponsePayload> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return await request({
    style,
    component: component ?? undefined,
    options,
    pluginCode,
    returnDevComponent
  })
}

export type CodegenConfig = {
  cssUnit: 'px' | 'rem'
  rootFontSize: number
  scale: number
}

export function workerUnitOptions(
  config: CodegenConfig
): Pick<SerializeOptions, 'useRem' | 'rootFontSize' | 'scale'> {
  return {
    useRem: config.cssUnit === 'rem',
    rootFontSize: config.rootFontSize,
    scale: config.scale
  }
}

export async function generateCodeBlocksForNode(
  node: SceneNode,
  config: CodegenConfig,
  pluginCode?: string,
  opts?: { returnDevComponent?: boolean }
): Promise<ResponsePayload> {
  const style = await node.getCSSAsync()
  const component = getDesignComponent(node)
  const serializeOptions: SerializeOptions = workerUnitOptions(config)

  return await codegen(style, component, serializeOptions, pluginCode, opts?.returnDevComponent)
}
