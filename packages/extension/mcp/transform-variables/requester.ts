import { PLUGIN_SANDBOX_WORKER } from '@/plugin-sandbox/protocol'
import { requestPluginSandbox } from '@/plugin-sandbox/requester'
import { validateTransformVariableResponse } from '@/plugin-sandbox/validation'

import type { TransformVariableReference, TransformVariableRequestPayload } from './worker'

export type VariableReference = TransformVariableReference & {
  nodeId: string
  property: string
}

export type TransformVariableOptions = {
  useRem: boolean
  rootFontSize: number
  scale: number
}

export async function runTransformVariableBatch(
  references: TransformVariableReference[],
  options: TransformVariableOptions,
  pluginCode?: string
): Promise<string[]> {
  if (!references.length) {
    return []
  }

  if (!pluginCode) {
    return references.map(formatVariableExpression)
  }

  const response = await requestPluginSandbox<TransformVariableRequestPayload, unknown>(
    PLUGIN_SANDBOX_WORKER.transformVariable,
    {
      pluginCode,
      references,
      options
    }
  )
  const { results } = validateTransformVariableResponse(response)
  return results
}

function formatVariableExpression(ref: TransformVariableReference): string {
  return `var(--${ref.name}${ref.value ? `, ${ref.value}` : ''})`
}
