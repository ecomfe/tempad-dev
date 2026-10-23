import { describe, expect, it } from 'vitest'

import { patchNegativeGapStyles } from '@/mcp/tools/code/sanitize/negative-gap'

import { createSnapshot, createTree } from '../test-helpers'

describe('mcp/code sanitize negative-gap', () => {
  it.each(['var(--cross-gap)', 'calc(8px + 2px)', '12%'])(
    'retains the other axis value %s while replacing a negative gap',
    (crossGap) => {
      const root = createSnapshot({ id: 'root', children: ['a', 'b'] })
      const tree = createTree([
        root,
        ...root.children.map((id) => createSnapshot({ id, parentId: root.id }))
      ])
      const styles = new Map<string, Record<string, string>>([
        ['root', { 'row-gap': crossGap, 'column-gap': '-4px' }]
      ])

      patchNegativeGapStyles(tree, styles)

      expect(styles.get('root')).toEqual({
        'row-gap': crossGap,
        'column-gap': '0px',
        'padding-left': '4px'
      })
    }
  )

  it('keeps a known function-valued shorthand axis intact', () => {
    const root = createSnapshot({ id: 'root', children: ['a', 'b'] })
    const tree = createTree([
      root,
      ...root.children.map((id) => createSnapshot({ id, parentId: root.id }))
    ])
    const styles = new Map<string, Record<string, string>>([
      ['root', { gap: '-4px calc(8px + 2px)' }]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      'row-gap': '0px',
      'column-gap': 'calc(8px + 2px)',
      'padding-top': '4px'
    })
  })

  it('still processes the inner flow of an absolute child without shifting that child', () => {
    const root = createSnapshot({ id: 'root', children: ['flow', 'absolute'] })
    const absolute = createSnapshot({ id: 'absolute', parentId: root.id, children: ['a', 'b'] })
    const tree = createTree([
      root,
      createSnapshot({ id: 'flow', parentId: root.id }),
      absolute,
      ...absolute.children.map((id) => createSnapshot({ id, parentId: absolute.id }))
    ])
    const styles = new Map<string, Record<string, string>>([
      ['root', { gap: '-10px' }],
      ['absolute', { position: 'absolute', left: '5px', gap: '-2px' }]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toEqual({ 'row-gap': '0px', 'column-gap': '0px' })
    expect(styles.get('absolute')).toEqual({
      position: 'absolute',
      left: '5px',
      'row-gap': '0px',
      'column-gap': '0px',
      'padding-top': '2px',
      'padding-left': '2px'
    })
    for (const id of absolute.children) {
      expect(styles.get(id)).toMatchObject({ 'margin-top': '-2px', 'margin-left': '-2px' })
    }
  })

  it('preserves unknown shorthand arity and explicit overrides on other axes', () => {
    const root = createSnapshot({ id: 'root' })
    const styles = new Map<string, Record<string, string>>([
      ['root', { gap: 'var(--gaps)', 'column-gap': '-2px' }]
    ])
    patchNegativeGapStyles(createTree([root]), styles)
    expect(styles.get('root')).toEqual({ gap: 'var(--gaps)', 'column-gap': '0px' })

    styles.set('root', { gap: '-4px -2px', 'row-gap': 'var(--row)' })
    patchNegativeGapStyles(createTree([root]), styles)
    expect(styles.get('root')).toEqual({ 'row-gap': 'var(--row)', 'column-gap': '0px' })
  })

  it('adds fractional overlap to unitless CSS zero without creating mixed-unit calc expressions', () => {
    const root = createSnapshot({ id: 'root', children: ['a', 'b'] })
    const tree = createTree([
      root,
      ...root.children.map((id) => createSnapshot({ id, parentId: root.id }))
    ])
    const styles = new Map<string, Record<string, string>>([
      ['root', { gap: '-.5px', 'padding-left': '0', 'padding-top': '.0' }],
      ['a', { 'margin-left': '+0', 'margin-top': '-0.0' }]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      'row-gap': '0px',
      'column-gap': '0px',
      'padding-left': '0.5px',
      'padding-top': '0.5px'
    })
    expect(styles.get('a')).toMatchObject({ 'margin-left': '-0.5px', 'margin-top': '-0.5px' })
  })

  it('normalizes negative gap and compensates parent and children when there are multiple children', () => {
    const root = createSnapshot({ id: 'root', children: ['c1', 'c2'] })
    const c1 = createSnapshot({ id: 'c1', parentId: 'root' })
    const c2 = createSnapshot({ id: 'c2', parentId: 'root' })
    const tree = createTree([root, c1, c2])

    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        {
          gap: '-4px -2px',
          'padding-top': '1px'
        }
      ],
      ['c1', { 'margin-top': 'var(--space)' }]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      'padding-top': '5px',
      'row-gap': '0px',
      'column-gap': '0px',
      'padding-left': '2px'
    })
    expect(styles.get('c1')).toEqual({
      'margin-top': 'calc(var(--space) - 4px)',
      'box-sizing': 'border-box',
      'margin-left': '-2px'
    })
    expect(styles.get('c2')).toEqual({
      'box-sizing': 'border-box',
      'margin-top': '-4px',
      'margin-left': '-2px'
    })
  })

  it('does not add compensation paddings/margins when there is only one child', () => {
    const root = createSnapshot({ id: 'root', children: ['c1'] })
    const c1 = createSnapshot({ id: 'c1', parentId: 'root' })
    const tree = createTree([root, c1])
    const styles = new Map<string, Record<string, string>>([
      ['root', { gap: '-6px' }],
      ['c1', {}]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      'row-gap': '0px',
      'column-gap': '0px'
    })
    expect(styles.get('c1')).toEqual({})
  })

  it('keeps styles unchanged when gap is non-negative or unparsable', () => {
    const root = createSnapshot({ id: 'root', children: ['c1'] })
    const c1 = createSnapshot({ id: 'c1', parentId: 'root' })
    const tree = createTree([root, c1])
    const styles = new Map<string, Record<string, string>>([
      ['root', { gap: 'var(--gap)', color: 'red' }]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toEqual({ gap: 'var(--gap)', color: 'red' })
  })

  it('handles sparse roots, blank gaps, and non-finite px values safely', () => {
    const root = createSnapshot({ id: 'root', children: ['child'] })
    const child = createSnapshot({ id: 'child', parentId: 'root' })
    const blankRoot = createSnapshot({ id: 'blank-root' })
    ;(blankRoot as unknown as { children?: string[] }).children = undefined
    const tree = createTree([root, child, blankRoot])
    tree.rootIds.push('missing-root')

    const hugePx = `${'9'.repeat(400)}px`
    const styles = new Map<string, Record<string, string>>([
      ['child', { 'row-gap': hugePx, 'column-gap': '-2px' }],
      ['blank-root', { gap: '   ', color: 'blue' }]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('root')).toBeUndefined()
    expect(styles.get('child')).toEqual({ 'row-gap': hugePx, 'column-gap': '0px' })
    expect(styles.get('blank-root')).toEqual({ gap: '   ', color: 'blue' })
  })

  it('supports row-only and column-only compensation with existing custom expressions', () => {
    const rowRoot = createSnapshot({ id: 'row-root', children: ['r1', 'r2'] })
    const r1 = createSnapshot({ id: 'r1', parentId: 'row-root' })
    const r2 = createSnapshot({ id: 'r2', parentId: 'row-root' })
    const colRoot = createSnapshot({ id: 'col-root', children: ['c1', 'c2'] })
    const c1 = createSnapshot({ id: 'c1', parentId: 'col-root' })
    const c2 = createSnapshot({ id: 'c2', parentId: 'col-root' })
    const onlyRowRoot = createSnapshot({ id: 'only-row-root', children: ['or1', 'or2'] })
    const or1 = createSnapshot({ id: 'or1', parentId: 'only-row-root' })
    const or2 = createSnapshot({ id: 'or2', parentId: 'only-row-root' })
    const tree = createTree([rowRoot, r1, r2, colRoot, c1, c2, onlyRowRoot, or1, or2])

    const styles = new Map<string, Record<string, string>>([
      [
        'row-root',
        {
          'row-gap': '-3px',
          'column-gap': '4px',
          'padding-top': 'var(--pad)'
        }
      ],
      ['r1', { 'box-sizing': 'content-box', 'margin-top': 'var(--space)' }],
      [
        'col-root',
        {
          'row-gap': '0px',
          'column-gap': '-2px',
          'padding-left': 'var(--pad-left)'
        }
      ],
      ['c1', { 'margin-left': 'var(--edge)' }],
      [
        'only-row-root',
        {
          'row-gap': '-1px'
        }
      ]
    ])

    patchNegativeGapStyles(tree, styles)

    expect(styles.get('row-root')).toEqual({
      'row-gap': '0px',
      'column-gap': '4px',
      'padding-top': 'calc(var(--pad) + 3px)'
    })
    expect(styles.get('r1')).toEqual({
      'box-sizing': 'content-box',
      'margin-top': 'calc(var(--space) - 3px)'
    })
    expect(styles.get('r2')).toEqual({
      'box-sizing': 'border-box',
      'margin-top': '-3px'
    })

    expect(styles.get('col-root')).toEqual({
      'row-gap': '0px',
      'column-gap': '0px',
      'padding-left': 'calc(var(--pad-left) + 2px)'
    })
    expect(styles.get('c1')).toEqual({
      'box-sizing': 'border-box',
      'margin-left': 'calc(var(--edge) - 2px)'
    })
    expect(styles.get('c2')).toEqual({
      'box-sizing': 'border-box',
      'margin-left': '-2px'
    })

    expect(styles.get('only-row-root')).toEqual({
      'row-gap': '0px',
      'padding-top': '1px'
    })
    expect(styles.get('or1')).toEqual({
      'box-sizing': 'border-box',
      'margin-top': '-1px'
    })
    expect(styles.get('or2')).toEqual({
      'box-sizing': 'border-box',
      'margin-top': '-1px'
    })
  })
})
