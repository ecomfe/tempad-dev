import type { RequestPayload, ResponsePayload, CodeBlock } from '@/types/codegen'
import type { DevComponent, Plugin } from '@/types/plugin'

import { serializeComponent, stringifyComponent } from '@/utils/component'
import { serializeCSS } from '@/utils/css'
import { logger } from '@/utils/log'
import { evaluate } from '@/utils/module'
import { stringify } from '@/utils/string'

import type { RequestMessage, ResponseMessage } from './requester'

import safe from './safe'

type Request = RequestMessage<RequestPayload>
type Response = ResponseMessage<ResponsePayload>

const IMPORT_RE = /^\s*import\s+(([^'"\n]+|'[^']*'|"[^"]*")|\s*\(\s*[^)]*\s*\))/gm

const postMessage = globalThis.postMessage

globalThis.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  const codeBlocks: CodeBlock[] = []

  const { style, component, options, pluginCode } = payload
  let plugin = null
  let devComponent: DevComponent | null = null

  try {
    if (pluginCode) {
      if (IMPORT_RE.test(pluginCode)) {
        throw new Error('`import` is not allowed in plugins.')
      }

      const exports = await evaluate(pluginCode)
      plugin = (exports.default || exports.plugin) as Plugin
    }
  } catch (e) {
    logger.error(e)
    const message: Response = {
      id,
      error: e
    }
    postMessage(message)
    return
  }

  const {
    component: componentOptions,
    css: cssOptions,
    js: jsOptions,
    ...rest
  } = plugin?.code ?? {}

  if (componentOptions && component) {
    const { lang, transformComponent } = componentOptions
    let componentCode = ''

    if (typeof transformComponent === 'function') {
      const result = transformComponent({ component })
      if (typeof result === 'string') {
        componentCode = result
      } else if (result) {
        devComponent = result
        componentCode = stringifyComponent(result, lang ?? 'jsx')
      }
    } else {
      componentCode = serializeComponent(component, { lang }, { transformComponent })
    }

    if (componentCode) {
      codeBlocks.push({
        name: 'component',
        title: componentOptions?.title ?? 'Component',
        lang: componentOptions?.lang ?? 'jsx',
        code: componentCode
      })
    }
  }

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
        title: jsOptions?.title ?? 'JavaScript',
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
    payload: {
      codeBlocks,
      pluginName: plugin?.name,
      ...(payload.returnDevComponent && devComponent ? { devComponent } : {})
    }
  }

  const safe = JSON.parse(
    JSON.stringify(message, (_, v) => {
      if (typeof v === 'function') return stringify(v)
      return v
    })
  )

  postMessage(safe)
}

// Only expose the necessary APIs to plugins
Object.getOwnPropertyNames(globalThis)
  .filter((key) => !safe.has(key))
  .forEach((key) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    globalThis[key] = undefined
  })

Object.defineProperties(globalThis, {
  name: { value: 'codegen', writable: false, configurable: false },
  onmessage: { value: undefined, writable: false, configurable: false },
  onmessageerror: { value: undefined, writable: false, configurable: false },
  postMessage: { value: undefined, writable: false, configurable: false }
})
