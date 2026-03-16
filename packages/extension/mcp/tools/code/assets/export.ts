import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import type { GetCodeCacheContext } from '../cache'
import type { VisibleTree } from '../model'
import type { AssetPlan } from './plan'
import type { SvgEntry, VectorMode } from './vector'

import { exportSvgEntry } from './vector'
import { analyzeVectorColorModel } from './vector-semantics'

export async function exportVectorAssets(
  tree: VisibleTree,
  plan: AssetPlan,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
  vectorMode: VectorMode = 'smart',
  cache?: GetCodeCacheContext
): Promise<Map<string, SvgEntry>> {
  const svgs = new Map<string, SvgEntry>()
  for (const id of plan.vectorRoots) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue
    const node = snapshot.node
    const { width, height } = snapshot.bounds
    if (width <= 0 && height <= 0 && !snapshot.renderBounds) continue
    const entry = await exportSvgEntry(node, config, assetRegistry, {
      vectorMode,
      colorModel: analyzeVectorColorModel(tree, id, cache)
    })
    if (!entry) continue
    svgs.set(id, entry)
  }
  return svgs
}
