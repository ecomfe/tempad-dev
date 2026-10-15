import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { resetAssetCache, setAssetServerUrl, setAssetUploader } from '@/mcp/assets'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'
import leftTopPng from '@/tests/fixtures/svg/left-top.png?url'
import leftTopSvg from '@/tests/fixtures/svg/left-top.svg?raw'
import nativeFill from '@/tests/fixtures/svg/native-fill-control.svg?raw'
import nativeStroke from '@/tests/fixtures/svg/native-outside-stroke.svg?raw'
import nativeOverflow from '@/tests/fixtures/svg/native-overflow.png?url'
import nativeShadow from '@/tests/fixtures/svg/native-shadow.svg?raw'
import rightPng from '@/tests/fixtures/svg/right.png?url'
import rightSvg from '@/tests/fixtures/svg/right.svg?raw'
import rotatedPng from '@/tests/fixtures/svg/rotated.png?url'
import rotatedSvg from '@/tests/fixtures/svg/rotated.svg?raw'
import widePng from '@/tests/fixtures/svg/wide.png?url'
import wideSvg from '@/tests/fixtures/svg/wide.svg?raw'

beforeEach(() => {
  resetAssetCache()
  setAssetServerUrl('https://assets.test')
})

afterEach(() => {
  setAssetUploader(null)
  setAssetServerUrl(null)
  resetAssetCache()
})

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
] as const

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

it('preserves native outside strokes and shadow pixels beyond the node layout box', async () => {
  // Captured together by native task 5c84 on page 2772:2, frame 2772:18.
  // Original full-node SVGs preserve paint geometry but clip it at 64 × 48.
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 200
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, 400, 200)
  for (const { svg, x, bounds } of [
    { svg: nativeStroke, x: 40, bounds: { x: 28, y: 36, width: 88, height: 72 } },
    { svg: nativeShadow, x: 160, bounds: { x: 160, y: 48, width: 88, height: 68 } },
    { svg: nativeFill, x: 280, bounds: { x: 280, y: 48, width: 64, height: 48 } }
  ]) {
    let uploaded = ''
    setAssetUploader(async ({ bytes }) => {
      uploaded = new TextDecoder().decode(bytes)
    })
    const node = {
      id: String(x),
      width: 64,
      height: 48,
      absoluteTransform: [
        [1, 0, x],
        [0, 1, 48]
      ],
      absoluteRenderBounds: bounds,
      exportAsync: async () => new TextEncoder().encode(svg)
    } as unknown as SceneNode
    const entry = (await exportSvgEntry(
      node,
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      new Map()
    ))!
    ctx.drawImage(
      await loadImage(`data:image/svg+xml,${encodeURIComponent(uploaded)}`),
      x + parseFloat(entry.wrapper?.left ?? '0'),
      48 + parseFloat(entry.wrapper?.top ?? '0'),
      parseFloat(entry.props.width!),
      parseFloat(entry.props.height!)
    )
  }
  const actual = ctx.getImageData(0, 0, 400, 200).data
  ctx.drawImage(await loadImage(nativeOverflow), 0, 0)
  const expected = ctx.getImageData(0, 0, 400, 200).data
  // Include points outside both layout boxes, which the old assets lose entirely.
  for (const [x, y] of [
    [30, 60],
    [80, 38],
    [230, 80],
    [200, 105],
    [310, 70]
  ] as const) {
    const offset = (y * 400 + x) * 4
    for (let channel = 0; channel < 4; channel++) {
      expect(Math.abs(actual[offset + channel]! - expected[offset + channel]!)).toBeLessThan(10)
    }
  }
})

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
    setAssetUploader(async ({ bytes }) => {
      uploaded = new TextDecoder().decode(bytes)
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
      ?.match(/matrix\((.+)\)/)?.[1]!
      .split(',')
      .map(Number) ?? [1, 0, 0, 1, 0, 0]
    expect(matrix).toHaveLength(6)
    ctx.setTransform(matrix[0]!, matrix[1]!, matrix[2]!, matrix[3]!, position[0], position[1])
    ctx.drawImage(
      image,
      Number.parseFloat(entry!.wrapper?.left ?? '0'),
      Number.parseFloat(entry!.wrapper?.top ?? '0'),
      Number.parseFloat(entry!.props.width!),
      Number.parseFloat(entry!.props.height!)
    )
    const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    ctx.resetTransform()
    ctx.drawImage(await loadImage(png), 0, 0)
    const expected = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    expect(expected.length).toBe(actual.length)
    let totalDifference = 0
    let differentPixels = 0
    for (let i = 0; i < actual.length; i += 4) {
      let maxDifference = 0
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(actual[i + channel]! - expected[i + channel]!)
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
