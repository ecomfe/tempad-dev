import type { Plugin, TransformOptions } from '@/types/plugin'

import type { RequestMessage, ResponseMessage } from '@/codegen/worker'
import safe from '@/codegen/safe'
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

  let plugin: Plugin | null = null

  if (payload.pluginCode) {
    try {
      const exports = await evaluate(payload.pluginCode)
      plugin = (exports.default || exports.plugin) as Plugin
    } catch (error) {
      const message: Response = { id, error }
      postMessage(message)
      return
    }
  }

  const transformVariable = resolveTransformVariable(plugin)

  const results = payload.references.map((ref) => {
    if (!transformVariable) {
      return formatVariable(ref)
    }

    try {
      return transformVariable({
        code: ref.code,
        name: ref.name,
        value: ref.value,
        options: payload.options
      })
    } catch (error) {
      console.error(error)
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
    // @ts-ignore
    globalThis[key] = undefined
  })

Object.defineProperties(globalThis, {
  name: { value: 'transform-variable', writable: false, configurable: false },
  onmessage: { value: undefined, writable: false, configurable: false },
  onmessageerror: { value: undefined, writable: false, configurable: false },
  postMessage: { value: undefined, writable: false, configurable: false }
})
