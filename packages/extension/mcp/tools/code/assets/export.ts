import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import type { VisibleTree } from '../model'
import type { AssetPlan } from './plan'
import type { SvgEntry, VectorMode } from './vector'

import { exportSvgEntry } from './vector'
import { analyzeVectorColorModel, createVectorAnalysisContext } from './vector-semantics'

export async function exportVectorAssets(
  tree: VisibleTree,
  plan: AssetPlan,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
  vectorMode: VectorMode = 'smart',
  variableCache?: Map<string, Variable | null>
): Promise<Map<string, SvgEntry>> {
  const svgs = new Map<string, SvgEntry>()
  const analysis = createVectorAnalysisContext(variableCache ?? new Map<string, Variable | null>())
  for (const id of plan.vectorRoots) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue
    const node = snapshot.node
    const { width, height } = snapshot.bounds
    if (width <= 0 && height <= 0 && !snapshot.renderBounds) continue
    const entry = await exportSvgEntry(node, config, assetRegistry, {
      vectorMode,
      colorModel: analyzeVectorColorModel(tree, id, analysis)
    })
    if (!entry) continue
    svgs.set(id, entry)
  }
  return svgs
}
