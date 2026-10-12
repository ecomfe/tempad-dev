import { expect, it, vi } from 'vitest'

vi.mock('@/mcp/assets', () => ({ ensureAssetUploaded: vi.fn() }))

import { ensureAssetUploaded } from '@/mcp/assets'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'
import leftTopPng from '@/tests/fixtures/svg/left-top.png?url'
import leftTopSvg from '@/tests/fixtures/svg/left-top.svg?raw'
import rightPng from '@/tests/fixtures/svg/right.png?url'
import rightSvg from '@/tests/fixtures/svg/right.svg?raw'
import rotatedPng from '@/tests/fixtures/svg/rotated.png?url'
import rotatedSvg from '@/tests/fixtures/svg/rotated.svg?raw'
import widePng from '@/tests/fixtures/svg/wide.png?url'
import wideSvg from '@/tests/fixtures/svg/wide.svg?raw'

// Native exports and frame screenshots captured together in TemPad Dev fixtures:
// file vJBML2e6g7btKGytwiiyvn, frame nodes 2738:4/8/12/18. Full-node exports
// retain Figma's integer viewports and baked geometry, including the 20° rotation.
const cases = [
  {
    name: 'left and top clipping',
    svg: leftTopSvg,
    png: leftTopPng,
    frame: [636, 743],
    size: [1102.423, 956.631],
    position: [-575.458, -213.744],
    angle: 0
  },
  {
    name: 'wide breakpoint',
    svg: wideSvg,
    png: widePng,
    frame: [1300, 834],
    size: [1159.371, 953.055],
    position: [-54, -177],
    angle: 0
  },
  {
    name: 'right clipping',
    svg: rightSvg,
    png: rightPng,
    frame: [1300, 600],
    size: [669.352, 465],
    position: [806.999, -0.028],
    angle: 0
  },
  {
    name: 'rotated vector',
    svg: rotatedSvg,
    png: rotatedPng,
    frame: [300, 200],
    size: [320, 240],
    position: [-30, -40],
    angle: 20
  }
]

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

it.each(cases)(
  'matches the native Figma screenshot: $name',
  async ({ svg, png, frame, size, position, angle }) => {
    const cos = Math.cos((angle * Math.PI) / 180)
    const sin = Math.sin((angle * Math.PI) / 180)
    const transform: Transform = [
      [cos, -sin, position[0]],
      [sin, cos, position[1]]
    ]
    const node = {
      id: 'native-vector',
      width: size[0],
      height: size[1],
      absoluteTransform: transform,
      relativeTransform: transform,
      exportAsync: vi.fn(async () => new TextEncoder().encode(svg))
    } as unknown as SceneNode
    let uploaded = ''
    vi.mocked(ensureAssetUploaded).mockImplementation(async (bytes) => {
      uploaded = new TextDecoder().decode(bytes)
      return {
        hash: 'native',
        mimeType: 'image/svg+xml',
        size: bytes.length,
        url: 'https://assets.test/native.svg'
      }
    })
    const entry = await exportSvgEntry(
      node,
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      new Map(),
      { vectorMode: 'snapshot' }
    )
    if (!angle) expect(entry!.props.viewBox).toBe(`0 0 ${size[0]} ${size[1]}`)
    const canvas = document.createElement('canvas')
    canvas.width = frame[0]
    canvas.height = frame[1]
    const ctx = canvas.getContext('2d')!
    const image = await loadImage(`data:image/svg+xml,${encodeURIComponent(uploaded)}`)
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // Apply exactly the markup's viewport size and placement, including its
    // emitted linear transform, with the clipping frame as the canvas viewport.
    const matrix = entry!.presentationStyle?.transform
      ?.match(/matrix\((.+)\)/)?.[1]
      .split(',')
      .map(Number) ?? [1, 0, 0, 1, 0, 0]
    ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], position[0], position[1])
    ctx.drawImage(
      image,
      Number.parseFloat(entry!.wrapper?.left ?? '0'),
      Number.parseFloat(entry!.wrapper?.top ?? '0'),
      Number.parseFloat(entry!.props.width),
      Number.parseFloat(entry!.props.height)
    )
    const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    ctx.resetTransform()
    ctx.drawImage(await loadImage(png), 0, 0)
    const expected = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let totalDifference = 0
    let differentPixels = 0
    for (let i = 0; i < actual.length; i += 4) {
      let maxDifference = 0
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(actual[i + channel] - expected[i + channel])
        totalDifference += difference
        maxDifference = Math.max(maxDifference, difference)
      }
      if (maxDifference > 16) differentPixels++
    }
    // Figma and Chromium antialias curved boundaries differently. Interior
    // colors, node origins and geometry must agree across the whole frame.
    expect(totalDifference / actual.length).toBeLessThan(0.3)
    expect(differentPixels / (actual.length / 4)).toBeLessThan(0.005)
  }
)
