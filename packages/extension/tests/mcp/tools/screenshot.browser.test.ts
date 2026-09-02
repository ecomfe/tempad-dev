import { describe, expect, it } from 'vitest'

import { cropPngWithCanvas, rasterizeSvgWithCanvas } from '@/mcp/tools/screenshot'

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Could not encode test PNG.'))
        return
      }
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })
}

describe('mcp/tools/screenshot browser crop', () => {
  it('decodes, crops, and re-encodes the exact requested PNG region', async () => {
    const source = document.createElement('canvas')
    source.width = 4
    source.height = 2
    const sourceContext = source.getContext('2d')
    if (!sourceContext) throw new Error('Expected source canvas context.')
    sourceContext.fillStyle = '#ff0000'
    sourceContext.fillRect(0, 0, 2, 2)
    sourceContext.fillStyle = '#0000ff'
    sourceContext.fillRect(2, 0, 2, 2)

    const croppedBytes = await cropPngWithCanvas(await canvasToPng(source), {
      x: 2,
      y: 0,
      width: 2,
      height: 2
    })
    const bitmap = await createImageBitmap(
      new Blob([croppedBytes.slice().buffer], { type: 'image/png' })
    )

    try {
      expect(bitmap.width).toBe(2)
      expect(bitmap.height).toBe(2)
      const output = document.createElement('canvas')
      output.width = 2
      output.height = 2
      const outputContext = output.getContext('2d')
      if (!outputContext) throw new Error('Expected output canvas context.')
      outputContext.drawImage(bitmap, 0, 0)
      expect([...outputContext.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
    } finally {
      bitmap.close()
    }
  })

  it('rasterizes SVG screenshots at the requested scale', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="#00ff00"/></svg>'
    )

    const png = await rasterizeSvgWithCanvas(svg, 2)
    const bitmap = await createImageBitmap(new Blob([png.slice().buffer], { type: 'image/png' }))

    try {
      expect(bitmap.width).toBe(8)
      expect(bitmap.height).toBe(4)
    } finally {
      bitmap.close()
    }
  })
})
