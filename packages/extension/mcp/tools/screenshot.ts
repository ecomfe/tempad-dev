import type { GetScreenshotResult } from '@tempad-dev/shared'

import { MCP_MAX_ASSET_BYTES } from '@tempad-dev/shared'

import { ensureAssetUploaded } from '@/mcp/assets'

const SCALE_STEPS = [1, 0.75, 0.5, 0.25]

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const isPng =
    bytes.byteLength >= 24 &&
    signature.every((value, index) => bytes[index] === value) &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52

  if (!isPng) {
    throw new Error('Figma returned an invalid PNG screenshot.')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)

  if (width === 0 || height === 0) {
    throw new Error('Figma returned a PNG screenshot with invalid dimensions.')
  }

  return { width, height }
}

export async function handleGetScreenshot(node: SceneNode): Promise<GetScreenshotResult> {
  for (const scale of SCALE_STEPS) {
    const bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    })
    const { byteLength } = bytes

    if (byteLength <= MCP_MAX_ASSET_BYTES) {
      const { width, height } = readPngDimensions(bytes)
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
