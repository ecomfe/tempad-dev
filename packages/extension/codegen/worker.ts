import type { RequestPayload, ResponsePayload, CodeBlock } from '@/types/codegen'
import type { DevComponent, Plugin, TransformOptions } from '@/types/plugin'

import { serializeComponent, stringifyComponent } from '@/utils/component'
import { serializeCSS } from '@/utils/css'
import { logger } from '@/utils/log'
import { evaluate } from '@/utils/module'
import { stringify } from '@/utils/string'
import { lockdownWorker } from '@/worker/lockdown'

import type { RequestMessage, ResponseMessage } from './requester'

type Request = RequestMessage<RequestPayload>
type Response = ResponseMessage<ResponsePayload>
type WorkerSerializeOptions = Parameters<typeof serializeCSS>[1]

const IMPORT_RE = /^\s*import\s+(([^'"\n]+|'[^']*'|"[^"]*")|\s*\(\s*[^)]*\s*\))/gm

const postMessage = globalThis.postMessage

globalThis.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  const codeBlocks: CodeBlock[] = []

  const { style, pluginVariableStyle, variableSyntax, component, options, pluginCode } = payload
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
  const usesVariableTransform = (blockOptions: TransformOptions | false | undefined) =>
    !!blockOptions && typeof blockOptions.transformVariable === 'function'
  const serializeBlock = (
    blockOptions: TransformOptions | false | undefined,
    serializeOptions: WorkerSerializeOptions
  ) => {
    const usePluginVariableStyle = usesVariableTransform(blockOptions)
    const transformOptions = blockOptions || undefined
    const blockStyle = usePluginVariableStyle ? (pluginVariableStyle ?? style) : style
    const context = variableSyntax && !usePluginVariableStyle ? { variableSyntax } : undefined

    if (context) {
      return serializeCSS(blockStyle, serializeOptions, transformOptions, context)
    }
    return serializeCSS(blockStyle, serializeOptions, transformOptions)
  }

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
    const cssCode = serializeBlock(cssOptions, options)
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
    const jsCode = serializeBlock(jsOptions, { ...options, toJS: true })
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

        const code = serializeBlock(extraOptions, options)
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
lockdownWorker('codegen')
