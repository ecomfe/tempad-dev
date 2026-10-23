import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { resetAssetCache, setAssetServerUrl, setAssetUploader } from '@/mcp/assets'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'
import { renderTree } from '@/mcp/tools/code/render'
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
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'

vi.mock('@/ui/state', () => ({ activePlugin: { value: undefined } }))

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

function fixtureCss(host: HTMLElement): string {
  // These fixtures need only positioning, dimensions and arbitrary properties.
  // Expand emitted classes, never the pre-serialization presentationStyle: the
  // old canvas test reapplied that matrix and hid its loss from generated code.
  const properties: Record<string, string> = { w: 'width', h: 'height', left: 'left', top: 'top' }
  const classes = new Set([...host.querySelectorAll('[class]')].flatMap((el) => [...el.classList]))
  return [...classes]
    .map((className) => {
      let declaration: string
      if (className === 'absolute' || className === 'relative') {
        declaration = `position:${className}`
      } else {
        const dimension = className.match(/^(-?)(w|h|left|top)-\[(.+)\]$/)
        const arbitrary = className.match(/^\[([^:]+):(.+)\]$/)
        if (dimension) {
          declaration = `${properties[dimension[2]!]}:${dimension[1]}${dimension[3]}`
        } else if (arbitrary) {
          declaration = `${arbitrary[1]}:${arbitrary[2]!.replaceAll('_', ' ')}`
        } else {
          throw new Error(`Unsupported fixture utility: ${className}`)
        }
      }
      return `.${CSS.escape(className)}{${declaration}}`
    })
    .join('\n')
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

it.each(cases.flatMap((fixture) => [false, true].map((inline) => ({ ...fixture, inline }))))(
  'matches the native Figma screenshot through generated markup: $name (inline=$inline)',
  async ({ svg, png, frame, size, position, angle, inline }) => {
    await page.viewport(frame[0], frame[1])
    const cos = Math.cos((angle * Math.PI) / 180)
    const sin = Math.sin((angle * Math.PI) / 180)
    const transform: Transform = [
      [cos, -sin, position[0]],
      [sin, cos, position[1]]
    ]
    const node = {
      id: 'native-vector',
      type: 'VECTOR',
      width: size[0],
      height: size[1],
      absoluteTransform: transform,
      relativeTransform: transform,
      exportAsync: vi.fn(async () => new TextEncoder().encode(svg))
    } as unknown as SceneNode
    let uploaded = ''
    setAssetUploader(async ({ bytes }) => {
      if (inline) throw new Error('Asset upload unavailable')
      uploaded = new TextDecoder().decode(bytes)
    })
    const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
    const entry = await exportSvgEntry(node, config, new Map(), { vectorMode: 'snapshot' })
    if (!entry) throw new Error('Expected SVG export')
    expect(Boolean(entry.raw)).toBe(inline)
    if (!angle) expect(entry.props.viewBox).toBe(`0 0 ${size[0]} ${size[1]}`)
    const snapshot = createSnapshot({ id: node.id, type: node.type })
    snapshot.node = node
    const rendered = await renderTree(node.id, createTree([snapshot]), {
      styles: new Map(),
      layout: new Map([
        [node.id, { position: 'absolute', left: `${position[0]}px`, top: `${position[1]}px` }]
      ]),
      nodes: new Map([[node.id, node]]),
      svgs: new Map([[node.id, entry]]),
      textSegments: new Map(),
      config,
      preferredLang: 'vue'
    })
    if (!rendered || typeof rendered === 'string') throw new Error('Expected rendered SVG')
    const host = document.createElement('div')
    host.dataset.testid = 'native-vector-frame'
    host.style.cssText = `position:relative;width:${frame[0]}px;height:${frame[1]}px;overflow:hidden;background:white`
    host.innerHTML = stringifyComponent(rendered, 'vue')
    const style = document.createElement('style')
    style.textContent = fixtureCss(host)
    host.prepend(style)
    // Resolve the emitted placeholder to the uploaded external asset, preserving
    // its markup placement and size rather than reading SvgEntry geometry back.
    for (const placeholder of host.querySelectorAll('svg[data-src]')) {
      const image = await loadImage(`data:image/svg+xml,${encodeURIComponent(uploaded)}`)
      image.className = placeholder.getAttribute('class') ?? ''
      image.style.cssText = placeholder.getAttribute('style') ?? ''
      image.style.width = placeholder.getAttribute('width')!
      image.style.height = placeholder.getAttribute('height')!
      placeholder.replaceWith(image)
    }
    document.body.append(host)
    const canvas = document.createElement('canvas')
    canvas.width = frame[0]
    canvas.height = frame[1]
    const ctx = canvas.getContext('2d')!
    try {
      if (angle) {
        const layoutRoot = host.querySelector('div, svg, img')!
        const computed = getComputedStyle(layoutRoot)
        const matrix = new DOMMatrix(computed.transform)
        expect(matrix.a).toBeCloseTo(cos, 5)
        expect(matrix.b).toBeCloseTo(sin, 5)
        expect(matrix.c).toBeCloseTo(-sin, 5)
        expect(matrix.d).toBeCloseTo(cos, 5)
        expect([matrix.e, matrix.f]).toEqual([0, 0])
        expect(computed.transformOrigin).toBe('0px 0px')
      }
      const screenshot = await page.getByTestId('native-vector-frame').screenshot({ base64: true })
      const image = await loadImage(`data:image/png;base64,${screenshot.base64}`)
      expect([image.width, image.height]).toEqual(frame)
      ctx.drawImage(image, 0, 0)
    } finally {
      host.remove()
    }
    const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
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
      if (maxDifference > 64) differentPixels++
    }
    // CSS-transformed SVG edges are composited differently from Figma's native
    // rasterization. Keep the whole-frame mean strict while allowing edge AA;
    // fewer than 0.5% of pixels may differ by more than one quarter of a channel.
    expect(totalDifference / actual.length).toBeLessThan(0.3)
    expect(differentPixels / (actual.length / 4)).toBeLessThan(0.005)
  }
)
