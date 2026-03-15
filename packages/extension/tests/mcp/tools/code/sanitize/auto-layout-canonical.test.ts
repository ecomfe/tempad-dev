import { describe, expect, it } from 'vitest'

import { canonicalizeAutoLayoutStyles } from '@/mcp/tools/code/sanitize/auto-layout-canonical'

import { createSnapshot, createTree } from '../test-helpers'

describe('mcp/code sanitize auto-layout canonical', () => {
  it('removes redundant symmetric padding on fixed axes while keeping explicit size', () => {
    const root = createSnapshot({ id: 'root', children: ['child'] })
    const child = createSnapshot({ id: 'child', parentId: 'root', type: 'VECTOR' })
    root.bounds = { x: 0, y: 0, width: 20, height: 20 }
    child.bounds = { x: 0, y: 0, width: 18.333, height: 13.333 }
    root.node = {
      id: 'root',
      type: 'FRAME',
      visible: true,
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED'
    } as unknown as SceneNode
    child.node = {
      id: 'child',
      type: 'VECTOR',
      visible: true,
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED'
    } as unknown as SceneNode

    const tree = createTree([root, child])
    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        {
          display: 'flex',
          'flex-direction': 'row',
          'justify-content': 'center',
          'align-items': 'center',
          width: '20px',
          height: '20px',
          'padding-left': '0.8335px',
          'padding-right': '0.8335px',
          'padding-top': '3.3335px',
          'padding-bottom': '3.3335px'
        }
      ]
    ])

    canonicalizeAutoLayoutStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      display: 'flex',
      'flex-direction': 'row',
      'justify-content': 'center',
      'align-items': 'center',
      width: '20px',
      height: '20px'
    })
  })

  it('removes redundant explicit size on hug axes while preserving padding', () => {
    const root = createSnapshot({ id: 'root', children: ['child'] })
    const child = createSnapshot({ id: 'child', parentId: 'root', type: 'VECTOR' })
    root.bounds = { x: 0, y: 0, width: 20, height: 12 }
    child.bounds = { x: 0, y: 0, width: 12, height: 8 }
    root.node = {
      id: 'root',
      type: 'FRAME',
      visible: true,
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG'
    } as unknown as SceneNode
    child.node = {
      id: 'child',
      type: 'VECTOR',
      visible: true,
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED'
    } as unknown as SceneNode

    const tree = createTree([root, child])
    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        {
          display: 'flex',
          'flex-direction': 'row',
          width: '20px',
          height: '12px',
          'padding-left': '4px',
          'padding-right': '4px',
          'padding-top': '2px',
          'padding-bottom': '2px'
        }
      ]
    ])

    canonicalizeAutoLayoutStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      display: 'flex',
      'flex-direction': 'row',
      'padding-left': '4px',
      'padding-right': '4px',
      'padding-top': '2px',
      'padding-bottom': '2px'
    })
  })

  it('skips axes that are fill-sized or use unsupported percentage constraints', () => {
    const root = createSnapshot({ id: 'root', children: ['child'] })
    const child = createSnapshot({ id: 'child', parentId: 'root', type: 'VECTOR' })
    root.bounds = { x: 0, y: 0, width: 20, height: 12 }
    child.bounds = { x: 0, y: 0, width: 12, height: 8 }
    root.node = {
      id: 'root',
      type: 'FRAME',
      visible: true,
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED'
    } as unknown as SceneNode
    child.node = {
      id: 'child',
      type: 'VECTOR',
      visible: true,
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'FIXED'
    } as unknown as SceneNode

    const tree = createTree([root, child])
    const styles = new Map<string, Record<string, string>>([
      [
        'root',
        {
          display: 'flex',
          'flex-direction': 'row',
          'justify-content': 'center',
          'align-items': 'center',
          width: '100%',
          height: '12px',
          'padding-left': '4px',
          'padding-right': '4px',
          'padding-top': '2px',
          'padding-bottom': '2px'
        }
      ]
    ])

    canonicalizeAutoLayoutStyles(tree, styles)

    expect(styles.get('root')).toEqual({
      display: 'flex',
      'flex-direction': 'row',
      'justify-content': 'center',
      'align-items': 'center',
      width: '100%',
      height: '12px',
      'padding-left': '4px',
      'padding-right': '4px'
    })
  })
})
