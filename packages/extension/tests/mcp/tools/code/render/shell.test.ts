import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  styleToClassNames: vi.fn()
}))

vi.mock('@/mcp/tools/code/styles', () => ({
  styleToClassNames: mocked.styleToClassNames
}))

import { getOrderedChildIds, renderShellTree } from '@/mcp/tools/code/render'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'

describe('mcp/code render shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.styleToClassNames.mockReturnValue(['flex'])
  })

  it('orders omitted direct children using render ordering rules', () => {
    const root = createSnapshot({ id: 'root', children: ['b', 'c', 'd'] })
    const b = createSnapshot({ id: 'b', parentId: 'root' })
    const c = createSnapshot({ id: 'c', parentId: 'root' })
    const d = createSnapshot({ id: 'd', parentId: 'root' })

    ;(b.node as SceneNode & { absoluteBoundingBox: Rect | null }).absoluteBoundingBox = {
      x: 60,
      y: 0,
      width: 10,
      height: 10
    }
    ;(c.node as SceneNode & { absoluteBoundingBox: Rect | null }).absoluteBoundingBox = {
      x: 10,
      y: 0,
      width: 10,
      height: 10
    }
    ;(d.node as SceneNode & { absoluteBoundingBox: Rect | null }).absoluteBoundingBox = {
      x: 30,
      y: 0,
      width: 10,
      height: 10
    }

    const tree = createTree([root, b, c, d])
    const ordered = getOrderedChildIds(root, { display: 'flex', 'flex-direction': 'row' }, tree)

    expect(ordered).toEqual(['c', 'd', 'b'])
  })

  it('renders a shell wrapper with inline omitted-children comment', async () => {
    const root = createSnapshot({ id: 'root', children: ['b', 'c', 'd'] })
    const b = createSnapshot({ id: 'b', parentId: 'root' })
    const c = createSnapshot({ id: 'c', parentId: 'root' })
    const d = createSnapshot({ id: 'd', parentId: 'root' })
    const tree = createTree([root, b, c, d])

    const shell = await renderShellTree(
      'root',
      tree,
      {
        styles: new Map([['root', { display: 'flex' }]]),
        layout: new Map(),
        nodes: new Map([['root', root.node]]),
        svgs: new Map(),
        textSegments: new Map(),
        config: { cssUnit: 'px', rootFontSize: 16, scale: 1 },
        preferredLang: 'jsx'
      } as never,
      ['b', 'c', 'd']
    )

    expect(shell).not.toBeNull()

    const markup = stringifyComponent(shell!, { lang: 'jsx' })
    expect(markup).toContain('className="flex"')
    expect(markup).toContain('{/* omitted direct children: b,c,d */}')
  })

  it('returns null for plugin-backed instance roots', async () => {
    const root = createSnapshot({ id: 'root', type: 'INSTANCE', children: ['b'] })
    const child = createSnapshot({ id: 'b', parentId: 'root' })
    const tree = createTree([root, child])

    const shell = await renderShellTree(
      'root',
      tree,
      {
        styles: new Map([['root', { display: 'flex' }]]),
        layout: new Map(),
        nodes: new Map([['root', root.node]]),
        svgs: new Map(),
        textSegments: new Map(),
        config: { cssUnit: 'px', rootFontSize: 16, scale: 1 },
        preferredLang: 'jsx',
        pluginComponents: new Map([['root', { code: '<Button />' }]])
      } as never,
      ['b']
    )

    expect(shell).toBeNull()
  })
})
