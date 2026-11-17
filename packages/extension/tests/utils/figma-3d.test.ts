import { describe, expect, it } from 'vitest'

import { applyFigma3dStyles, hasFigma3d, readFigma3d } from '@/utils/figma-3d'

const transform3d = {
  type: 'FIXED_ORDER' as const,
  translateZ: 40,
  rotateX: 10,
  rotateY: -30,
  rotateZ: 5
}

describe('Figma 3D styles', () => {
  it('does not change styles or claim 3D state on older runtimes', () => {
    const properties = readFigma3d({ type: 'FRAME' } as SceneNode)
    const style = { transform: 'rotate(10deg)', opacity: '0.5' }
    expect(properties).toEqual({})
    expect(hasFigma3d(properties)).toBe(false)
    expect(hasFigma3d({ transform3d: { type: 'NONE' }, scene3d: null })).toBe(false)
    expect(hasFigma3d({ transform3d })).toBe(true)
    expect(hasFigma3d({ scene3d: { perspective: -1, preserve3d: true } })).toBe(true)
    expect(applyFigma3dStyles(style, properties)).toEqual(style)
  })

  it('adds ordered transforms, mixed-unit origin and backface visibility without mutating CSS', () => {
    const style = { transform: 'rotate(12deg)', width: '160px' }
    expect(
      applyFigma3dStyles(style, {
        transform3d: { ...transform3d, backfaceVisible: false },
        transformOrigin: { x: { unit: 'PERCENT', value: 0 }, y: { unit: 'PIXELS', value: 20 } }
      })
    ).toEqual({
      width: '160px',
      transform: 'rotate(12deg) translateZ(40px) rotateX(10deg) rotateY(-30deg) rotateZ(5deg)',
      'transform-origin': '0% 20px',
      'backface-visibility': 'hidden'
    })
    expect(style).toEqual({ transform: 'rotate(12deg)', width: '160px' })
  })

  it.each(['matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,40,1)', 'translateZ(40px) rotateY(-30deg)'])(
    'retains native 3D CSS without duplicating it: %s',
    (transform) => {
      expect(applyFigma3dStyles({ transform }, { transform3d })).toMatchObject({ transform })
      expect(
        applyFigma3dStyles(
          { transform },
          { transform3d: { type: 'FREEFORM', backfaceVisible: false } }
        )
      ).toMatchObject({ transform })
    }
  )

  it.each([undefined, 'none'])('builds the transform when native CSS is %s', (transform) => {
    expect(applyFigma3dStyles(transform ? { transform } : {}, { transform3d }).transform).toBe(
      'translateZ(40px) rotateX(10deg) rotateY(-30deg) rotateZ(5deg)'
    )
  })

  it('preserves hidden transform settings without emitting them', () => {
    expect(applyFigma3dStyles({}, { transform3d: { ...transform3d, visible: false } })).toEqual({})
  })

  it.each([{ ...transform3d, visible: false }, { type: 'NONE' as const }])(
    'removes disabled native 3D CSS while retaining separate 2D rotation',
    (transform) => {
      const style = {
        width: '160px',
        transform: 'translateZ(40px) rotateY(-30deg)',
        'transform-origin': '25% 20px',
        'backface-visibility': 'hidden'
      }
      const properties = { transform3d: transform }
      expect(applyFigma3dStyles(style, properties)).toEqual({ width: '160px' })
      expect(
        applyFigma3dStyles(style, properties, [
          [1, 0, 100],
          [0, 1, 80]
        ])
      ).toEqual({ width: '160px' })
      expect(
        applyFigma3dStyles(style, properties, [
          [0, -1, 100],
          [1, 0, 80]
        ])
      ).toEqual({
        width: '160px',
        transform: 'matrix(0, 1, -1, 0, 0, 0)',
        'transform-origin': '0 0'
      })
    }
  )

  it.each([-1, 0, 0.5, 800])(
    'maps scene perspective %s to its rendered CSS value',
    (perspective) => {
      expect(applyFigma3dStyles({}, { scene3d: { perspective, preserve3d: false } })).toEqual({
        perspective: perspective < 0 ? 'none' : `${Math.max(1, perspective)}px`,
        'transform-style': 'flat'
      })
    }
  )

  it('keeps Preserve 3D active when perspective is hidden and drops ignored flattening styles', () => {
    const style = {
      opacity: '0.5',
      'mix-blend-mode': 'multiply',
      'box-shadow': '1px 2px black',
      filter: 'blur(4px)',
      'backdrop-filter': 'blur(2px)',
      overflow: 'hidden',
      'overflow-x': 'hidden',
      'overflow-y': 'auto',
      isolation: 'isolate',
      background: 'red'
    }
    expect(
      applyFigma3dStyles(style, { scene3d: { perspective: 800, preserve3d: true, visible: false } })
    ).toEqual({
      background: 'red',
      perspective: 'none',
      'transform-style': 'preserve-3d'
    })
  })
})
