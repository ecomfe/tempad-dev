import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'
import { cleanFigmaSpecificStyles } from '@/mcp/tools/code/styles/background'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))
vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: async () => ({
    hash: 'image',
    url: 'https://assets.test/image.png',
    mimeType: 'image/png',
    size: 4
  })
}))
afterEach(() => vi.unstubAllGlobals())

// Native getCSSAsync output captured from the R6 Figma acceptance fixture.
const corners = ['bottom right', 'bottom left', 'top left', 'top right']
const samples = [
  {
    type: 'GRADIENT_ANGULAR' as const,
    css: 'conic-gradient(from 90deg at 50% 50%, rgba(128, 128, 255, 0.38) 0deg, var(--Blue) 90deg, rgba(255, 255, 255, 0.50) 270deg, rgba(128, 128, 255, 0.38) 360deg)',
    colorCount: 1
  },
  {
    type: 'GRADIENT_DIAMOND' as const,
    css: corners
      .map(
        (corner) =>
          `linear-gradient(to ${corner}, var(--Blue) 13%, rgba(255, 255, 255, 0.50) 38%) ${corner} / 50% 50% no-repeat`
      )
      .join(', '),
    colorCount: 4
  }
]

function setup() {
  const color = { r: 0, g: 0, b: 1, a: 0.5 }
  const variable = {
    id: 'blue',
    name: 'Blue',
    variableCollectionId: 'colors',
    resolvedType: 'COLOR',
    scopes: ['ALL_FILLS'],
    valuesByMode: { base: color },
    resolveForConsumer: () => ({ value: color, resolvedType: 'COLOR' })
  }
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    getStyleById: () => null,
    variables: {
      getVariableById: () => variable,
      getVariableCollectionById: () => ({
        id: 'colors',
        name: 'Colors',
        defaultModeId: 'base',
        modes: [{ modeId: 'base', name: 'Default' }]
      })
    },
    getImageByHash: () => ({
      getBytesAsync: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    })
  })
}

function gradient(type: GradientPaint['type'], opacity = 0.5): GradientPaint {
  return {
    type,
    opacity,
    gradientTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    gradientStops: [
      {
        position: 0.25,
        color: { r: 0, g: 0, b: 1, a: 0.5 },
        boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'blue' } }
      },
      { position: 0.75, color: { r: 1, g: 1, b: 1, a: 1 } }
    ]
  }
}

it.each(
  samples.flatMap((sample) =>
    [false, true].flatMap((image) =>
      [false, true].map((resolveTokens) => ({ ...sample, image, resolveTokens }))
    )
  )
)(
  'preserves native $type topology and opacity (image=$image, resolve=$resolveTokens)',
  async ({ type, css, colorCount, image, resolveTokens }) => {
    setup()
    const node = {
      id: 'root',
      type: 'FRAME',
      name: 'native gradient',
      visible: true,
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 160 },
      children: [],
      strokes: [],
      effects: [],
      fills: [
        ...(image ? [{ type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' }] : []),
        gradient(type)
      ],
      getCSSAsync: async () => ({
        background: css + (image ? ', url(image) lightgray center / cover no-repeat' : '')
      })
    } as unknown as SceneNode
    const result = await handleGetCode([node], 'jsx', resolveTokens)
    const code = result.code.replaceAll('_', ' ')
    expect(
      code.match(
        resolveTokens
          ? /rgba\(0, 0, 255, 0\.25\)/g
          : /color-mix\(in srgb, var\(--Blue\) 50%, transparent\)/g
      )
    ).toHaveLength(colorCount)
    expect(result.tokens?.['--Blue']).toEqual({ kind: 'color', value: '#0000FF80' })
    expect(result.assets?.length ?? 0).toBe(image ? 1 : 0)
    if (image) expect(code).toContain('https://assets.test/image.png')
    if (type === 'GRADIENT_ANGULAR') {
      expect(code).toContain('from 90deg at 50% 50%')
      expect(code).toContain('rgba(128, 128, 255, 0.38) 0deg')
      expect(code).toContain('rgba(128, 128, 255, 0.38) 360deg')
      expect(code).toContain('90deg')
      expect(code).toContain('270deg')
    } else {
      expect(code.match(/linear-gradient\(/g)).toHaveLength(4)
      expect(code).not.toContain('radial-gradient(')
      for (const corner of corners) {
        expect(code).toContain(`to ${corner}`)
        expect(code).toContain(`${corner} / 50% 50% no-repeat`)
      }
      expect(code.match(/ 13%/g)).toHaveLength(4)
      expect(code.match(/ 38%/g)).toHaveLength(4)
    }
  }
)

it('keeps paint ownership when diamond and angular gradients share a variable with different opacities', () => {
  setup()
  const diamond = samples[1]!.css
  const angular = samples[0]!.css
  const style = cleanFigmaSpecificStyles({ background: `${diamond}, url(image), ${angular}` }, {
    type: 'FRAME',
    fills: [gradient('GRADIENT_ANGULAR', 0.25), { type: 'IMAGE' }, gradient('GRADIENT_DIAMOND')]
  } as unknown as SceneNode)
  expect(style.background?.match(/var\(--Blue\) 50%/g)).toHaveLength(4)
  expect(style.background?.match(/var\(--Blue\) 25%/g)).toHaveLength(1)
  expect(style.background).toContain('url(image)')
  expect(style.background).toContain('rgba(128, 128, 255, 0.38) 0deg')
})
