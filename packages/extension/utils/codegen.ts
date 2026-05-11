import type {
  RequestPayload,
  ResponsePayload,
  SerializeOptions,
  VariableDisplayMode
} from '@/types/codegen'
import type { DesignComponent } from '@/types/plugin'

import { createWorkerRequester } from '@/codegen/requester'
import Codegen from '@/codegen/worker?worker&inline'

import { getDesignComponent } from './component'
import { resolveStylesFromNode } from './figma-style/style-resolver'
import { formatNodeStyleForCssVars, formatNodeStyleForUi } from './variable-output'

export async function codegen(
  style: Record<string, string>,
  component: DesignComponent | null,
  options: SerializeOptions,
  pluginCode?: string,
  returnDevComponent?: boolean,
  cssVarStyle?: Record<string, string>
): Promise<ResponsePayload> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return await request({
    style,
    ...(cssVarStyle ? { cssVarStyle } : {}),
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
  opts?: { returnDevComponent?: boolean; variableDisplay?: VariableDisplayMode }
): Promise<ResponsePayload> {
  let style = await node.getCSSAsync()

  // Resolve fill and stroke styles that use CSS variables
  style = await resolveStylesFromNode(style, node)
  const cssVarStyle = pluginCode ? formatNodeStyleForCssVars(style, node) : undefined
  const uiStyle = formatNodeStyleForUi(style, node)

  const component = getDesignComponent(node)
  const serializeOptions: SerializeOptions = {
    ...workerUnitOptions(config),
    variableDisplay: opts?.variableDisplay
  }

  return await codegen(
    uiStyle,
    component,
    serializeOptions,
    pluginCode,
    opts?.returnDevComponent,
    cssVarStyle
  )
}
