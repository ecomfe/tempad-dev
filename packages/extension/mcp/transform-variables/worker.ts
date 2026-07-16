import type { WorkerRequest, WorkerResponse } from '@/codegen/protocol'
import type { Plugin, TransformOptions } from '@/types/plugin'

import { logger } from '@/utils/log'
import { assertPluginModuleIsSelfContained, evaluate } from '@/utils/module'
import { lockdownWorker } from '@/worker/lockdown'

export type TransformVariableReference = {
  code: string
  name: string
  value?: string
}

export type TransformVariableRequestPayload = {
  pluginCode?: string
  references: TransformVariableReference[]
  options: {
    useRem: boolean
    rootFontSize: number
    scale: number
  }
}

export type TransformVariableResponsePayload = {
  results: string[]
}

type Request = WorkerRequest<TransformVariableRequestPayload>
type Response = WorkerResponse<TransformVariableResponsePayload>

const formatVariable = (ref: TransformVariableReference): string => {
  return `var(--${ref.name}${ref.value ? `, ${ref.value}` : ''})`
}

const postMessage = globalThis.postMessage

function resolveTransformVariable(
  plugin?: Plugin
): NonNullable<TransformOptions['transformVariable']> | undefined {
  if (!plugin) return undefined
  const cssBlock = plugin.code?.css
  if (cssBlock && typeof cssBlock === 'object' && 'transformVariable' in cssBlock) {
    const { transformVariable } = cssBlock
    if (typeof transformVariable === 'function') {
      return transformVariable
    }
  }
  return undefined
}

globalThis.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  const { pluginCode, references, options } = payload

  let transformVariable: NonNullable<TransformOptions['transformVariable']> | undefined

  if (pluginCode) {
    try {
      assertPluginModuleIsSelfContained(pluginCode)
      const exports = await evaluate(pluginCode)
      const plugin = (exports.default || exports.plugin) as Plugin | undefined
      transformVariable = resolveTransformVariable(plugin)
    } catch (error) {
      const message: Response = { id, error }
      postMessage(message)
      return
    }
  }

  const results = references.map((ref) => {
    const { code, name, value } = ref
    if (!transformVariable) {
      return formatVariable(ref)
    }

    try {
      return transformVariable({
        code,
        name,
        value,
        options
      })
    } catch (error) {
      logger.error(error)
      return formatVariable(ref)
    }
  })

  const message: Response = {
    id,
    payload: { results }
  }

  postMessage(message)
}

lockdownWorker('transform-variable')
