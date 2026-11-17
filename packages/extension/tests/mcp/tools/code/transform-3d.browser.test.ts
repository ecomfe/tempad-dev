import { afterEach, expect, it } from 'vitest'

import { applyAbsoluteStackingOrder } from '@/mcp/tools/code/sanitize/stacking'
import { styleToClassNames } from '@/mcp/tools/code/styles/normalize'
import { applyFigma3dStyles } from '@/utils/figma-3d'

import { createSnapshot, createTree } from './test-helpers'

afterEach(() => document.body.replaceChildren())

it('renders serialized 3D classes with perspective and keeps layout dimensions unchanged', () => {
  const scene = document.createElement('div')
  const card = document.createElement('div')
  const sheet = document.createElement('style')
  scene.style.cssText = 'position:relative;width:320px;height:240px'
  card.style.cssText = 'width:160px;height:80px'
  const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
  const styles = [
    applyFigma3dStyles(
      { opacity: '0.5', overflow: 'hidden' },
      { scene3d: { perspective: 800, preserve3d: true } }
    ),
    applyFigma3dStyles(
      {},
      {
        transform3d: {
          type: 'FIXED_ORDER',
          translateZ: 40,
          rotateX: 0,
          rotateY: 30,
          rotateZ: 0,
          backfaceVisible: false
        },
        transformOrigin: { x: { unit: 'PERCENT', value: 25 }, y: { unit: 'PIXELS', value: 20 } }
      }
    )
  ]
  for (const [index, element] of [scene, card].entries()) {
    const classes = styleToClassNames(styles[index]!, config)
    element.className = classes.join(' ')
    for (const className of classes) {
      const arbitrary = className.match(/^\[([^:]+):(.+)\]$/)
      if (!arbitrary) throw new Error(`Unexpected fixture class: ${className}`)
      sheet.textContent += `.${CSS.escape(className)}{${arbitrary[1]}:${arbitrary[2]!.replaceAll('_', ' ')}}`
    }
  }
  scene.append(card)
  document.body.append(sheet, scene)
  expect(getComputedStyle(scene).perspective).toBe('800px')
  expect(getComputedStyle(scene).transformStyle).toBe('preserve-3d')
  expect(getComputedStyle(scene).opacity).toBe('1')
  expect(getComputedStyle(scene).overflow).toBe('visible')
  expect([card.offsetWidth, card.offsetHeight]).toEqual([160, 80])
  expect(getComputedStyle(card).transformOrigin).toBe('40px 20px')
  expect(getComputedStyle(card).backfaceVisibility).toBe('hidden')
  const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform)
  expect(matrix.m43).toBe(40)
  expect(matrix.m11).toBeCloseTo(Math.cos(Math.PI / 6), 5)
  expect(card.getBoundingClientRect().width).not.toBe(160)
})

it('retains depth ordering across mixed absolute and flow children', () => {
  const tree = createTree([
    createSnapshot({ id: 'scene', children: ['near', 'far'] }),
    createSnapshot({ id: 'near', parentId: 'scene' }),
    createSnapshot({ id: 'far', parentId: 'scene' })
  ])
  const styles = new Map<string, Record<string, string>>([
    [
      'scene',
      applyFigma3dStyles(
        { position: 'relative', display: 'flex', width: '200px', height: '200px' },
        { scene3d: { perspective: 800, preserve3d: true } }
      )
    ],
    [
      'near',
      {
        position: 'absolute',
        width: '100px',
        height: '100px',
        background: 'red',
        transform: 'translateZ(40px)'
      }
    ],
    ['far', { width: '100px', height: '100px', background: 'blue', transform: 'translateZ(0)' }]
  ])
  applyAbsoluteStackingOrder(tree, styles)
  const scene = document.createElement('div')
  scene.id = 'scene'
  scene.innerHTML = '<div id="near"></div><div id="far"></div>'
  document.body.append(scene)
  for (const [id, style] of styles) {
    const element = document.getElementById(id)!
    for (const [property, value] of Object.entries(style))
      element.style.setProperty(property, value)
  }
  const bounds = scene.getBoundingClientRect()
  expect(document.elementFromPoint(bounds.x + 50, bounds.y + 50)?.id).toBe('near')
  expect(getComputedStyle(scene).isolation).toBe('auto')
})
