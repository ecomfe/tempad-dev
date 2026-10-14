import { afterEach, expect, it } from 'vitest'

import { applyAbsoluteStackingOrder } from '@/mcp/tools/code/sanitize/stacking'

import { createSnapshot, createTree } from '../test-helpers'

afterEach(() => document.body.replaceChildren())

it('keeps absolute descendants of structural groups anchored to their outer layout parent', () => {
  const root = createSnapshot({ id: 'root', children: ['group', 'sibling'] })
  const group = createSnapshot({
    id: 'group',
    type: 'GROUP',
    parentId: 'root',
    children: ['child']
  })
  const tree = createTree([
    root,
    group,
    createSnapshot({ id: 'child', parentId: 'group' }),
    createSnapshot({ id: 'sibling', parentId: 'root' })
  ])
  const styles = new Map<string, Record<string, string>>([
    ['root', { position: 'relative', display: 'block', 'padding-top': '1px' }],
    ['group', { 'margin-top': '20px', height: '100px' }],
    ['child', { position: 'absolute', top: '40px', width: '10px', height: '10px' }],
    ['sibling', { position: 'absolute', top: '0px' }]
  ])
  const host = document.createElement('div')
  host.innerHTML = '<div id="group"><div id="child"></div></div><div id="sibling"></div>'
  document.body.append(host)
  const apply = () => {
    for (const [id, style] of styles) {
      const element = id === 'root' ? host : host.querySelector<HTMLElement>(`#${id}`)!
      element.style.cssText = Object.entries(style)
        .map(([key, value]) => `${key}:${value}`)
        .join(';')
    }
  }
  apply()
  const before = host.querySelector('#child')!.getBoundingClientRect().toJSON()
  applyAbsoluteStackingOrder(tree, styles)
  apply()
  expect(host.querySelector('#child')!.getBoundingClientRect().toJSON()).toEqual(before)
  expect(getComputedStyle(host.querySelector('#group')!).position).toBe('static')
})

it.each(
  ['flex', 'grid', 'block'].flatMap((display) =>
    ['normal', 'reverse', 'explicit'].map((order) => ({ display, order }))
  )
)(
  'preserves $order interleaved paint order in $display without moving flow items',
  ({ display, order }) => {
    const root = createSnapshot({ id: 'root', children: ['a', 'b', 'c'] })
    const tree = createTree([
      root,
      ...['a', 'b', 'c'].map((id) => createSnapshot({ id, parentId: 'root' }))
    ])
    Object.assign(root.node, { layoutMode: 'HORIZONTAL', itemReverseZIndex: order === 'reverse' })
    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        { display, position: 'relative', width: '200px', 'grid-template-columns': '50px 50px' }
      ],
      ['a', { width: '100px', height: '100px', background: 'red' }],
      [
        'b',
        {
          position: 'absolute',
          left: '0px',
          top: '0px',
          width: '150px',
          height: '100px',
          background: 'blue'
        }
      ],
      [
        'c',
        {
          width: '100px',
          height: '100px',
          background: 'green',
          'margin-left': display === 'flex' ? '-50px' : display === 'block' ? '50px' : '0px',
          'margin-top': display === 'block' ? '-100px' : '0px'
        }
      ]
    ])
    if (order === 'explicit') styles.get('b')!['z-index'] = '9'
    const host = document.createElement('div')
    host.innerHTML = '<div id="a"></div><div id="b"></div><div id="c"></div>'
    document.body.append(host)
    const apply = () => {
      for (const [id, style] of styles) {
        const element = id === 'root' ? host : host.querySelector<HTMLElement>(`#${id}`)!
        element.style.cssText = Object.entries(style)
          .map(([key, value]) => `${key}:${value}`)
          .join(';')
      }
    }
    apply()
    const before = ['a', 'c'].map((id) =>
      host.querySelector(`#${id}`)!.getBoundingClientRect().toJSON()
    )
    applyAbsoluteStackingOrder(tree, styles)
    apply()
    const bounds = host.getBoundingClientRect()
    expect(document.elementFromPoint(bounds.x + 25, bounds.y + 25)?.id).toBe(
      order === 'reverse' ? 'a' : 'b'
    )
    expect(document.elementFromPoint(bounds.x + 75, bounds.y + 25)?.id).toBe(
      order === 'reverse' ? 'a' : order === 'explicit' ? 'b' : 'c'
    )
    expect(
      ['a', 'c'].map((id) => host.querySelector(`#${id}`)!.getBoundingClientRect().toJSON())
    ).toEqual(before)
    expect(getComputedStyle(host).isolation).toBe('isolate')
  }
)
