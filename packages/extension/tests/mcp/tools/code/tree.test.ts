import { describe, expect, it, vi } from 'vitest'

import { suggestDepthLimit } from '@/mcp/semantic-tree'
import { buildVisibleTree } from '@/mcp/tools/code/tree'
import { logger } from '@/utils/log'

vi.mock('@/mcp/semantic-tree', () => ({
  suggestDepthLimit: vi.fn()
}))

vi.mock('@/utils/log', () => ({
  logger: {
    warn: vi.fn()
  }
}))

function createNode(
  type: SceneNode['type'],
  id: string,
  overrides: Record<string, unknown> = {},
  children?: SceneNode[]
): SceneNode {
  const base: Record<string, unknown> = {
    id,
    name: id,
    type,
    visible: true,
    x: 1.1111,
    y: 2.2222,
    width: 100.5678,
    height: 80.9876,
    ...overrides
  }

  if (children) {
    base.children = children
  }

  return base as unknown as SceneNode
}

describe('mcp/tools/code/tree', () => {
  it('builds visible tree with semantic tags and composed hints', () => {
    vi.mocked(suggestDepthLimit).mockReturnValue(undefined)

    const getVariableCollectionById = vi.fn((id: string) => {
      if (id === 'theme-a') {
        return {
          id: 'theme-a',
          name: 'Theme',
          modes: [{ modeId: 'm-light', name: 'Light' }]
        }
      }
      if (id === 'theme-b') {
        return {
          id: 'theme-b',
          name: 'Theme',
          modes: [{ modeId: 'm-dark', name: 'Dark' }]
        }
      }
      return null
    })

    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      variables: {
        getVariableCollectionById
      }
    } as unknown as PluginAPI

    const text = createNode('TEXT', 'text-1', { characters: 'a\nb' })
    const image = createNode('RECTANGLE', 'image-1', {
      fills: [{ type: 'IMAGE', visible: true }]
    })
    const vector = createNode('VECTOR', 'vector-1')

    const instance = createNode(
      'INSTANCE',
      'instance-1',
      {
        mainComponent: {
          name: 'Button',
          parent: {
            type: 'COMPONENT_SET',
            name: 'Button Group'
          }
        },
        componentProperties: {
          Size: { type: 'VARIANT', value: 'Large' },
          Disabled: { type: 'BOOLEAN', value: false },
          Text: { type: 'TEXT', value: 'Submit' },
          Swap: { type: 'INSTANCE_SWAP', value: 'skip' }
        },
        explicitVariableModes: {
          'theme-a': 'm-light',
          'theme-b': 'm-dark'
        },
        layoutMode: 'NONE',
        inferredAutoLayout: { layoutMode: 'HORIZONTAL' },
        absoluteRenderBounds: {
          x: 10.1234,
          y: 20.5678,
          width: 30.9876,
          height: 40.1111
        }
      },
      [text, image, vector]
    )

    const tree = buildVisibleTree([instance])

    expect(tree.rootIds).toEqual(['instance-1'])
    expect(tree.order).toEqual(['instance-1', 'text-1', 'image-1', 'vector-1'])
    expect(tree.stats).toEqual({
      totalNodes: 4,
      maxDepth: 1,
      depthLimit: undefined,
      capped: false,
      cappedNodeIds: []
    })

    const root = tree.nodes.get('instance-1')
    expect(root?.tag).toBe('div')
    expect(root?.renderBounds).toEqual({
      x: 10.123,
      y: 20.568,
      width: 30.988,
      height: 40.111
    })
    expect(root?.dataHint?.['data-hint-design-component']).toContain('ButtonGroup')
    expect(root?.dataHint?.['data-hint-design-component']).toContain('[Size=Large]')
    expect(root?.dataHint?.['data-hint-design-component']).toContain('[Disabled=off]')
    expect(root?.dataHint?.['data-hint-design-component']).toContain('[Text=Submit]')
    expect(root?.dataHint?.['data-hint-variable-mode']).toContain('Theme=Light')
    expect(root?.dataHint?.['data-hint-variable-mode']).toContain('Theme=Dark')
    expect(root?.dataHint?.['data-hint-auto-layout']).toBe('inferred')
    expect(root?.autoLayoutHint).toBe('inferred')

    expect(tree.nodes.get('text-1')?.tag).toBe('p')
    expect(tree.nodes.get('image-1')?.tag).toBe('img')
    expect(tree.nodes.get('image-1')?.assetKind).toBe('image')
    expect(tree.nodes.get('vector-1')?.tag).toBe('svg')
    expect(tree.nodes.get('vector-1')?.assetKind).toBe('vector')
    expect(logger.warn).toHaveBeenCalledWith('Duplicate variable collection name "Theme" detected.')
  })

  it('caps traversal at depth limit and keeps capped node ids', () => {
    vi.mocked(suggestDepthLimit).mockReturnValue(1)
    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      variables: {
        getVariableCollectionById: vi.fn()
      }
    } as unknown as PluginAPI

    const leaf = createNode('TEXT', 'leaf-1', { characters: 'leaf' })
    const child = createNode('FRAME', 'child-1', {}, [leaf])
    const root = createNode('FRAME', 'root-1', {}, [child])

    const tree = buildVisibleTree([root])

    expect(tree.order).toEqual(['root-1', 'child-1'])
    expect(tree.stats.capped).toBe(true)
    expect(tree.stats.cappedNodeIds).toEqual(['child-1'])
    expect(tree.nodes.get('child-1')?.children).toEqual([])
  })
})
