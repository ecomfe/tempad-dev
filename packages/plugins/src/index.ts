/**
 * Supported primitive and nested component values stored on design component properties.
 */
export type ComponentPropertyValue = string | number | boolean | DesignComponent

/**
 * Figma node types that TemPad Dev plugins can query against.
 */
export type SupportedDesignNodeType = 'GROUP' | 'FRAME' | 'VECTOR' | 'TEXT' | 'INSTANCE'

/**
 * Common fields available on every design node we expose.
 */
interface DesignNodeBase {
  /** Human-friendly node name shown in Figma. */
  name: string

  /** Discriminant describing the concrete node type. */
  type: SupportedDesignNodeType

  /** Whether the node is visible in the current document. */
  visible: boolean
}

/**
 * Union of every design node variant exposed to plugins.
 */
export type DesignNode = GroupNode | FrameNode | VectorNode | TextNode | DesignComponent

/**
 * Figma text node representation including plain characters.
 */
export interface TextNode extends DesignNodeBase {
  /** Identifies the node as a text node. */
  type: 'TEXT'

  /** Raw text characters contained in the node. */
  characters: string
}

/**
 * Shared structure for nodes that support children.
 */
interface ContainerNodeBase extends DesignNodeBase {
  /** Ordered child nodes that reside within this container. */
  children: DesignNode[]
}

/**
 * Group node containing an ordered list of child nodes.
 */
export interface GroupNode extends ContainerNodeBase {
  /** Identifies the node as a group. */
  type: 'GROUP'
}

/**
 * Frame node containing an ordered list of child nodes.
 */
export interface FrameNode extends ContainerNodeBase {
  /** Identifies the node as a frame. */
  type: 'FRAME'
}

/**
 * CSS variable reference extracted from Figma data.
 */
export interface Variable {
  /** Variable name without the `var(--...)` wrapper. */
  name: string

  /** Default value for the variable if defined. */
  value: string
}

/**
 * Fill style as either a literal color or a variable.
 */
export interface Fill {
  /** Hex color string or variable reference describing the fill color. */
  color: string | Variable
}

export interface VectorNode extends DesignNodeBase {
  /** Identifies the node as a vector. */
  type: 'VECTOR'

  /** Fill styles applied to the vector. */
  fills: Fill[]
}

/**
 * Instance node with optional reference to its master component.
 */
export interface DesignComponent<
  T extends object = Record<string, ComponentPropertyValue>
> extends ContainerNodeBase {
  /** Identifies the node as a component instance. */
  type: 'INSTANCE'

  /** Component property map keyed by property name. */
  properties: T

  /** Reference to the main component definition, if linked. */
  mainComponent?: {
    /** ID of the main component this instance is linked to. */
    id: string

    /** Name of the main component this instance is linked to. */
    name: string
  } | null
}

/**
 * Convenience alias for any node that can contain children.
 */
type ContainerNode = GroupNode | FrameNode | DesignComponent

export interface DevComponent<T extends object = Record<string, unknown>> {
  /** Component tag or name to render. */
  name: string

  /** Props that should be passed to the component. */
  props: T

  /** Ordered child components or string literals. */
  children: (DevComponent | string)[]
}

/**
 * Syntax highlighting languages that code blocks can declare.
 */
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
    /** True when pixel values should be converted to rem units. */
    useRem: boolean

    /** Root font size used when converting pixels to rem units. */
    rootFontSize: number
  }
}

/**
 * Parameters passed to a `transform` hook for code blocks.
 */
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

/**
 * Parameters passed to a `transformVariable` hook.
 */
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

/**
 * Parameters passed to a `transformPx` hook.
 */
interface TransformPxParams extends TransformBaseParams {
  /**
   * The length value
   * @example 16
   */
  value: number
}

/**
 * Parameters passed to a `transformComponent` hook.
 */
interface TransformComponentParams {
  /**
   * The design component
   */
  component: DesignComponent
}

/**
 * Hook options for built-in or custom code blocks.
 */
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

/**
 * Shape of a code block configuration or sentinel to disable it.
 */
export type CodeBlockOptions =
  | (TransformOptions & {
      /**
       * The title of the code block
       * @example 'SCSS'
       */
      title?: string
    })
  | false

