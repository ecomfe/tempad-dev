import { generateCodeBlocksForNode } from '@/utils/codegen'
import { runTransformVariableBatch } from '@/mcp/transform-variable'
import { buildSemanticTree } from '@/mcp/semantic-tree'
import { activePlugin, options } from '@/ui/state'

import type { GetCodeResult } from '@/mcp-server/src/tools'
import type { CodeBlock } from '@/types/codegen'
import type { CodegenConfig } from '@/utils/codegen'
import type { SemanticNode } from '@/mcp/semantic-tree'

const VARIABLE_RE = /var\(--([a-zA-Z\d-]+)(?:,\s*([^)]+))?\)/g
const SELF_CLOSING_TAGS = new Set(['img', 'input', 'hr', 'br', 'meta', 'link'])

type RenderContext = {
  styles: Map<string, Record<string, string>>
  sceneNodes: Map<string, SceneNode>
  components: Map<string, string>
  componentKeys: Map<string, string>
  pluginCode?: string
  config: CodegenConfig
}

type VariableReferenceInternal = {
  nodeId: string
  property: string
  code: string
  name: string
  value?: string
}

type PropertyBucket = {
  nodeId: string
  property: string
  original: string
  matchIndices: number[]
}

export async function handleGetCode(node: SceneNode): Promise<GetCodeResult> {
  const tree = buildSemanticTree([node])
  const root = tree.roots[0]
  if (!root) {
    throw new Error('No renderable nodes found for the current selection.')
  }

  const config = codegenConfig()
  const pluginCode = activePlugin.value?.code
  const { sceneNodes, styles } = await collectSceneData(tree.roots)
  await applyVariableTransforms(styles, config, pluginCode)

  const ctx: RenderContext = {
    styles,
    sceneNodes,
    components: new Map(),
    componentKeys: new Map(),
    pluginCode,
    config
  }

  const markup = await renderSemanticNode(root, ctx, 0)
  if (!markup) {
    throw new Error('Unable to build markup for the current selection.')
  }

  const componentCode = ctx.components.size
    ? '\n\n' + Array.from(ctx.components.values()).join('\n\n')
    : ''

  return { lang: 'jsx', code: `${markup}${componentCode}` }
}

async function collectSceneData(roots: SemanticNode[]): Promise<{
  sceneNodes: Map<string, SceneNode>
  styles: Map<string, Record<string, string>>
}> {
  const semanticNodes = flattenSemanticNodes(roots)
  const sceneNodes = new Map<string, SceneNode>()
  const styles = new Map<string, Record<string, string>>()

  await Promise.all(
    semanticNodes.map(async (semantic) => {
      const sceneNode = figma.getNodeById(semantic.id)
      if (!isSceneNode(sceneNode) || !sceneNode.visible) {
        return
      }
      sceneNodes.set(semantic.id, sceneNode)
      if (hasComputedStyle(sceneNode)) {
        try {
          const style = await sceneNode.getCSSAsync()
          styles.set(semantic.id, style)
        } catch {
          // ignore nodes without computable CSS
        }
      }
    })
  )

  return { sceneNodes, styles }
}

async function applyVariableTransforms(
  styles: Map<string, Record<string, string>>,
  config: CodegenConfig,
  pluginCode?: string
): Promise<void> {
  const { references, buckets } = collectVariableReferences(styles)
  if (!references.length) {
    return
  }

  const replacements = await runTransformVariableBatch(
    references.map(({ code, name, value }) => ({ code, name, value })),
    {
      useRem: config.cssUnit === 'rem',
      rootFontSize: config.rootFontSize,
      scale: config.scale
    },
    pluginCode
  )

  for (const bucket of buckets.values()) {
    const style = styles.get(bucket.nodeId)
    if (!style) continue
    let occurrence = 0
    style[bucket.property] = bucket.original.replace(VARIABLE_RE, (match) => {
      const refIndex = bucket.matchIndices[occurrence++]
      return replacements[refIndex] ?? match
    })
  }
}

