import type { RequestPayload, ResponsePayload, CodeBlock } from '@/codegen/types'
import type { Plugin } from '@/plugins/src/index'

import { serializeCSS } from '@/utils/css'
import { evaluate } from '@/utils/module'

import type { RequestMessage, ResponseMessage } from './worker'

type Request = RequestMessage<RequestPayload>
type Response = ResponseMessage<ResponsePayload>

onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  const codeBlocks: CodeBlock[] = []

  const { style, options, pluginCode } = payload
  let plugin = null

  try {
    if (pluginCode) {
      plugin = (await evaluate(pluginCode)).plugin as Plugin
    }
  } catch (e) {
    const message: Response = {
      id,
      error: e
    }
    postMessage(message)
    return
  }

  const { css: cssOptions, js: jsOptions, ...rest } = plugin?.code || {}
  if (cssOptions !== false) {
    const cssCode = serializeCSS(style, options, cssOptions)
    if (cssCode) {
      codeBlocks.push({
        name: 'css',
        title: cssOptions?.title ?? 'CSS',
        lang: cssOptions?.lang ?? 'css',
        code: cssCode
      })
    }
  }

  if (jsOptions !== false) {
    const jsCode = serializeCSS(style, { ...options, toJS: true }, jsOptions)
    if (jsCode) {
      codeBlocks.push({
        name: 'js',
        title: jsOptions?.title ?? 'JS',
        lang: jsOptions?.lang ?? 'js',
        code: jsCode
      })
    }
  }

  codeBlocks.push(
    ...Object.keys(rest)
      .map((name) => {
        const extraOptions = rest[name]
        if (extraOptions === false) {
          return null
        }

        const code = serializeCSS(style, options, extraOptions)
        if (!code) {
          return null
        }
        return {
          name,
          title: extraOptions.title ?? name,
          lang: extraOptions.lang ?? 'css',
          code
        }
      })
      .filter((item): item is CodeBlock => item != null)
  )

  const message: Response = {
    id,
    payload: { codeBlocks }
  }
  postMessage(message)
}
