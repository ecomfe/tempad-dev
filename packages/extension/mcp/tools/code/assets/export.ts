import type { AssetDescriptor } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import type { VisibleTree } from '../model'
import type { AssetPlan } from './plan'
import type { SvgEntry } from './vector'

import { exportSvgEntry } from './vector'

export async function exportVectorAssets(
  tree: VisibleTree,
  plan: AssetPlan,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<Map<string, SvgEntry>> {
  const svgs = new Map<string, SvgEntry>()
  for (const id of plan.vectorRoots) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue
    const node = snapshot.node
    const { width, height } = snapshot.bounds
    if (width <= 0 && height <= 0 && !snapshot.renderBounds) continue
    const entry = await exportSvgEntry(node, config, assetRegistry)
    if (!entry) continue
    svgs.set(id, entry)
  }
  return svgs
}
