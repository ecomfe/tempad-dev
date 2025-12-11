import type { AssetDescriptor } from '@tempad-dev/mcp-shared'

import type { SemanticNode } from '@/mcp/semantic-tree'
import type { CodegenConfig } from '@/utils/codegen'

import type { SvgEntry } from './assets'

import { exportSvgEntry, hasImageFills, replaceImageUrlsWithAssets } from './assets'
import { preprocessStyles, stripInertShadows } from './style'

export type CollectedSceneData = {
  nodes: Map<string, SceneNode>
  styles: Map<string, Record<string, string>>
  svgs: Map<string, SvgEntry>
}

export async function collectSceneData(
  roots: SemanticNode[],
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<CollectedSceneData> {
  const semanticNodes = flattenSemanticNodes(roots)
  const nodes = new Map<string, SceneNode>()
  const styles = new Map<string, Record<string, string>>()
  const svgs = new Map<string, SvgEntry>()

  for (const semantic of semanticNodes) {
    const node = figma.getNodeById(semantic.id) as SceneNode | null
    if (!node || !node.visible) continue

    nodes.set(semantic.id, node)

    if (semantic.assetKind === 'vector') {
      const svgEntry = await exportSvgEntry(node, config, assetRegistry)
      if (svgEntry) {
        svgs.set(semantic.id, svgEntry)
      }
      continue
    }

    try {
      const css = await node.getCSSAsync()

      let processed = preprocessStyles(css, node)

      if (hasImageFills(node)) {
        processed = await replaceImageUrlsWithAssets(processed, node, config, assetRegistry)
      }

      stripInertShadows(processed, node)

      styles.set(semantic.id, processed)
    } catch (error) {
      console.warn('[tempad-dev] Failed to process node styles:', error)
    }
  }

  return { nodes, styles, svgs }
}

function flattenSemanticNodes(nodes: SemanticNode[]): SemanticNode[] {
  const res: SemanticNode[] = []
  const traverse = (n: SemanticNode) => {
    res.push(n)
    n.children.forEach(traverse)
  }
  nodes.forEach(traverse)
  return res
}
