import type { CodeBlock, CodegenJobPayload, ResponsePayload } from '@/types/codegen'
import type { DevComponent, Plugin, TransformOptions } from '@/types/plugin'

import { serializeComponent, stringifyComponent } from '@/utils/component'
import { serializeCSS } from '@/utils/css'

type WorkerSerializeOptions = Parameters<typeof serializeCSS>[1]

export function generateCodegenPayload(
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
        if (!extraOptions) {
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
    // Style callbacks can update plugin state used by the next component in a batch.
    codeBlocks: payload.componentOnly
      ? codeBlocks.filter(({ name }) => name === 'component')
      : codeBlocks,
    ...(plugin?.name !== undefined ? { pluginName: plugin.name } : {}),
    ...(payload.returnDevComponent && devComponent ? { devComponent } : {})
  }
}
