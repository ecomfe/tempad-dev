import { describe, expect, it } from 'vitest'

import { applyAbsoluteStackingOrder } from '@/mcp/tools/code/sanitize/stacking'

import { createSnapshot, createTree } from '../test-helpers'

describe('mcp/code sanitize stacking', () => {
  it.each([0, 0.5, 1])(
    'keeps bound-opacity groups at the natural paint level regardless of current opacity %s',
    (opacity) => {
      const root = createSnapshot({ id: 'root', children: ['first', 'absolute', 'last'] })
      const first = createSnapshot({
        id: 'first',
        type: 'GROUP',
        parentId: 'root',
        children: ['a']
      })
      const last = createSnapshot({
        id: 'last',
        type: 'GROUP',
        parentId: 'root',
        children: ['c']
      })
      for (const group of [first, last]) {
        Object.assign(group.node, {
          opacity,
          blendMode: 'PASS_THROUGH',
          boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } }
        })
      }
      const tree = createTree([
        root,
        first,
        createSnapshot({ id: 'a', parentId: 'first' }),
        createSnapshot({ id: 'absolute', parentId: 'root' }),
        last,
        createSnapshot({ id: 'c', parentId: 'last' })
      ])
      const styles = new Map<string, Record<string, string>>([
        ['root', { position: 'relative' }],
        ['first', { width: '100px', opacity: 'var(--Opacity)' }],
        ['a', { position: 'absolute' }],
        ['absolute', { position: 'absolute', 'z-index': 'auto' }],
        ['last', { width: '100px', opacity: 'var(--Opacity)' }],
        ['c', { position: 'absolute' }]
      ])
      applyAbsoluteStackingOrder(tree, styles)
      expect(styles.get('absolute')).toEqual({ position: 'absolute', 'z-index': 'auto' })
      for (const id of ['first', 'last']) {
        expect(styles.get(id)).toEqual({ width: '100px', opacity: 'var(--Opacity)' })
      }
      expect(styles.get('a')).toEqual({ position: 'absolute' })
      expect(styles.get('c')).toEqual({ position: 'absolute' })
      expect(styles.get('root')).toEqual({ position: 'relative' })
    }
  )

  it('keeps bound opacity and blur expressions without activating static group insets or ranks', () => {
    const root = createSnapshot({ id: 'root', children: ['absolute', 'group'] })
    const group = createSnapshot({
      id: 'group',
      type: 'GROUP',
      parentId: 'root',
      children: ['child']
    })
    Object.assign(group.node, {
      opacity: 0.5,
      blendMode: 'PASS_THROUGH',
      boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } },
      effects: [
        {
          type: 'LAYER_BLUR',
          visible: true,
          radius: 2,
          boundVariables: { radius: { type: 'VARIABLE_ALIAS', id: 'radius' } }
        }
      ]
    })
    const tree = createTree([
      root,
      group,
      createSnapshot({ id: 'child', parentId: 'group' }),
      createSnapshot({ id: 'absolute', parentId: 'root' })
    ])
    const groupStyle = {
      opacity: 'var(--Opacity)',
      filter: 'blur(var(--Radius))',
      left: '12px',
      'z-index': '9'
    }
    const styles = new Map<string, Record<string, string>>([
      ['root', { position: 'relative' }],
      ['group', groupStyle],
      ['child', { position: 'absolute' }],
      ['absolute', { position: 'absolute' }]
    ])
    applyAbsoluteStackingOrder(tree, styles)
    expect(styles.get('group')).toEqual(groupStyle)
    expect(styles.get('absolute')).toEqual({ position: 'absolute' })
    expect(styles.get('child')).toEqual({ position: 'absolute' })
  })

  it('does not add isolation or child ranks to a bound-opacity root with nested groups', () => {
    const root = createSnapshot({ id: 'root', type: 'GROUP', children: ['a', 'normal', 'b'] })
    Object.assign(root.node, {
      blendMode: 'PASS_THROUGH',
      opacity: 1,
      boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } }
    })
    const normal = createSnapshot({
      id: 'normal',
      type: 'GROUP',
      parentId: 'root',
      children: ['c']
    })
    Object.assign(normal.node, { blendMode: 'NORMAL' })
    const tree = createTree([
      root,
      createSnapshot({ id: 'a', parentId: 'root' }),
      normal,
      createSnapshot({ id: 'c', parentId: 'normal' }),
      createSnapshot({ id: 'b', parentId: 'root' })
    ])
    const styles = new Map<string, Record<string, string>>([
      ['root', { width: '200px', opacity: 'var(--Opacity)' }],
      ['a', { position: 'absolute' }],
      ['normal', { width: '100px' }],
      ['c', { position: 'absolute' }],
      ['b', { position: 'absolute', 'z-index': '7' }]
    ])
    applyAbsoluteStackingOrder(tree, styles)
    expect(styles.get('root')).toEqual({ width: '200px', opacity: 'var(--Opacity)' })
    expect(styles.get('a')).toEqual({ position: 'absolute' })
    expect(styles.get('b')).toEqual({ position: 'absolute', 'z-index': '7' })
    expect(styles.get('normal')).toEqual({ width: '100px', isolation: 'isolate' })
  })

  it.each([
    { transform: 'none' },
    { transform: 'inherit' },
    { transform: 'var(--transform)' },
    { transform: 'rotate(var(--angle))' },
    { filter: 'var(--filter)' },
    { filter: 'blur(var(--radius))' },
    { 'backdrop-filter': 'none' },
    { 'backdrop-filter': 'inherit' },
    { 'backdrop-filter': 'var(--filter)' },
    { 'backdrop-filter': 'blur(var(--radius))' },
    { transform: 'rotate(10deg)', left: '10px' },
    { filter: 'blur(1px)', 'inset-inline-start': '10px' },
    { 'backdrop-filter': 'blur(1px)', 'inset-inline-start': '10px' },
    { transform: 'rotate(10deg)', 'z-index': '9' },
    { opacity: '1' },
    { opacity: '' },
    { opacity: 'inherit' },
    { opacity: 'var(--opacity)' },
    { 'mix-blend-mode': 'normal' },
    { 'mix-blend-mode': 'inherit' },
    { 'mix-blend-mode': 'var(--blend)' },
    { 'mix-blend-mode': 'not-a-blend-mode' }
  ] as Record<string, string>[])(
    'does not activate offsets, explicit ranks or an uncertain containing block: %j',
    (groupStyle) => {
      const root = createSnapshot({ id: 'root', children: ['absolute', 'group'] })
      const group = createSnapshot({ id: 'group', type: 'GROUP', parentId: 'root' })
      const tree = createTree([root, group, createSnapshot({ id: 'absolute', parentId: 'root' })])
      const styles = new Map<string, Record<string, string>>([
        ['absolute', { position: 'absolute' }],
        ['group', groupStyle]
      ])
      applyAbsoluteStackingOrder(tree, styles)
      expect(styles.get('group')).toEqual(groupStyle)
      expect(styles.get('absolute')?.['z-index']).toBe('-1')
    }
  )

  it.each<Record<string, string>>([
    { opacity: '.5' },
    { opacity: '0' },
    { isolation: 'isolate' },
    { 'mix-blend-mode': 'multiply' }
  ])('shares the static group paint level without activating its insets: %j', (compositing) => {
    const root = createSnapshot({ id: 'root', children: ['first', 'absolute', 'flow', 'last'] })
    const tree = createTree([
      root,
      ...root.children.map((id) =>
        createSnapshot({
          id,
          parentId: 'root',
          type: id === 'first' || id === 'last' ? 'GROUP' : 'FRAME'
        })
      )
    ])
    const groupStyle = { ...compositing, left: '20px', 'z-index': '9' }
    const styles = new Map<string, Record<string, string>>([
      ['root', { display: 'block' }],
      ['first', groupStyle],
      ['absolute', { position: 'absolute' }],
      ['flow', {}],
      ['last', { ...compositing }]
    ])
    applyAbsoluteStackingOrder(tree, styles)
    expect(styles.get('first')).toEqual(groupStyle)
    expect(styles.get('last')).toEqual(compositing)
    expect(styles.get('absolute')).toEqual({ position: 'absolute', 'z-index': '0' })
    expect(styles.get('flow')).toEqual({ position: 'relative', 'z-index': '0' })
    expect(styles.get('root')?.isolation).toBe('isolate')
  })

  it('isolates native Normal group boxes without creating missing styles or changing SVG roots', () => {
    const normal = createSnapshot({ id: 'normal', type: 'GROUP' })
    Object.assign(normal.node, { blendMode: 'NORMAL' })
    const tree = createTree([normal])
    const styles = new Map<string, Record<string, string>>([['normal', { left: '20px' }]])
    applyAbsoluteStackingOrder(tree, styles)
    expect(styles.get('normal')).toEqual({ left: '20px', isolation: 'isolate' })
    const svgStyles = new Map<string, Record<string, string>>([['normal', { left: '20px' }]])
    applyAbsoluteStackingOrder(tree, svgStyles, new Set(['normal']))
    expect(svgStyles.get('normal')).toEqual({ left: '20px' })
    const missingStyles = new Map<string, Record<string, string>>()
    applyAbsoluteStackingOrder(tree, missingStyles)
    expect(missingStyles.has('normal')).toBe(false)
  })

  it.each<Record<string, string>>([
    { isolation: 'auto' },
    { isolation: 'var(--isolation)' },
    { display: 'contents' },
    { display: 'none' },
    { display: 'var(--display)' }
  ])('preserves explicit isolation and non-box output on Normal groups: %j', (style) => {
    const normal = createSnapshot({ id: 'normal', type: 'GROUP' })
    Object.assign(normal.node, { blendMode: 'NORMAL' })
    const styles = new Map([['normal', style]])
    applyAbsoluteStackingOrder(createTree([normal]), styles)
    expect(styles.get('normal')).toEqual(style)
  })

  it('does not substitute normal DOM painting for a reversed structural layout', () => {
    const root = createSnapshot({ id: 'root', children: ['absolute', 'group'] })
    Object.assign(root.node, { layoutMode: 'HORIZONTAL', itemReverseZIndex: true })
    const tree = createTree([
      root,
      createSnapshot({ id: 'absolute', parentId: 'root' }),
      createSnapshot({ id: 'group', type: 'GROUP', parentId: 'root' })
    ])
    const styles = new Map<string, Record<string, string>>([
      ['absolute', { position: 'absolute' }],
      ['group', { opacity: '.5' }]
    ])
    applyAbsoluteStackingOrder(tree, styles)
    expect(styles.get('absolute')?.['z-index']).toBe('-1')
    expect(styles.get('group')).toEqual({ opacity: '.5' })
  })

  it('keeps the fallback when a sibling group has no proven stacking context', () => {
    const root = createSnapshot({ id: 'root', children: ['opacity', 'absolute', 'unknown'] })
    const tree = createTree([
      root,
      ...root.children.map((id) =>
        createSnapshot({
          id,
          parentId: 'root',
          type: id === 'absolute' ? 'FRAME' : 'GROUP'
        })
      )
    ])
    const styles = new Map<string, Record<string, string>>([
      ['opacity', { opacity: '.5' }],
      ['absolute', { position: 'absolute' }],
      ['unknown', { opacity: 'var(--opacity)' }]
    ])
    applyAbsoluteStackingOrder(tree, styles)
    expect(styles.get('absolute')?.['z-index']).toBe('-1')
    expect(styles.get('opacity')).toEqual({ opacity: '.5' })
    expect(styles.get('unknown')).toEqual({ opacity: 'var(--opacity)' })
  })

  it.each(['GROUP', 'BOOLEAN_OPERATION'] as const)(
    'retains the existing fallback around an unpositioned structural %s',
    (type) => {
      const root = createSnapshot({ id: 'root', children: ['absolute', 'group'] })
      const group = createSnapshot({ id: 'group', type, parentId: 'root' })
      const tree = createTree([root, group, createSnapshot({ id: 'absolute', parentId: 'root' })])
      const styles = new Map<string, Record<string, string>>([
        ['absolute', { position: 'absolute' }],
        ['group', {}]
      ])
      applyAbsoluteStackingOrder(tree, styles)
      expect(styles.get('absolute')).toEqual({ position: 'absolute', 'z-index': '-1' })
      expect(styles.get('group')).toEqual({})
      expect(styles.get('root')).toEqual({ isolation: 'isolate' })
    }
  )

  it.each(['HORIZONTAL', 'NONE'])(
    'applies reverse stacking to flow-only siblings only for an active layout (%s)',
    (layoutMode) => {
      const root = createSnapshot({ id: 'root', children: ['a', 'b'] })
      Object.assign(root.node, { layoutMode, itemReverseZIndex: true })
      const tree = createTree([
        root,
        ...['a', 'b'].map((id) => createSnapshot({ id, parentId: 'root' }))
      ])
      const styles = new Map<string, Record<string, string>>([
        ['root', { display: 'flex' }],
        ['a', {}],
        ['b', { 'z-index': 'auto' }]
      ])
      applyAbsoluteStackingOrder(tree, styles)
      expect(styles.get('a')).toEqual(layoutMode === 'NONE' ? {} : { 'z-index': '1' })
      expect(styles.get('b')).toEqual({ 'z-index': layoutMode === 'NONE' ? 'auto' : '0' })
    }
  )

  it('pushes absolute children behind later in-flow siblings and isolates parent', () => {
    const root = createSnapshot({ id: 'root', children: ['a1', 'flow'] })
    const a1 = createSnapshot({ id: 'a1', parentId: 'root' })
    const flow = createSnapshot({ id: 'flow', parentId: 'root' })
    const tree = createTree([root, a1, flow])

    const styles = new Map<string, Record<string, string>>([
      ['a1', { position: 'absolute' }],
      ['flow', { position: 'relative' }]
    ])

    applyAbsoluteStackingOrder(tree, styles)

    expect(styles.get('a1')).toEqual({ position: 'absolute', 'z-index': '0' })
    expect(styles.get('flow')).toEqual({ position: 'relative', 'z-index': '1' })
    expect(styles.get('root')).toEqual({ isolation: 'isolate' })
  })

  it('keeps existing z-index and skips isolation when later siblings are also absolute', () => {
    const root = createSnapshot({ id: 'root', children: ['a1', 'a2'] })
    const a1 = createSnapshot({ id: 'a1', parentId: 'root' })
    const a2 = createSnapshot({ id: 'a2', parentId: 'root' })
    const tree = createTree([root, a1, a2])

    const styles = new Map<string, Record<string, string>>([
      ['a1', { position: 'absolute', 'z-index': '9' }],
      ['a2', { position: 'absolute' }]
    ])

    applyAbsoluteStackingOrder(tree, styles)

    expect(styles.get('a1')).toEqual({ position: 'absolute', 'z-index': '9' })
    expect(styles.get('root')).toBeUndefined()
  })

  it('handles missing roots, leaf roots, and keeps existing z-index/isolation', () => {
    const root = createSnapshot({ id: 'root', children: ['a1', 'flow'] })
    const a1 = createSnapshot({ id: 'a1', parentId: 'root' })
    const flow = createSnapshot({ id: 'flow', parentId: 'root' })
    const leaf = createSnapshot({ id: 'leaf' })
    ;(leaf as unknown as { children?: string[] }).children = undefined
    const tree = createTree([root, a1, flow, leaf])
    tree.rootIds.push('missing-root')

    const styles = new Map<string, Record<string, string>>([
      ['root', { isolation: 'isolate' }],
      ['a1', { position: 'absolute', 'z-index': '3' }],
      ['flow', { position: 'relative' }]
    ])

    applyAbsoluteStackingOrder(tree, styles)

    expect(styles.get('a1')).toEqual({ position: 'absolute', 'z-index': '3' })
    expect(styles.get('root')).toEqual({ isolation: 'isolate' })
  })
})
