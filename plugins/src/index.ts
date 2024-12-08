export type ComponentPropertyValue = string | number | boolean | DesignComponent

export interface DesignComponent {
  name: string
  properties: Record<string, ComponentPropertyValue>
}

export interface DevComponent {
  name: string
  props: Record<string, unknown>
  children: (DevComponent | string)[]
}

export type SupportedLang =
  | 'text'
  | 'tsx'
  | 'jsx'
  | 'ts'
  | 'js'
  | 'vue'
  | 'html'
  | 'css'
  | 'sass'
  | 'scss'
  | 'less'
  | 'stylus'
  | 'json'

interface TransformBaseParams {
  /**
   * The user preferences related to code transformation
   * @example { useRem: true, rootFontSize: 16 }
   */
  options: {
    useRem: boolean
    rootFontSize: number
  }
}

interface TransformParams extends TransformBaseParams {
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

interface TransformVariableParams extends TransformBaseParams {
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

interface TransformPxParams extends TransformBaseParams {
  /**
   * The length value
   * @example 16
   */
  value: number
}

interface TransformComponentParams {
  /**
   * The design component
   */
  component: DesignComponent
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
   * Transform the pixel value to the desired unit and scale
   * @example 16 -> '1rem'
   */
  transformPx?: (params: TransformPxParams) => string

  /**
   * Transform the design component to a dev component
   */
  transformComponent?: (params: TransformComponentParams) => DevComponent | string
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

export interface Plugin {
  name: string
  code: CodeOptions
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin
}

export function h(
  name: string,
  props?: Record<string, unknown>,
  children?: (DevComponent | string)[]
): DevComponent {
  return { name, props: props || {}, children: children || [] }
}