/**
 * Built-in code block identifiers.
 */
type BuiltInCodeBlock = 'css' | 'js'

/**
 * Declarative configuration for code blocks keyed by identifier.
 */
type CodeOptions = Partial<Record<BuiltInCodeBlock, CodeBlockOptions>> &
  Record<string, CodeBlockOptions>

export interface Plugin {
  /** Human-readable name displayed in the UI. */
  name: string

  /** Map of code block identifiers to configuration. */
  code: CodeOptions
}

export const RAW_TAG_NAME = '__tempad_raw__'

/**
 * Helper to create a raw markup node.
 * This is fully compatible with the existing DevComponent type.
 */
export function raw(content: string, injectedProps?: Record<string, string>): DevComponent {
  return {
    name: RAW_TAG_NAME,
    props: { content, injectedProps },
    children: []
  }
}

/**
 * Helper to define a TemPad Dev plugin with full type support.
 *
 * @param plugin Plugin configuration object supplying metadata and code blocks.
 * @returns The same plugin configuration, enabling type inference in user code.
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin
}

function isDevComponent(value: unknown): value is DevComponent {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}

function isChildrenArgument(
  value: unknown
): value is (DevComponent | string)[] | DevComponent | string {
  if (value === undefined) {
    return false
  }

  if (Array.isArray(value)) {
    return true
  }

  if (typeof value === 'string') {
    return true
  }

  return isDevComponent(value)
}

function normalizeChildren(
  children?: (DevComponent | string)[] | DevComponent | string
): (DevComponent | string)[] {
  if (children === undefined) {
    return []
  }

  return Array.isArray(children) ? children : [children]
}

/**
 * Hyperscript helper to compose `DevComponent` trees from plugin code.
 *
 * Overloads:
 * - `h(name)`
 * - `h(name, children)`
 * - `h(name, props)`
 * - `h(name, props, children)`
 *
 * @param name Component name or tag to render.
 * @param propsOrChildren Optional props object or children collection.
 * @param childrenOrSingle Optional children when props are provided.
 * @returns A dev component tree node ready for serialization.
 *
 * @example
 * ```ts
 * const preview = h('Container', { size: 'lg' }, [
 *   h('Heading', { level: 2 }, ['Button']),
 *   h('Button', { variant: 'primary' }, ['Submit'])
 * ])
 * ```
 *
 * @example
 * ```ts
 * const text = h('Text', 'Hello world')
 * ```
 */
export function h(name: string): DevComponent<Record<string, unknown>>
export function h(
  name: string,
  children: (DevComponent | string)[] | DevComponent | string
): DevComponent<Record<string, unknown>>
export function h<T extends object>(
  name: string,
  props: T,
  children?: (DevComponent | string)[] | DevComponent | string
): DevComponent<T>
export function h<T extends object = Record<string, unknown>>(
  name: string,
  propsOrChildren?: T | (DevComponent | string)[] | DevComponent | string,
  childrenOrSingle?: (DevComponent | string)[] | DevComponent | string
): DevComponent<T> {
  const props =
    propsOrChildren === undefined || isChildrenArgument(propsOrChildren)
      ? ({} as T)
      : (propsOrChildren as T)

  const childSource =
    propsOrChildren === undefined || isChildrenArgument(propsOrChildren)
      ? (propsOrChildren ?? childrenOrSingle)
      : childrenOrSingle

  return {
    name,
    props,
    children: normalizeChildren(childSource)
  }
}

// Mapped type for queryable properties
type QueryableProperties = {
  [K in keyof Pick<DesignNode, 'type' | 'name' | 'visible'>]: DesignNode[K] extends string
    ? DesignNode[K] | DesignNode[K][] | RegExp
    : DesignNode[K]
}

/**
 * Utility that ensures at least one property is defined.
 */
type RequireAtLeastOne<T> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Pick<T, Exclude<keyof T, K>>>
}[keyof T]

/**
 * Predicate or property-based query for matching nodes.
 */
export type NodeQuery = RequireAtLeastOne<QueryableProperties> | ((node: DesignNode) => boolean)

/**
 * Returns true when a node property satisfies the provided condition.
 *
 * @param value Original property value from the node.
 * @param condition Value matcher supporting primitives, arrays, and regular expressions.
 * @returns True if the value matches or the condition is undefined.
 */
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

