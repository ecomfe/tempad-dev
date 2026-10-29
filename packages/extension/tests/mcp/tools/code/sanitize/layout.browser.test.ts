import { afterEach, expect, it, vi } from 'vitest'

import { sanitizeStyles } from '@/mcp/tools/code/sanitize'
import { preprocessStyles } from '@/mcp/tools/code/styles'

import { createSnapshot, createTree } from '../test-helpers'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it.each(
  ['row', 'column'].flatMap((direction) => [
    { direction, flowCount: 1, zero: 'none' },
    { direction, flowCount: 2, zero: 'none' },
    { direction, flowCount: 2, zero: 'padding' },
    { direction, flowCount: 2, zero: 'margin' }
  ])
)(
  'retains overlap and absolute offsets for $flowCount flow children in $direction with zero $zero',
  ({ direction, flowCount, zero }) => {
    const flowIds = Array.from({ length: flowCount }, (_, index) => `flow-${index}`)
    const root = createSnapshot({ id: 'root', children: [...flowIds, 'absolute'] })
    const tree = createTree([
      root,
      ...root.children.map((id) => createSnapshot({ id, parentId: root.id }))
    ])
    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        {
          display: 'flex',
          'flex-direction': direction,
          'align-items': 'flex-start',
          width: '200px',
          height: '160px',
          'box-sizing': 'border-box',
          gap: '-10px',
          ...(zero === 'padding' ? { 'padding-top': '0', 'padding-left': '0' } : {})
        }
      ],
      ...flowIds.map(
        (id) =>
          [
            id,
            {
              width: '40px',
              height: '40px',
              'flex-shrink': '0',
              ...(zero === 'margin' ? { 'margin-top': '0', 'margin-left': '0' } : {})
            }
          ] as const
      ),
      ['absolute', { position: 'absolute', left: '5px', top: '7px', width: '10px', height: '10px' }]
    ])
    sanitizeStyles(tree, styles)
    const host = document.createElement('div')
    const elements = new Map<string, HTMLElement>([['root', host]])
    for (const id of root.children) {
      const element = document.createElement('div')
      elements.set(id, element)
      host.append(element)
    }
    for (const [id, style] of styles) {
      for (const [name, value] of Object.entries(style))
        elements.get(id)!.style.setProperty(name, value)
    }
    document.body.append(host)
    const bounds = host.getBoundingClientRect()
    const absolute = elements.get('absolute')!.getBoundingClientRect()
    expect({ x: absolute.x - bounds.x, y: absolute.y - bounds.y }).toEqual({ x: 5, y: 7 })
    for (const [index, id] of flowIds.entries()) {
      const child = elements.get(id)!.getBoundingClientRect()
      expect({ x: child.x - bounds.x, y: child.y - bounds.y }).toEqual({
        x: direction === 'row' ? index * 30 : 0,
        y: direction === 'column' ? index * 30 : 0
      })
    }
    if (flowCount === 1) {
      expect(getComputedStyle(host).paddingTop).toBe('0px')
      expect(getComputedStyle(host).paddingLeft).toBe('0px')
    }
  }
)

it('establishes the declared layout parent even when its native position is explicitly static', () => {
  const root = createSnapshot({ id: 'root', children: ['child'] })
  const child = createSnapshot({ id: 'child', parentId: root.id })
  const styles = new Map<string, Record<string, string>>([
    ['root', { position: 'static', width: '100px', height: '100px', 'margin-left': '40px' }],
    ['child', { position: 'absolute', left: '5px', top: '7px', width: '10px', height: '10px' }]
  ])
  sanitizeStyles(createTree([root, child]), styles)
  const host = document.createElement('div')
  const element = document.createElement('div')
  host.append(element)
  for (const [name, value] of Object.entries(styles.get('root')!))
    host.style.setProperty(name, value)
  for (const [name, value] of Object.entries(styles.get('child')!))
    element.style.setProperty(name, value)
  document.body.append(host)

  const bounds = host.getBoundingClientRect()
  const childBounds = element.getBoundingClientRect()
  expect({ x: childBounds.x - bounds.x, y: childBounds.y - bounds.y }).toEqual({ x: 5, y: 7 })
})

it.each(['block', 'row', 'column'])(
  'keeps hug dimensions intrinsic in a %s containing layout',
  (layout) => {
    vi.stubGlobal('figma', { mixed: Symbol('mixed') })
    const root = createSnapshot({ id: 'root', children: ['child'] })
    const child = createSnapshot({ id: 'child', parentId: root.id })
    root.bounds = { x: 0, y: 0, width: 20, height: 12 }
    child.bounds = { x: 0, y: 0, width: 12, height: 8 }
    Object.assign(root.node, {
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG'
    })
    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        preprocessStyles(
          { display: 'flex', width: '20px', height: '12px', padding: '2px 4px' },
          root.node
        )
      ],
      ['child', { width: '12px', height: '8px', 'flex-shrink': '0' }]
    ])
    sanitizeStyles(createTree([root, child]), styles)
    const host = document.createElement('div')
    host.style.cssText = `width:200px;height:100px;display:${layout === 'block' ? 'block' : 'flex'};flex-direction:${layout === 'column' ? 'column' : 'row'}`
    const rootElement = document.createElement('div')
    const childElement = document.createElement('div')
    rootElement.append(childElement)
    host.append(rootElement)
    for (const [name, value] of Object.entries(styles.get('root')!))
      rootElement.style.setProperty(name, value)
    for (const [name, value] of Object.entries(styles.get('child')!))
      childElement.style.setProperty(name, value)
    document.body.append(host)

    const bounds = rootElement.getBoundingClientRect()
    expect({ width: bounds.width, height: bounds.height }).toEqual({ width: 20, height: 12 })
    childElement.style.width = '24px'
    childElement.style.height = '16px'
    const resized = rootElement.getBoundingClientRect()
    expect({ width: resized.width, height: resized.height }).toEqual({ width: 32, height: 20 })
  }
)
