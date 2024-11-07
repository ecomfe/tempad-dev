export type SupportedLang = 'css' | 'js' | 'sass' | 'scss' | 'less' | 'stylus' | 'json'

type TransformParams = {
  /**
   * The generated CSS code
   * @example 'background-color: red; color: blue;'
   */
  code: string

  /**
   * The parsed CSS properties
   * @example { 'background-color': 'red', 'color': 'blue' }
   */
  style: Record<string, string>
}

type TransformVariableParams = {
  /**
   * The generated CSS variable code
   * @example 'var(--color-primary, #6699cc)'
   */
  code: string

  /**
   * The variable name
   * @example 'color-primary'
   */
  name: string

  /**
   * The variable value
   * @example '#6699cc'
   */
  value?: string
}

type TransformLengthParams = {
  /**
   * The length value
   * @example 16
   */
  value: number
}

export type TransformOptions = {
  /**
   * The language of the code block for syntax highlighting
   * @example 'scss'
   */
  lang?: SupportedLang

  /**
   * Transform the generated CSS code
   */
  transform?: (params: TransformParams) => string

  /**
   * Transform the generated CSS variable code
   * @example 'var(--kui-color-primary, #6699cc)' -> '$ui-color-primary'
   */
  transformVariable?: (params: TransformVariableParams) => string

  /**
   * Transform the pixel value CSS length code
   * @example 16 -> '1rem'
   */
  transformPx?: (params: TransformLengthParams) => string
}

export type CodeBlockOptions =
  | (TransformOptions & {
      /**
       * The title of the code block
       * @example 'SCSS'
       */
      title?: string
    })
  | false

type BuiltInCodeBlock = 'css' | 'js'

type CodeOptions = Partial<Record<BuiltInCodeBlock, CodeBlockOptions>> &
  Record<string, CodeBlockOptions>

export type Plugin = {
  name: string
  code: CodeOptions
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin
}
