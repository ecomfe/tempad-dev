import { createWorkerRequester } from '@/codegen/requester'

import type {
  TransformVariableReference,
  TransformVariableRequestPayload,
  TransformVariableResponsePayload
} from './worker'

import TransformerWorker from './worker?worker&inline'

export type VariableReference = TransformVariableReference & {
  nodeId: string
  property: string
}

export type TransformVariableOptions = {
  useRem: boolean
  rootFontSize: number
  scale: number
}

const requestTransformVariables = createWorkerRequester<
  TransformVariableRequestPayload,
  TransformVariableResponsePayload
>(TransformerWorker)

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

  const { results } = await requestTransformVariables({
    pluginCode,
    references,
    options
  })
  return results
}

function formatVariableExpression(ref: TransformVariableReference): string {
  return `var(--${ref.name}${ref.value ? `, ${ref.value}` : ''})`
}
