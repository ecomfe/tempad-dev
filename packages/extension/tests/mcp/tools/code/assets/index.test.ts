import { describe, expect, it } from 'vitest'

import * as assets from '@/mcp/tools/code/assets'
import { exportVectorAssets } from '@/mcp/tools/code/assets/export'
import { hasMediaFills, replaceMediaUrlsWithAssets } from '@/mcp/tools/code/assets/media'
import { planAssets } from '@/mcp/tools/code/assets/plan'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'

describe('assets/index exports', () => {
  it('re-exports asset helpers from submodules', () => {
    expect(assets.planAssets).toBe(planAssets)
    expect(assets.exportSvgEntry).toBe(exportSvgEntry)
    expect(assets.exportVectorAssets).toBe(exportVectorAssets)
    expect(assets.hasMediaFills).toBe(hasMediaFills)
    expect(assets.replaceMediaUrlsWithAssets).toBe(replaceMediaUrlsWithAssets)
  })
})
