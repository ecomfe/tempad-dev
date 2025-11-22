import type { GetScreenshotResult } from '@/mcp/src/tools'

const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024
const SCALE_STEPS = [1, 0.75, 0.5, 0.25]

async function exportAtScale(node: SceneNode, scale: number): Promise<Uint8Array> {
  return node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale }
  })
}

export async function handleGetScreenshot(node: SceneNode): Promise<GetScreenshotResult> {
  const { width, height } = node
  let lastAttemptBytes = 0

  for (const scale of SCALE_STEPS) {
    const bytes = await exportAtScale(node, scale)
    lastAttemptBytes = bytes.byteLength

    if (bytes.byteLength <= SCREENSHOT_MAX_BYTES) {
      const base64 = figma.base64Encode(bytes)
      const dataUrl = `data:image/png;base64,${base64}`
      return {
        format: 'png',
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
        bytes: bytes.byteLength,
        dataUrl
      }
    }
  }

  throw new Error(
    `Screenshot payload exceeded ${SCREENSHOT_MAX_BYTES} bytes (last attempt ${lastAttemptBytes} bytes).`
  )
}
