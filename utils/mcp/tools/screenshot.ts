import type { GetScreenshotResult } from '@/mcp/src/tools'

const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024
const SCALE_STEPS = [1, 0.75, 0.5, 0.25]

export async function handleGetScreenshot(node: SceneNode): Promise<GetScreenshotResult> {
  const { width, height } = node

  for (const scale of SCALE_STEPS) {
    const bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    })
    const withinLimit =
      bytes.byteLength <= SCREENSHOT_MAX_BYTES || scale === SCALE_STEPS[SCALE_STEPS.length - 1]

    if (withinLimit) {
      const base64 = figma.base64Encode(bytes)
      const dataUrl = `data:image/png;base64,${base64}`
      return {
        format: 'png',
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        dataUrl
      }
    }
  }

  throw new Error('Failed to generate screenshot within payload limits.')
}
