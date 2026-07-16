import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import type { GetCodeCacheContext } from '../cache'
import type { VisibleTree } from '../model'
import type { AssetPlan } from './plan'
import type { SvgEntry, VectorMode } from './vector'

import { exportSvgEntry } from './vector'
import { analyzeVectorColorModel } from './vector-semantics'

const VECTOR_EXPORT_CONCURRENCY = 2

export async function exportVectorAssets(
  tree: VisibleTree,
  plan: AssetPlan,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
  vectorMode: VectorMode = 'smart',
  cache?: GetCodeCacheContext
): Promise<Map<string, SvgEntry>> {
  const svgs = new Map<string, SvgEntry>()
  const candidates: Array<{
    id: string
    node: SceneNode
  }> = []

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
    candidates.push({ id, node })
  }

  for (let index = 0; index < candidates.length; index += VECTOR_EXPORT_CONCURRENCY) {
    const batch = candidates.slice(index, index + VECTOR_EXPORT_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async ({ id, node }) => {
        const exportedAssets = new Map<string, AssetDescriptor>()
        const entry = await exportSvgEntry(node, config, exportedAssets, {
          vectorMode,
          colorModel: analyzeVectorColorModel(tree, id, cache)
        })
        return { entry, exportedAssets, id }
      })
    )

    results.forEach(({ entry, exportedAssets, id }) => {
      exportedAssets.forEach((asset, hash) => assetRegistry.set(hash, asset))
      if (!entry) {
        if (cache?.metrics) cache.metrics.vectorExportNull += 1
        return
      }
      recordVectorEntryMetrics(entry, cache)
      svgs.set(id, entry)
    })
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
