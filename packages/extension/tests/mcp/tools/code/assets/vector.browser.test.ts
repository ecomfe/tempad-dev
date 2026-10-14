import { describe, expect, it, vi } from 'vitest'

vi.mock('@/mcp/assets', () => ({ ensureAssetUploaded: vi.fn() }))
vi.mock('@/utils/log', () => ({ logger: { warn: vi.fn() } }))

import { ensureAssetUploaded } from '@/mcp/assets'
import { exportSvgEntry, extractSvgAttributes } from '@/mcp/tools/code/assets/vector'

const fixtures = [
  { frame: [636, 743], size: [1102.423, 956.631], position: [-575.458, -213.744] },
  { frame: [1300, 834], size: [1159.371, 953.055], position: [-54, -177] }
] as const

const pxConfig = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const

function imageOf(svg: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return image.decode().then(() => image)
}

async function render(
  svg: string,
  frame: readonly [number, number],
  position: readonly [number, number],
  size: readonly [number, number]
): Promise<Uint8ClampedArray> {
  const image = await imageOf(svg)
  const canvas = document.createElement('canvas')
  ;[canvas.width, canvas.height] = frame
  const context = canvas.getContext('2d')!
  context.drawImage(image, position[0], position[1], size[0], size[1])
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

describe('vector export viewport', () => {
  it.each(fixtures)(
    'keeps asset and inline placement consistent in a $frame clipping frame',
    async ({ frame, size, position }) => {
      const [width, height] = size
      // Synthetic export: its viewport origin differs from its path bounds, and
      // its integer intrinsic dimensions differ from the fractional node size.
      // This tests our delivery paths, not Figma's implementation of exportAsync.
      const viewBox = `-24 -18 ${width} ${height}`
      const content =
        '<defs><clipPath id="cut"><rect x="-10" y="30" width="950" height="810"/></clipPath></defs><g clip-path="url(#cut)" transform="translate(13 27)"><path d="M-448.5 0H668.5V825.5H-448.5Z" fill="#1357bd"/><path d="M300 100H900V600H300Z" fill="#db4731"/></g>'
      const exported = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="${viewBox}">${content}</svg>`
      const node = {
        id: 'offset-vector',
        width,
        height,
        exportAsync: vi.fn(async () => new TextEncoder().encode(exported))
      } as unknown as SceneNode
      let uploaded = ''
      vi.mocked(ensureAssetUploaded).mockImplementation(async (bytes) => {
        uploaded = new TextDecoder().decode(bytes)
        return {
          hash: 'vector',
          url: 'https://assets.test/vector.svg',
          mimeType: 'image/svg+xml',
          size: bytes.length
        }
      })

      const entry = await exportSvgEntry(node, pxConfig, new Map(), { vectorMode: 'snapshot' })
      expect(node.exportAsync).toHaveBeenCalledWith({ format: 'SVG', useAbsoluteBounds: true })
      expect(extractSvgAttributes(uploaded)).toMatchObject({
        width: entry!.props.width,
        height: entry!.props.height,
        viewBox: `0 0 ${width} ${height}`
      })
      expect(uploaded).toContain('M-448.5 0H668.5V825.5H-448.5Z')
      expect(uploaded).toContain('transform="translate(13 27)"')

      vi.mocked(ensureAssetUploaded).mockRejectedValue(new Error('offline'))
      const fallback = await exportSvgEntry(node, pxConfig, new Map(), { vectorMode: 'snapshot' })
      const assetPixels = await render(uploaded, frame, position, size)
      const inlinePixels = await render(fallback!.raw!, frame, position, size)
      expect(assetPixels.some((value) => value !== 0)).toBe(true)
      expect(assetPixels.every((value, index) => value === inlinePixels[index])).toBe(true)

      // An independently composed frame places the same native viewport at the
      // markup's offset. The browser, rather than a path-bounds heuristic, clips it.
      const reference = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame[0]}" height="${frame[1]}"><svg x="${position[0]}" y="${position[1]}" width="${width}" height="${height}" viewBox="${viewBox}">${content}</svg></svg>`
      const referencePixels = await render(reference, frame, [0, 0], frame)
      expect(referencePixels.length).toBe(assetPixels.length)
      let difference = 0
      for (let i = 0; i < assetPixels.length; i++)
        difference += Math.abs(assetPixels[i]! - referencePixels[i]!)
      // Allow subpixel antialiasing differences between standalone and nested SVG.
      expect(difference / assetPixels.length).toBeLessThan(0.1)
    }
  )

  it('keeps asset coordinates in design pixels for scaled rem output', async () => {
    const node = {
      id: 'scaled-vector',
      width: 160,
      height: 80,
      exportAsync: vi.fn(async () =>
        new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="161" height="81" viewBox="-10 20 160 80"><path d="M0 30h80v40H0Z" fill="red"/></svg>'
        )
      )
    } as unknown as SceneNode
    let uploaded = ''
    vi.mocked(ensureAssetUploaded).mockImplementation(async (bytes) => {
      uploaded = new TextDecoder().decode(bytes)
      return {
        hash: 'scaled',
        url: 'https://assets.test/scaled.svg',
        mimeType: 'image/svg+xml',
        size: bytes.length
      }
    })
    const entry = await exportSvgEntry(
      node,
      { cssUnit: 'rem', rootFontSize: 16, scale: 2 },
      new Map()
    )
    expect(entry!.props).toMatchObject({
      width: '20rem',
      height: '10rem',
      viewBox: '0 0 160 80'
    })
    expect(extractSvgAttributes(uploaded)).toMatchObject({
      width: '160px',
      height: '80px',
      viewBox: '0 0 160 80'
    })
    const image = await imageOf(uploaded)
    expect([image.naturalWidth, image.naturalHeight]).toEqual([160, 80])
  })
})
