import { afterEach, describe, expect, it } from 'vitest'

import { resolveGradientFromPaints, resolveSolidFromPaints } from '../../src/figma/gradient'
import { installFigmaMocks, uninstallFigmaMocks } from './test-helpers'

function createStop(
  color: { r: number; g: number; b: number; a?: number },
  position: number,
  variableId?: string
): ColorStop {
  return {
    color: {
      ...color,
      a: color.a ?? 1
    },
    position,
    ...(variableId
      ? {
          boundVariables: {
            color: {
              id: variableId
            }
          }
        }
      : {})
  } as unknown as ColorStop
}

function createGradientPaint(
  type: GradientPaint['type'],
  options: {
    visible?: boolean
    opacity?: number
    stops?: ColorStop[]
    handles?: Vector[]
    transform?: Transform | null
  } = {}
): GradientPaint {
  return {
    type,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    gradientStops: options.stops ?? [
      createStop({ r: 1, g: 0, b: 0 }, 0),
      createStop({ r: 0, g: 0, b: 1 }, 1)
    ],
    gradientHandlePositions: options.handles ?? [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 }
    ],
    gradientTransform: options.transform ?? [
      [1, 0, 0],
      [0, 1, 0]
    ]
  } as unknown as GradientPaint
}

function createSolidPaint(
  color: { r: number; g: number; b: number },
  options: {
    visible?: boolean
    opacity?: number
    variableId?: string
  } = {}
): SolidPaint {
  return {
    type: 'SOLID',
    visible: options.visible ?? true,
    color,
    opacity: options.opacity ?? 1,
    ...(options.variableId
      ? {
          boundVariables: {
            color: {
              id: options.variableId
            }
          }
        }
      : {})
  } as unknown as SolidPaint
}

afterEach(() => {
  uninstallFigmaMocks()
})

describe('figma/gradient resolveGradientFromPaints', () => {
  it('returns null for invalid paint lists', () => {
    expect(resolveGradientFromPaints()).toBeNull()
    expect(resolveGradientFromPaints(null)).toBeNull()
    expect(resolveGradientFromPaints('invalid' as unknown as Paint[])).toBeNull()
  })

  it('picks the first visible gradient and resolves linear angle from handles', () => {
    const paints = [
      createGradientPaint('GRADIENT_LINEAR', { visible: false }),
      createSolidPaint({ r: 0, g: 1, b: 0 }),
      createGradientPaint('GRADIENT_LINEAR')
    ]

    expect(resolveGradientFromPaints(paints)).toBe('linear-gradient(270deg, #F00 0%, #00F 100%)')
  })

  it('falls back to gradient transform when handle positions are unavailable', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [] as Vector[],
      transform: [
        [0, 0, 0],
        [1, 0, 0]
      ]
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(0deg, #F00 0%, #00F 100%)')
  })

  it('omits angle when neither handles nor transform can resolve a direction', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [] as Vector[],
      transform: [] as unknown as Transform
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(#F00 0%, #00F 100%)')
  })

  it('omits angle when transform rows are malformed', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [] as Vector[],
      transform: [[1], [0, 1, 0]] as unknown as Transform
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(#F00 0%, #00F 100%)')
  })

  it('omits angle when handle vectors are incomplete', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [undefined as unknown as Vector, { x: 1, y: 0 }],
      transform: [] as unknown as Transform
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(#F00 0%, #00F 100%)')
  })

  it('omits angle when handle vectors are zero-length and transform is unusable', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [
        { x: 1, y: 1 },
        { x: 1, y: 1 }
      ],
      transform: [] as unknown as Transform
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(#F00 0%, #00F 100%)')
  })

  it('omits angle when transform contains non-finite values', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [] as Vector[],
      transform: [
        [Number.POSITIVE_INFINITY, 0, 0],
        [0, 1, 0]
      ]
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(#F00 0%, #00F 100%)')
  })

  it('omits angle when transform resolves to a zero vector', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR', {
      handles: [] as Vector[],
      transform: [
        [0, 0, 0],
        [0, 1, 0]
      ]
    })

    expect(resolveGradientFromPaints([paint])).toBe('linear-gradient(#F00 0%, #00F 100%)')
  })

  it('maps radial and angular gradient types to CSS functions', () => {
    expect(resolveGradientFromPaints([createGradientPaint('GRADIENT_RADIAL')])).toBe(
      'radial-gradient(#F00 0%, #00F 100%)'
    )
    expect(resolveGradientFromPaints([createGradientPaint('GRADIENT_DIAMOND')])).toBe(
      'radial-gradient(#F00 0%, #00F 100%)'
    )
    expect(resolveGradientFromPaints([createGradientPaint('GRADIENT_ANGULAR')])).toBe(
      'conic-gradient(#F00 0%, #00F 100%)'
    )
  })

  it('returns null for unsupported gradient paint type', () => {
    const paint = createGradientPaint('GRADIENT_LINEAR')
    ;(paint as { type: string }).type = 'GRADIENT_UNKNOWN'

    expect(resolveGradientFromPaints([paint])).toBeNull()
  })

  it('uses color-mix for variable-bound stop color with transparency', () => {
    installFigmaMocks({
      variables: {
        accent: { name: 'Primary Color' } as Variable
      }
    })

    const paint = createGradientPaint('GRADIENT_RADIAL', {
      opacity: 0.5,
      stops: [createStop({ r: 1, g: 0, b: 0 }, 0, 'accent'), createStop({ r: 0, g: 0, b: 1 }, 1)]
    })

    expect(resolveGradientFromPaints([paint])).toBe(
      'radial-gradient(color-mix(in srgb, var(--Primary-Color, #F00) 50%, transparent) 0%, #0000FF80 100%)'
    )
  })

  it('falls back to numeric defaults when opacity or stop alpha are missing', () => {
    const paint = createGradientPaint('GRADIENT_RADIAL', {
      stops: [
        {
          color: { r: 1, g: 0, b: 0 },
          position: 0
        } as unknown as ColorStop,
        {
          color: { r: 0, g: 0, b: 1 },
          position: 1
        } as unknown as ColorStop
      ]
    })
    ;(paint as { opacity?: unknown }).opacity = undefined

    expect(resolveGradientFromPaints([paint])).toBe('radial-gradient(#F00 0%, #00F 100%)')
  })

  it('returns direct CSS var fallback for near-opaque variable-bound stop color', () => {
    installFigmaMocks({
      variables: {
        accent: { name: 'Primary Color' } as Variable
      }
    })

    const paint = createGradientPaint('GRADIENT_RADIAL', {
      stops: [createStop({ r: 1, g: 0, b: 0 }, 0, 'accent'), createStop({ r: 0, g: 0, b: 1 }, 1)]
    })

    expect(resolveGradientFromPaints([paint])).toBe(
      'radial-gradient(var(--Primary-Color, #F00) 0%, #00F 100%)'
    )
  })

  it('falls back to literal stop color when variable lookup throws', () => {
    installFigmaMocks({
      variableErrors: ['accent']
    })

    const paint = createGradientPaint('GRADIENT_RADIAL', {
      opacity: 0.5,
      stops: [createStop({ r: 1, g: 0, b: 0 }, 0, 'accent'), createStop({ r: 0, g: 0, b: 1 }, 1)]
    })

    expect(resolveGradientFromPaints([paint])).toBe('radial-gradient(#FF000080 0%, #0000FF80 100%)')
  })

  it('falls back to literal stop color when variable lookup returns null', () => {
    installFigmaMocks()
    const paint = createGradientPaint('GRADIENT_RADIAL', {
      stops: [createStop({ r: 1, g: 0, b: 0 }, 0, 'missing')]
    })

    expect(resolveGradientFromPaints([paint])).toBe('radial-gradient(#F00 0%)')
  })
})

