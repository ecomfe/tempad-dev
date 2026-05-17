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
import { formatNodeStyleForPluginVariables, formatNodeStyleForUi } from './variable-output'

export async function codegen(
  style: Record<string, string>,
  component: DesignComponent | null,
  options: SerializeOptions,
  pluginCode?: string,
  returnDevComponent?: boolean,
  pluginVariableStyle?: Record<string, string>,
  variableSyntax?: Record<string, string>
): Promise<ResponsePayload> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return await request({
    style,
    ...(pluginVariableStyle ? { pluginVariableStyle } : {}),
    ...(variableSyntax && Object.keys(variableSyntax).length ? { variableSyntax } : {}),
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
  const rawStyle = await node.getCSSAsync()

  // UI and plugin codegen may emit style-name vars when one CSS value safely represents the style.
  const style = await resolveStylesFromNode(rawStyle, node, undefined, {
    emitSafeStyleNameVars: true
  })
  const pluginVariableStyle = pluginCode
    ? formatNodeStyleForPluginVariables(style, node)
    : undefined
  const ui = formatNodeStyleForUi(style, node)

  const component = getDesignComponent(node)
  const serializeOptions: SerializeOptions = {
    ...workerUnitOptions(config),
    variableDisplay: opts?.variableDisplay
  }

  return await codegen(
    ui.style,
    component,
    serializeOptions,
    pluginCode,
    opts?.returnDevComponent,
    pluginVariableStyle,
    ui.variableSyntax
  )
}