function collectVariableReferences(styles: Map<string, Record<string, string>>): {
  references: VariableReferenceInternal[]
  buckets: Map<string, PropertyBucket>
} {
  const references: VariableReferenceInternal[] = []
  const buckets = new Map<string, PropertyBucket>()

  for (const [nodeId, style] of styles.entries()) {
    for (const [property, value] of Object.entries(style)) {
      let match: RegExpExecArray | null
      while ((match = VARIABLE_RE.exec(value))) {
        const [, name, fallback] = match
        const refIndex =
          references.push({
            nodeId,
            property,
            code: value,
            name,
            value: fallback?.trim()
          }) - 1

        const key = `${nodeId}:${property}`
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.matchIndices.push(refIndex)
        } else {
          buckets.set(key, {
            nodeId,
            property,
            original: value,
            matchIndices: [refIndex]
          })
        }
      }
      VARIABLE_RE.lastIndex = 0
    }
  }

  return { references, buckets }
}

async function renderSemanticNode(
  node: SemanticNode,
  ctx: RenderContext,
  depth: number
): Promise<string> {
  const sceneNode = ctx.sceneNodes.get(node.id)
  if (!sceneNode) {
    return ''
  }

  if (sceneNode.type === 'INSTANCE') {
    const symbol = await ensureComponentSymbol(sceneNode, ctx)
    if (symbol) {
      return `${indent(depth)}<${symbol} />`
    }
  }

  const classNames = cssToTailwind(ctx.styles.get(node.id) ?? {}, node.id)
  const classAttr = classNames.length ? ` className="${classNames.join(' ')}"` : ''
  const tag = node.tag || 'div'
  const indentLevel = indent(depth)

  const childChunks: string[] = []
  for (const child of node.children) {
    const rendered = await renderSemanticNode(child, ctx, depth + 1)
    if (rendered) {
      childChunks.push(rendered)
    }
  }

  const textLiteral =
    sceneNode.type === 'TEXT' ? formatTextLiteral(sceneNode.characters ?? '') : null

  if (!childChunks.length && !textLiteral && SELF_CLOSING_TAGS.has(tag)) {
    return `${indentLevel}<${tag}${classAttr} />`
  }

  if (!childChunks.length && !textLiteral) {
    return `${indentLevel}<${tag}${classAttr}></${tag}>`
  }

  const inner: string[] = []
  if (textLiteral) {
    inner.push(`${indent(depth + 1)}{${textLiteral}}`)
  }
  inner.push(...childChunks)

  return `${indentLevel}<${tag}${classAttr}>\n${inner.join('\n')}\n${indentLevel}</${tag}>`
}

async function ensureComponentSymbol(
  node: InstanceNode,
  ctx: RenderContext
): Promise<string | null> {
  const componentKey = node.mainComponent?.id ?? node.id
  const cached = ctx.componentKeys.get(componentKey)
  if (cached) {
    return cached
  }

  if (!ctx.pluginCode) {
    return null
  }

  const blocks = await generateCodeBlocksForNode(node, ctx.config, ctx.pluginCode)
  const componentBlock = findComponentBlock(blocks)
  if (!componentBlock) {
    return null
  }

  const symbol = formatComponentSymbol(node.name)
  ctx.componentKeys.set(componentKey, symbol)
  ctx.components.set(symbol, componentBlock.code)
  return symbol
}

function findComponentBlock(blocks: CodeBlock[]): CodeBlock | undefined {
  return blocks.find(
    (block) => block.name === 'component' && (block.lang === 'jsx' || block.lang === 'tsx')
  )
}

function cssToTailwind(style: Record<string, string>, nodeId: string): string[] {
  if (!Object.keys(style).length) {
    return []
  }
  return [`tw-${nodeId.slice(0, 6)}`]
}

function formatTextLiteral(value: string): string | null {
  if (!value.trim()) {
    return null
  }
  return JSON.stringify(value)
}

function formatComponentSymbol(name: string): string {
  const cleaned = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join('')
  return cleaned || 'Component'
}

function flattenSemanticNodes(nodes: SemanticNode[]): SemanticNode[] {
  const result: SemanticNode[] = []
  const visit = (node: SemanticNode) => {
    result.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

function codegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return !!node && 'type' in node && 'visible' in node
}

function hasComputedStyle(node: SceneNode): node is SceneNode & {
  getCSSAsync: () => Promise<Record<string, string>>
} {
  return (
    'getCSSAsync' in node &&
    typeof (node as SceneNode & { getCSSAsync?: unknown }).getCSSAsync === 'function'
  )
}
