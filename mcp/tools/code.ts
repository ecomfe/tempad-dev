import { generateCodeBlocksForNode } from '@/utils/codegen'
import { runTransformVariableBatch } from '@/mcp/transform-variable'
import { buildSemanticTree } from '@/mcp/semantic-tree'
import { activePlugin, options } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'

import type { GetCodeResult } from '@/mcp-server/src/tools'
import type { CodeBlock } from '@/types/codegen'
import type { CodegenConfig } from '@/utils/codegen'
import type { SemanticNode } from '@/mcp/semantic-tree'
import type { DevComponent } from '@/types/plugin'

const VARIABLE_RE = /var\(--([a-zA-Z\d-]+)(?:,\s*([^)]+))?\)/g

type RenderContext = {
  styles: Map<string, Record<string, string>>
  nodes: Map<string, SceneNode>
  components: string[]
  symbolCounts: Map<string, number>
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

export async function handleGetCode(nodes: SceneNode[]): Promise<GetCodeResult> {
  if (nodes.length !== 1) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  const tree = buildSemanticTree(nodes)
  const root = tree.roots[0]
  if (!root) {
    throw new Error('No renderable nodes found for the current selection.')
  }

  const config = codegenConfig()
  const pluginCode = activePlugin.value?.code
  const { nodes: nodeMap, styles } = await collectSceneData(tree.roots)
  await applyVariableTransforms(styles, config, pluginCode)

  const ctx: RenderContext = {
    styles,
    nodes: nodeMap,
    components: [],
    symbolCounts: new Map(),
    pluginCode,
    config
  }

  const componentTree = await renderSemanticNode(root, ctx)
  if (!componentTree) {
    throw new Error('Unable to build markup for the current selection.')
  }

  const markup = stringifyComponent(componentTree, 'jsx')

  const componentCode = ctx.components.length ? '\n\n' + ctx.components.join('\n\n') : ''

  return { lang: 'jsx', code: `${markup}${componentCode}` }
}

async function collectSceneData(roots: SemanticNode[]): Promise<{
  nodes: Map<string, SceneNode>
  styles: Map<string, Record<string, string>>
}> {
  const semanticNodes = flattenSemanticNodes(roots)
  const nodes = new Map<string, SceneNode>()
  const styles = new Map<string, Record<string, string>>()

  await Promise.all(
    semanticNodes.map(async (semantic) => {
      const node = figma.getNodeById(semantic.id) as SceneNode | null
      if (!node || !node.visible) {
        return
      }
      nodes.set(semantic.id, node)
      try {
        const style = await node.getCSSAsync()
        styles.set(semantic.id, style)
      } catch {
        // ignore nodes without computable CSS
      }
    })
  )

  return { nodes, styles }
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
  semantic: SemanticNode,
  ctx: RenderContext
): Promise<DevComponent | null> {
  const node = ctx.nodes.get(semantic.id)
  if (!node) {
    return null
  }

  if (node.type === 'INSTANCE') {
    const symbol = await ensureComponentSymbol(node, ctx)
    if (symbol) {
      return { name: symbol, props: {}, children: [] }
    }
  }

  const classNames = cssToTailwind(ctx.styles.get(semantic.id) ?? {}, semantic.id)
  const props: Record<string, unknown> = {}
  if (classNames.length) {
    props.className = classNames.join(' ')
  }
  if (semantic.dataHint?.kind === 'attr') {
    props[semantic.dataHint.name] = semantic.dataHint.value
  }

  const children: (DevComponent | string)[] = []
  for (const child of semantic.children) {
    const rendered = await renderSemanticNode(child, ctx)
    if (rendered) {
      children.push(rendered)
    }
  }

  if (node.type === 'TEXT') {
    const textLiteral = formatTextLiteral(node.characters ?? '')
    if (textLiteral) {
      children.unshift(`{${textLiteral}}`)
    }
  }

  return { name: semantic.tag || 'div', props, children }
}

async function ensureComponentSymbol(
  node: InstanceNode,
  ctx: RenderContext
): Promise<string | null> {
  if (!ctx.pluginCode) {
    return null
  }

  const blocks = await generateCodeBlocksForNode(node, ctx.config, ctx.pluginCode)
  const componentBlock = findComponentBlock(blocks)
  if (!componentBlock) {
    return null
  }

  const baseSymbol = formatComponentSymbol(node.name)
  const count = (ctx.symbolCounts.get(baseSymbol) ?? 0) + 1
  ctx.symbolCounts.set(baseSymbol, count)
  const symbol = count === 1 ? baseSymbol : `${baseSymbol}${count}`
  ctx.components.push(componentBlock.code)
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