describe('figma/gradient resolveSolidFromPaints', () => {
  it('returns null for invalid paint lists', () => {
    expect(resolveSolidFromPaints()).toBeNull()
    expect(resolveSolidFromPaints(null)).toBeNull()
    expect(resolveSolidFromPaints('invalid' as unknown as Paint[])).toBeNull()
  })

  it('returns null when there is no visible solid paint', () => {
    const paints = [
      createGradientPaint('GRADIENT_LINEAR'),
      createSolidPaint({ r: 1, g: 0, b: 0 }, { visible: false })
    ]
    expect(resolveSolidFromPaints(paints)).toBeNull()
  })

  it('returns null when visible solid paint has no color payload', () => {
    const paints = [
      {
        type: 'SOLID',
        visible: true
      } as SolidPaint
    ]
    expect(resolveSolidFromPaints(paints)).toBeNull()
  })

  it('returns css variable fallback when solid paint is bound to a variable', () => {
    installFigmaMocks({
      variables: {
        token: { name: 'Theme / Primary Color' } as Variable
      }
    })

    const paints = [createSolidPaint({ r: 0, g: 1, b: 0 }, { variableId: 'token' })]
    expect(resolveSolidFromPaints(paints)).toBe('var(--Theme---Primary-Color, #0F0)')
  })

  it('prefers WEB codeSyntax identifier for bound solid paint variable names', () => {
    installFigmaMocks({
      variables: {
        token: {
          name: 'Theme / Primary Color',
          codeSyntax: { WEB: 'AliasesGreengreen-40' }
        } as Variable
      }
    })

    const paints = [createSolidPaint({ r: 0, g: 1, b: 0 }, { variableId: 'token' })]
    expect(resolveSolidFromPaints(paints)).toBe('var(--AliasesGreengreen-40, #0F0)')
  })

  it('falls back to literal color when bound variable resolution fails', () => {
    installFigmaMocks({
      variableErrors: ['token']
    })

    const paints = [createSolidPaint({ r: 1, g: 0, b: 0 }, { variableId: 'token', opacity: 0.5 })]
    expect(resolveSolidFromPaints(paints)).toBe('#FF000080')
  })

  it('falls back to literal color when bound variable lookup returns null', () => {
    installFigmaMocks()
    const paints = [createSolidPaint({ r: 1, g: 0, b: 0 }, { variableId: 'token' })]
    expect(resolveSolidFromPaints(paints)).toBe('#F00')
  })
})
