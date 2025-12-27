import type { RequestMessage, ResponseMessage } from '@/codegen/requester'
import type { Plugin, TransformOptions } from '@/types/plugin'

import safe from '@/codegen/safe'
import { logger } from '@/utils/log'
import { evaluate } from '@/utils/module'

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

type Request = RequestMessage<TransformVariableRequestPayload>
type Response = ResponseMessage<TransformVariableResponsePayload>

const formatVariable = (ref: TransformVariableReference): string => {
  return `var(--${ref.name}${ref.value ? `, ${ref.value}` : ''})`
}

const postMessage = globalThis.postMessage

let cachedPluginCode: string | undefined
let cachedPlugin: Plugin | null = null
let cachedTransformVariable: NonNullable<TransformOptions['transformVariable']> | undefined

function resolveTransformVariable(
  plugin: Plugin | null
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
    if (pluginCode === cachedPluginCode) {
      transformVariable = cachedTransformVariable
    } else {
      try {
        const exports = await evaluate(pluginCode)
        cachedPlugin = (exports.default || exports.plugin) as Plugin
        cachedPluginCode = pluginCode
        cachedTransformVariable = resolveTransformVariable(cachedPlugin)
        transformVariable = cachedTransformVariable
      } catch (error) {
        const message: Response = { id, error }
        postMessage(message)
        return
      }
    }
  } else {
    // Reset cache when plugin is disabled.
    cachedPluginCode = undefined
    cachedPlugin = null
    cachedTransformVariable = undefined
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

Object.getOwnPropertyNames(globalThis)
  .filter((key) => !safe.has(key))
  .forEach((key) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    globalThis[key] = undefined
  })

Object.defineProperties(globalThis, {
  name: { value: 'transform-variable', writable: false, configurable: false },
  onmessage: { value: undefined, writable: false, configurable: false },
  onmessageerror: { value: undefined, writable: false, configurable: false },
  postMessage: { value: undefined, writable: false, configurable: false }
})
