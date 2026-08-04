import type { GetScreenshotResult } from '@tempad-dev/shared'

import { MCP_MAX_ASSET_BYTES } from '@tempad-dev/shared'

import { ensureAssetUploaded } from '@/mcp/assets'

const SCALE_STEPS = [1, 0.75, 0.5, 0.25]

export async function handleGetScreenshot(node: SceneNode): Promise<GetScreenshotResult> {
  for (const scale of SCALE_STEPS) {
    const bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    })
    const { byteLength } = bytes

    if (byteLength <= MCP_MAX_ASSET_BYTES) {
      const width = Math.round(node.width * scale)
      const height = Math.round(node.height * scale)
      const asset = await ensureAssetUploaded(bytes, 'image/png', { width, height })

      return {
        format: 'png',
        width,
        height,
        scale,
        bytes: byteLength,
        asset
      }
    }
  }

  throw new Error(
    'Screenshot exceeds the asset upload limit at every supported scale. Reduce selection size and retry.'
  )
}
