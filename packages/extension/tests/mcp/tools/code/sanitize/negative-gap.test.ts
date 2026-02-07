import { describe, expect, it } from 'vitest'

import { patchNegativeGapStyles } from '@/mcp/tools/code/sanitize/negative-gap'

import { createSnapshot, createTree } from '../test-helpers'

describe('mcp/code sanitize negative-gap', () => {
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
})
