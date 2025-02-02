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

export interface DesignComponent<T extends object = Record<string, ComponentPropertyValue>>
  extends ContainerNodeBase {
  type: 'INSTANCE'
  properties: T
  mainComponent?: {
    id: string
    name: string
  } | null
}

type ContainerNode = GroupNode | FrameNode | DesignComponent

export interface DevComponent<T extends object = Record<string, unknown>> {
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

export function h<T extends object = Record<string, unknown>>(
  name: string,
  props?: T,
  children?: (DevComponent | string)[]
): DevComponent<T> {
  return {
    name,
    props: (props ?? {}) as T,
    children: children ?? []
  }
}

// Mapped type for queryable properties
type QueryableProperties = {
  [K in keyof Pick<DesignNode, 'type' | 'name' | 'visible'>]: DesignNode[K] extends string
    ? DesignNode[K] | DesignNode[K][] | RegExp
    : DesignNode[K]
}

type RequireAtLeastOne<T> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Pick<T, Exclude<keyof T, K>>>
}[keyof T]

export type NodeQuery = RequireAtLeastOne<QueryableProperties> | ((node: DesignNode) => boolean)

function matchProperty<T>(
  value: T,
  condition: T extends string ? T | T[] | RegExp : T | undefined
): boolean {
  if (condition === undefined) {
    return true
  }

  if (typeof value === 'string') {
    if (Array.isArray(condition)) {
      return condition.includes(value)
    }

    if (condition instanceof RegExp) {
      return condition.test(value)
    }
  }

  return value === condition
}

function matchNode(node: DesignNode, query: NodeQuery): boolean {
  if (typeof query === 'function') return query(node)

  return (
    matchProperty(node.type, query.type) &&
    matchProperty(node.name, query.name) &&
    matchProperty(node.visible, query.visible)
  )
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
