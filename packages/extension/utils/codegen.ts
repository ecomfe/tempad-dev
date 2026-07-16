import type {
  CodegenBatchRequestPayload,
  CodegenJobPayload,
  RequestPayload,
  ResponsePayload,
  SerializeOptions,
  VariableDisplayMode
} from '@/types/codegen'
import type { DesignComponent } from '@/types/plugin'

import { PluginSandboxError } from '@/plugin-sandbox/client'
import { PLUGIN_SANDBOX_WORKER } from '@/plugin-sandbox/protocol'
import { requestPluginSandbox } from '@/plugin-sandbox/requester'
import { validateCodegenBatchResponse, validateCodegenResponse } from '@/plugin-sandbox/validation'

import { getDesignComponent } from './component'
import { resolveStylesFromNode } from './figma-style/style-resolver'
import { formatNodeStyleForPluginVariables, formatNodeStyleForUi } from './variable-output'

const CODEGEN_PREPARE_CONCURRENCY = 4
const CODEGEN_BATCH_CONCURRENCY = 4
const CODEGEN_BATCH_MAX_JOBS = 32
const CODEGEN_JOB_WINDOW = CODEGEN_BATCH_CONCURRENCY * CODEGEN_BATCH_MAX_JOBS

export async function codegen(
  style: Record<string, string>,
  component: DesignComponent | null,
  options: SerializeOptions,
  pluginCode?: string,
  returnDevComponent?: boolean,
  pluginVariableStyle?: Record<string, string>,
  variableSyntax?: Record<string, string>
): Promise<ResponsePayload> {
  return requestCodegen(
    {
      style,
      ...(pluginVariableStyle ? { pluginVariableStyle } : {}),
      ...(variableSyntax && Object.keys(variableSyntax).length ? { variableSyntax } : {}),
      component: component ?? undefined,
      options,
      returnDevComponent
    },
    pluginCode
  )
}

async function requestCodegen(
  job: CodegenJobPayload,
  pluginCode?: string
): Promise<ResponsePayload> {
  const response = await requestPluginSandbox<RequestPayload, unknown>(
    PLUGIN_SANDBOX_WORKER.codegen,
    {
      ...job,
      pluginCode
    }
  )
  return validateCodegenResponse(response)
}

async function codegenBatch(
  jobs: CodegenJobPayload[],
  pluginCode?: string
): Promise<ResponsePayload[]> {
  const response = await requestPluginSandbox<CodegenBatchRequestPayload, unknown>(
    PLUGIN_SANDBOX_WORKER.codegen,
    { jobs, pluginCode }
  )
  const results = validateCodegenBatchResponse(response)
  if (results.length !== jobs.length) {
    throw new PluginSandboxError(
      'protocol-error',
      `Plugin returned ${results.length} batch results for ${jobs.length} jobs.`
    )
  }
  return results
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
  const job = await prepareCodegenJobForNode(node, config, pluginCode, opts)
  return await requestCodegen(job, pluginCode)
}

export async function generateCodeBlocksForNodes(
  nodes: SceneNode[],
  config: CodegenConfig,
  pluginCode: string,
  opts?: { returnDevComponent?: boolean; variableDisplay?: VariableDisplayMode }
): Promise<ResponsePayload[]> {
  const results: ResponsePayload[] = []
  for (const window of chunk(nodes, CODEGEN_JOB_WINDOW)) {
    const jobs: CodegenJobPayload[] = []
    for (const batch of chunk(window, CODEGEN_PREPARE_CONCURRENCY)) {
      jobs.push(
        ...(await Promise.all(
          batch.map((node) => prepareCodegenJobForNode(node, config, pluginCode, opts))
        ))
      )
    }

    const batches = chunk(jobs, CODEGEN_BATCH_MAX_JOBS)
    for (const group of chunk(batches, CODEGEN_BATCH_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        group.map((batch) => codegenBatchWithRecovery(batch, pluginCode))
      )
      for (const result of settled) {
        if (result.status === 'rejected') throw result.reason
        results.push(...result.value)
      }
    }
  }
  return results
}

async function codegenBatchWithRecovery(
  jobs: CodegenJobPayload[],
  pluginCode: string
): Promise<ResponsePayload[]> {
  try {
    return await codegenBatch(jobs, pluginCode)
  } catch (error) {
    if (
      jobs.length <= 1 ||
      !(error instanceof PluginSandboxError) ||
      (error.code !== 'payload-too-large' && error.code !== 'timeout')
    ) {
      throw error
    }
    const midpoint = Math.ceil(jobs.length / 2)
    return [
      ...(await codegenBatchWithRecovery(jobs.slice(0, midpoint), pluginCode)),
      ...(await codegenBatchWithRecovery(jobs.slice(midpoint), pluginCode))
    ]
  }
}

async function prepareCodegenJobForNode(
  node: SceneNode,
  config: CodegenConfig,
  pluginCode?: string,
  opts?: { returnDevComponent?: boolean; variableDisplay?: VariableDisplayMode }
): Promise<CodegenJobPayload> {
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

  return {
    style: ui.style,
    ...(pluginVariableStyle ? { pluginVariableStyle } : {}),
    ...(ui.variableSyntax && Object.keys(ui.variableSyntax).length
      ? { variableSyntax: ui.variableSyntax }
      : {}),
    component: component ?? undefined,
    options: serializeOptions,
    returnDevComponent: opts?.returnDevComponent
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  )
}
