import type {
  CodeBlock,
  CodegenBatchRequestPayload,
  CodegenBatchResponsePayload,
  CodegenJobPayload,
  RequestPayload,
  ResponsePayload
} from '@/types/codegen'
import type { DevComponent, Plugin, TransformOptions } from '@/types/plugin'

import { serializeComponent, stringifyComponent } from '@/utils/component'
import { serializeCSS } from '@/utils/css'
import { logger } from '@/utils/log'
import { assertPluginModuleIsSelfContained, evaluate } from '@/utils/module'
import { stringify } from '@/utils/string'
import { lockdownWorker } from '@/worker/lockdown'

import type { WorkerRequest, WorkerResponse } from './protocol'

type Request = WorkerRequest<RequestPayload | CodegenBatchRequestPayload>
type Response = WorkerResponse<ResponsePayload | CodegenBatchResponsePayload>
type WorkerSerializeOptions = Parameters<typeof serializeCSS>[1]

const postMessage = globalThis.postMessage

globalThis.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  try {
    const plugin = await loadPlugin(payload.pluginCode)
    const result = isBatchRequest(payload)
      ? { results: payload.jobs.map((job) => generateCodegenPayload(job, plugin)) }
      : generateCodegenPayload(payload, plugin)
    postSafe({ id, payload: result })
  } catch (error) {
    logger.error(error)
    postMessage({ id, error } satisfies Response)
  }
}

async function loadPlugin(pluginCode: string | undefined): Promise<Plugin | null> {
  if (!pluginCode) return null
  assertPluginModuleIsSelfContained(pluginCode)
  const exports = await evaluate(pluginCode)
  return ((exports.default || exports.plugin) as Plugin | undefined) ?? null
}

function generateCodegenPayload(
  payload: CodegenJobPayload,
  plugin: Plugin | null
): ResponsePayload {
  const codeBlocks: CodeBlock[] = []

  const { style, pluginVariableStyle, variableSyntax, component, options } = payload
  let devComponent: DevComponent | null = null

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
        title: componentOptions.title ?? 'Component',
        lang: componentOptions.lang ?? 'jsx',
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

  return {
    codeBlocks,
    pluginName: plugin?.name,
    ...(payload.returnDevComponent && devComponent ? { devComponent } : {})
  }
}

function postSafe(message: Response): void {
  const safe: Response = JSON.parse(
    JSON.stringify(message, (_, v) => {
      if (typeof v === 'function') return stringify(v)
      return v
    })
  )
  postMessage(safe)
}

function isBatchRequest(
  payload: RequestPayload | CodegenBatchRequestPayload
): payload is CodegenBatchRequestPayload {
  return 'jobs' in payload && Array.isArray(payload.jobs)
}

// Only expose the necessary APIs to plugins
lockdownWorker('codegen')
