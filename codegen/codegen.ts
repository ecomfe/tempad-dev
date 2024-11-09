import type { RequestPayload, ResponsePayload, CodeBlock } from '@/codegen/types'
import type { Plugin } from '@/plugins/src/index'

import { serializeCSS } from '@/utils/css'
import { evaluate } from '@/utils/module'

import type { RequestMessage, ResponseMessage } from './worker'

import safe from './safe'

type Request = RequestMessage<RequestPayload>
type Response = ResponseMessage<ResponsePayload>

const IMPORT_RE = /^\s*import\s+(([^'"\n]+|'[^']*'|"[^"]*")|\s*\(\s*[^)]*\s*\))/gm

const postMessage = globalThis.postMessage

globalThis.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  const codeBlocks: CodeBlock[] = []

  const { style, options, pluginCode } = payload
  let plugin = null

  try {
    if (pluginCode) {
      if (IMPORT_RE.test(pluginCode)) {
        throw new Error('`import` is not allowed in plugins.')
      }

      plugin = (await evaluate(pluginCode)).plugin as Plugin
    }
  } catch (e) {
    console.error(e)
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

// Only expose the necessary APIs to plugins
Object.getOwnPropertyNames(globalThis)
  .filter((key) => !safe.has(key))
  .forEach((key) => {
    // @ts-ignore
    globalThis[key] = undefined
  })

Object.defineProperties(globalThis, {
  name: { value: 'codegen', writable: false, configurable: false },
  onmessage: { value: undefined, writable: false, configurable: false },
  onmessageerror: { value: undefined, writable: false, configurable: false },
  postMessage: { value: undefined, writable: false, configurable: false }
})