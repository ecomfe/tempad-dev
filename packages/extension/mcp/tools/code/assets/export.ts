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
    if (cache?.metrics) cache.metrics.vectorExportCandidates += 1
    const snapshot = tree.nodes.get(id)
    if (!snapshot) {
      if (cache?.metrics) cache.metrics.vectorExportSkippedMissing += 1
      continue
    }
    const node = snapshot.node
    const { width, height } = snapshot.bounds
    if (width <= 0 && height <= 0 && !snapshot.renderBounds) {
      if (cache?.metrics) cache.metrics.vectorExportSkippedZeroBounds += 1
      continue
    }
    const entry = await exportSvgEntry(node, config, assetRegistry, {
      vectorMode,
      colorModel: analyzeVectorColorModel(tree, id, cache)
    })
    if (!entry) {
      if (cache?.metrics) cache.metrics.vectorExportNull += 1
      continue
    }
    recordVectorEntryMetrics(entry, cache)
    svgs.set(id, entry)
  }
  return svgs
}

function recordVectorEntryMetrics(entry: SvgEntry, cache?: GetCodeCacheContext): void {
  const metrics = cache?.metrics
  if (!metrics) return

  if (entry.props['data-src']) {
    metrics.vectorExportUploaded += 1
    return
  }

  if (entry.presentationStyle?.color) {
    metrics.vectorExportThemeableInline += 1
    return
  }

  if (entry.raw) {
    metrics.vectorExportRawInline += 1
  }
}
