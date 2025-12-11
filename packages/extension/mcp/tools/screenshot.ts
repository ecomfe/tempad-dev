import type { GetScreenshotResult } from '@tempad-dev/mcp-shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/mcp-shared'

import { ensureAssetUploaded } from '@/mcp/assets'

// Limit raw PNG bytes so the base64 data URL stays under the transport cap.
const DATA_URL_PREFIX_LENGTH = 'data:image/png;base64,'.length
const MAX_BASE64_BYTES = Math.max(0, MCP_MAX_PAYLOAD_BYTES - DATA_URL_PREFIX_LENGTH)
const SCREENSHOT_MAX_BYTES = Math.floor((MAX_BASE64_BYTES * 3) / 4)
const SCALE_STEPS = [1, 0.75, 0.5, 0.25]

async function exportAtScale(node: SceneNode, scale: number): Promise<Uint8Array> {
  return node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale }
  })
}

export async function handleGetScreenshot(node: SceneNode): Promise<GetScreenshotResult> {
  for (const scale of SCALE_STEPS) {
    const bytes = await exportAtScale(node, scale)
    const { byteLength } = bytes

    if (byteLength <= SCREENSHOT_MAX_BYTES) {
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
    'Screenshot payload too large to return. Reduce selection size or scale and retry.'
  )
}
