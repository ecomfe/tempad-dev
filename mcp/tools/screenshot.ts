import type { GetScreenshotResult } from '@/mcp-server/src/tools'

import { MCP_MAX_PAYLOAD_BYTES } from '@/mcp/shared/constants'

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
  const { width, height } = node

  for (const scale of SCALE_STEPS) {
    const bytes = await exportAtScale(node, scale)
    const { byteLength } = bytes

    if (byteLength <= SCREENSHOT_MAX_BYTES) {
      const base64 = figma.base64Encode(bytes)
      const dataUrl = `data:image/png;base64,${base64}`
      return {
        format: 'png',
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
        bytes: byteLength,
        dataUrl
      }
    }
  }

  throw new Error(
    'Screenshot payload too large to return. Reduce selection size or scale and retry.'
  )
}