/**
 * Checks whether a node satisfies the provided query.
 *
 * @param node Node being evaluated.
 * @param query Predicate or property query description.
 * @returns True when the node matches.
 */
function matchNode(node: DesignNode, query: NodeQuery): boolean {
  if (typeof query === 'function') return query(node)

  return (
    matchProperty(node.type, query.type) &&
    matchProperty(node.name, query.name) &&
    matchProperty(node.visible, query.visible ?? true)
  )
}

/**
 * Find the first direct child that matches the query.
 *
 * @param node Parent container to search.
 * @param query Predicate or property query description.
 * @returns The first matching child or null when none found.
 *
 * @example
 * ```ts
 * const title = findChild(component, { type: 'TEXT', name: /title/i })
 * ```
 */
export function findChild<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  query: NodeQuery
): T | null {
  return (node.children.find((child) => matchNode(child, query)) as T) ?? null
}

/**
 * Find all direct children that match the query.
 *
 * @param node Parent container to search.
 * @param query Predicate or property query description.
 * @returns An array of matching direct children.
 *
 * @example
 * ```ts
 * const icons = findChildren(toolbar, { type: 'VECTOR' })
 * ```
 */
export function findChildren<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  query: NodeQuery
): T[] {
  return node.children.filter((child) => matchNode(child, query)) as T[]
}

/**
 * Depth-first search for the first node that matches the query.
 *
 * @param node Root container to search recursively.
 * @param query Predicate or property query description.
 * @returns The first nested node that matches or null.
 *
 * @example
 * ```ts
 * const submitButton = findOne(frame, { name: 'Submit' })
 * ```
 */
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

/**
 * Depth-first search returning every node that matches the query.
 *
 * @param node Root container to search recursively.
 * @param query Predicate or property query description.
 * @returns All nodes within the subtree that satisfy the query.
 *
 * @example
 * ```ts
 * const texts = findAll(page, { type: 'TEXT', visible: true })
 * ```
 */
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

/**
 * Allowed lookup styles that can be chained inside `queryAll`.
 */
export type QueryType = 'child' | 'children' | 'one' | 'all'

/**
 * Execute a sequence of queries, returning the final node collection.
 *
 * @param node Root container to start the pipeline from.
 * @param queries Ordered list describing how each query step should behave.
 * @returns The collection of nodes produced by the final query step.
 *
 * @example
 * ```ts
 * const buttons = queryAll(frame, [
 *   { query: 'children', name: 'Footer' },
 *   { query: 'all', type: 'INSTANCE', name: /Button/ }
 * ])
 * ```
 */
export function queryAll<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  queries: (NodeQuery & { query: QueryType })[]
): T[] {
  if (queries.length === 0) {
    return []
  }

  let current: DesignNode[] = [node]

  for (const query of queries) {
    const seen = new Set<DesignNode>()
    const next: DesignNode[] = []

    for (const node of current) {
      if (!('children' in node)) {
        continue
      }

      seen.add(node)

      if (query.query === 'child' || query.query === 'one') {
        const one = query.query === 'child' ? findChild(node, query) : findOne(node, query)
        if (one && !seen.has(one)) {
          seen.add(one)
          next.push(one)
        }
      } else {
        const all = query.query === 'children' ? findChildren(node, query) : findAll(node, query)
        for (const item of all) {
          if (!seen.has(item)) {
            seen.add(item)
            next.push(item)
          }
        }
      }
    }

    current = next
  }

  return current as T[]
}

/**
 * Execute a sequence of queries and return only the first match.
 *
 * @param node Root container to start the pipeline from.
 * @param queries Ordered list describing how each query step should behave.
 * @returns The first node produced by the query sequence or null.
 *
 * @example
 * ```ts
 * const header = queryOne(page, [
 *   { query: 'children', name: 'Header' },
 *   { query: 'child', type: 'FRAME', name: /Top Bar/ }
 * ])
 * ```
 */
export function queryOne<T extends DesignNode = DesignNode>(
  node: ContainerNode,
  queries: (NodeQuery & { query: QueryType })[]
): T | null {
  return queryAll<T>(node, queries)[0]
}
