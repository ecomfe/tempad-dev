export type ComponentPropertyValue = string | number | boolean | DesignComponent

export type SupportedDesignNodeType = 'GROUP' | 'FRAME' | 'VECTOR' | 'TEXT' | 'INSTANCE'

interface DesignNodeBase {
  name: string
  type: SupportedDesignNodeType
  visible: boolean
}

export type DesignNode = GroupNode | FrameNode | VectorNode | TextNode | DesignComponent

export interface TextNode extends DesignNodeBase {
  type: 'TEXT'
  characters: string
}

interface ContainerNodeBase extends DesignNodeBase {
  children: DesignNode[]
}

export interface GroupNode extends ContainerNodeBase {
  type: 'GROUP'
}
export interface FrameNode extends ContainerNodeBase {
  type: 'FRAME'
}

export interface Variable {
  name: string
  value: string
}

export interface Fill {
  color: string | Variable
}

export interface VectorNode extends DesignNodeBase {
  type: 'VECTOR'
  fills: Fill[]
}

export interface DesignComponent extends ContainerNodeBase {
  type: 'INSTANCE'
  properties: Record<string, ComponentPropertyValue>
  mainComponent?: {
    id: string
    name: string
  } | null
}

type ContainerNode = GroupNode | FrameNode | DesignComponent

export interface DevComponent<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string
  props: T
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

export function h(name: string): DevComponent<Record<string, unknown>>
export function h<T extends Record<string, unknown>>(
  name: string,
  props: T,
  children?: (DevComponent | string)[]
): DevComponent<T>
export function h<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  props?: T,
  children?: (DevComponent | string)[]
): DevComponent<T> {
  return {
    name,
    props: props ?? ({} as T),
    children: children ?? []
  }
}

type RequireAtLeastOne<T, Keys extends keyof T> = {
  [K in Keys]: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
}[Keys]

export type NodeQuery =
  | RequireAtLeastOne<DesignNode, 'type' | 'name' | 'visible'>
  | ((node: DesignNode) => boolean)

function matchNode(node: DesignNode, query: NodeQuery): boolean {
  if (typeof query === 'function') {
    return query(node)
  }

  if (query.type != null && node.type !== query.type) {
    return false
  }
  if (query.name != null && node.name !== query.name) {
    return false
  }
  if (query.visible != null && node.visible !== query.visible) {
    return false
  }
  return true
}

export function findChild<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  query: NodeQuery
): T | null {
  return (node.children.find((child) => matchNode(child, query)) as T) ?? null
}

export function findChildren<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  query: NodeQuery
): T[] {
  return node.children.filter((child) => matchNode(child, query)) as T[]
}

export function findOne<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  query: NodeQuery
): T | null {
  for (const child of node.children) {
    if (matchNode(child, query)) {
      return child as T
    }
    if ('children' in child) {
      const result = findOne(child, query)
      if (result) {
        return result as T
      }
    }
  }
  return null
}

export function findAll<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  query: NodeQuery
): T[] {
  const result: DesignNode[] = []
  for (const child of node.children) {
    if (matchNode(child, query)) {
      result.push(child)
    }
    if ('children' in child) {
      result.push(...findAll(child, query))
    }
  }
  return result as T[]
}
