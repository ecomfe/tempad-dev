import { raw } from '@tempad-dev/plugins'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

const mocks = vi.hoisted(() => ({
  currentCodegenConfig: vi.fn(() => ({ cssUnit: 'px', rootFontSize: 16, scale: 1 })),
  buildVariableMappings: vi.fn(() => ({ variableIds: new Set<string>(), rewrites: new Map() })),
  planAssets: vi.fn(() => ({ vectorRoots: new Set<string>(), skippedIds: new Set<string>() })),
  collectNodeData: vi.fn(),
  prepareStyles: vi.fn(),
  buildLayoutStyles: vi.fn(() => new Map()),
  exportVectorAssets: vi.fn(() => Promise.resolve(new Map())),
  processTokens: vi.fn(),
  createStyleVarResolver: vi.fn(),
  resolveStyleMap: vi.fn(),
  renderTree: vi.fn(),
  renderShellTree: vi.fn(),
  getOrderedChildIds: vi.fn(),
  resolvePluginComponents: vi.fn(),
  buildVisibleTree: vi.fn(),
  activePlugin: { value: undefined as { name?: string; code?: string } | undefined }
}))

vi.mock('@/ui/state', () => ({
  activePlugin: mocks.activePlugin
}))

vi.mock('@/mcp/tools/config', () => ({
  currentCodegenConfig: mocks.currentCodegenConfig
}))

vi.mock('@/mcp/tools/token/mapping', () => ({
  buildVariableMappings: mocks.buildVariableMappings
}))

vi.mock('@/mcp/tools/code/assets/plan', () => ({
  planAssets: mocks.planAssets
}))

vi.mock('@/mcp/tools/code/collect', () => ({
  collectNodeData: mocks.collectNodeData
}))

vi.mock('@/mcp/tools/code/styles', () => ({
  prepareStyles: mocks.prepareStyles,
  buildLayoutStyles: mocks.buildLayoutStyles
}))

vi.mock('@/mcp/tools/code/assets/export', () => ({
  exportVectorAssets: mocks.exportVectorAssets
}))

vi.mock('@/mcp/tools/code/tokens', () => ({
  processTokens: mocks.processTokens,
  createStyleVarResolver: mocks.createStyleVarResolver,
  resolveStyleMap: mocks.resolveStyleMap
}))

vi.mock('@/mcp/tools/code/render', () => ({
  renderTree: mocks.renderTree,
  renderShellTree: mocks.renderShellTree,
  getOrderedChildIds: mocks.getOrderedChildIds
}))

vi.mock('@/mcp/tools/code/render/plugin', () => ({
  resolvePluginComponents: mocks.resolvePluginComponents
}))

vi.mock('@/mcp/tools/code/tree', () => ({
  buildVisibleTree: mocks.buildVisibleTree
}))

describe('mcp/code handleGetCode', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mocks.activePlugin.value = undefined
    vi.unstubAllGlobals()
  })

  it('returns a shell response with inline omitted ids when full output exceeds budget', async () => {
    const root = createSnapshot({ id: 'root', children: ['b', 'c'] })
    const b = createSnapshot({ id: 'b', parentId: 'root' })
    const c = createSnapshot({ id: 'c', parentId: 'root' })
    const tree = createTree([root, b, c])

    mocks.buildVisibleTree.mockReturnValue(tree)
    mocks.collectNodeData.mockResolvedValue({
      nodes: tree.nodes,
      styles: new Map([['root', { display: 'flex', 'flex-direction': 'row' }]]),
      textSegments: new Map()
    })
    mocks.prepareStyles.mockImplementation(
      ({ styles }: { styles: Map<string, Record<string, string>> }) => ({
        styles,
        layout: new Map(),
        usedCandidateIds: new Set<string>()
      })
    )
    mocks.processTokens.mockImplementation(async ({ code }: { code: string }) => ({
      code,
      tokensByCanonical: {},
      sourceIndex: new Map()
    }))
    mocks.renderTree.mockResolvedValue(raw('X'.repeat(90000)))
    mocks.getOrderedChildIds.mockReturnValue(['c', 'b'])
    mocks.renderShellTree.mockResolvedValue(
      raw('<div className="flex">{/* omitted direct children: c,b */}</div>')
    )
    vi.stubGlobal('__DEV__', false)

    const { handleGetCode } = await import('@/mcp/tools/code')
    const result = await handleGetCode([{ id: 'root', visible: true } as SceneNode], 'jsx', false)

    expect(result.code).toContain('{/* omitted direct children: c,b */}')
    expect(result.warnings?.map((item) => item.type)).toEqual(['shell'])
    expect(result.warnings?.[0]?.message).toContain('Call get_code for them in that order')
    expect(mocks.processTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        styles: new Map([['root', { display: 'flex', 'flex-direction': 'row' }]]),
        textSegments: new Map()
      })
    )
    expect(mocks.renderShellTree).toHaveBeenCalledWith(
      expect.any(String),
      tree,
      expect.any(Object),
      ['c', 'b']
    )
    expect(result.assets).toBeUndefined()
  })

  it('uses a root-only shell path when descendant text alone exceeds the budget', async () => {
    const root = createSnapshot({ id: 'root', children: ['copy'] })
    const copy = createSnapshot({ id: 'copy', type: 'TEXT', parentId: 'root' })
    copy.node = {
      id: 'copy',
      type: 'TEXT',
      visible: true,
      characters: '文'.repeat(30_000)
    } as unknown as TextNode
    const tree = createTree([root, copy])

    mocks.buildVisibleTree.mockReturnValue(tree)
    mocks.collectNodeData.mockResolvedValue({
      nodes: tree.nodes,
      styles: new Map([['root', { display: 'flex' }]]),
      textSegments: new Map()
    })
    mocks.prepareStyles.mockImplementation(
      ({ styles }: { styles: Map<string, Record<string, string>> }) => ({
        styles,
        layout: new Map(),
        usedCandidateIds: new Set<string>()
      })
    )
    mocks.processTokens.mockImplementation(async ({ code }: { code: string }) => ({
      code,
      tokensByCanonical: {},
      sourceIndex: new Map()
    }))
    mocks.getOrderedChildIds.mockReturnValue(['copy'])
    mocks.renderShellTree.mockResolvedValue(
      raw('<div className="relative flex">{/* omitted direct children: copy */}</div>')
    )
    vi.stubGlobal('__DEV__', false)

    const { handleGetCode } = await import('@/mcp/tools/code')
    const result = await handleGetCode([{ id: 'root', visible: true } as SceneNode], 'jsx', false)

    expect(result.warnings?.map((warning) => warning.type)).toEqual(['shell'])
    expect(mocks.buildVariableMappings).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.any(Object),
      { traverseChildren: false }
    )
    expect(mocks.collectNodeData).toHaveBeenCalledWith(
      tree,
      expect.any(Object),
      expect.any(Map),
      expect.any(Object),
      new Set(['copy'])
    )
    expect(mocks.prepareStyles).toHaveBeenCalledWith(
      expect.objectContaining({
        styles: new Map([['root', { display: 'flex', position: 'relative' }]])
      })
    )
    expect(mocks.planAssets).not.toHaveBeenCalled()
    expect(mocks.exportVectorAssets).not.toHaveBeenCalled()
    expect(mocks.renderTree).not.toHaveBeenCalled()
  })

  it('preserves the original budget error when a shell cannot be rendered', async () => {
    const root = createSnapshot({ id: 'root', children: ['b'] })
    const child = createSnapshot({ id: 'b', parentId: 'root' })
    const tree = createTree([root, child])

    mocks.buildVisibleTree.mockReturnValue(tree)
    mocks.collectNodeData.mockResolvedValue({
      nodes: tree.nodes,
      styles: new Map([['root', { display: 'flex' }]]),
      textSegments: new Map()
    })
    mocks.prepareStyles.mockImplementation(
      ({ styles }: { styles: Map<string, Record<string, string>> }) => ({
        styles,
        layout: new Map(),
        usedCandidateIds: new Set<string>()
      })
    )
    mocks.processTokens.mockImplementation(async ({ code }: { code: string }) => ({
      code,
      tokensByCanonical: {},
      sourceIndex: new Map()
    }))
    mocks.renderTree.mockResolvedValue(raw('X'.repeat(90000)))
    mocks.getOrderedChildIds.mockReturnValue(['b'])
    mocks.renderShellTree.mockResolvedValue(null)
    vi.stubGlobal('__DEV__', false)

    const { handleGetCode } = await import('@/mcp/tools/code')

    await expect(
      handleGetCode([{ id: 'root', visible: true } as SceneNode], 'jsx', false)
    ).rejects.toThrow('Tool result exceeds inline budget')
  })

  it('returns full output without shell when unbounded mode is enabled', async () => {
    const root = createSnapshot({ id: 'root' })
    const tree = createTree([root])
    tree.stats.capped = true
    tree.stats.depthLimit = 3
    tree.stats.cappedNodeIds = ['root']

    mocks.buildVisibleTree.mockReturnValue(tree)
    mocks.collectNodeData.mockResolvedValue({
      nodes: tree.nodes,
      styles: new Map([['root', { display: 'flex' }]]),
      textSegments: new Map()
    })
    mocks.prepareStyles.mockImplementation(
      ({ styles }: { styles: Map<string, Record<string, string>> }) => ({
        styles,
        layout: new Map(),
        usedCandidateIds: new Set<string>()
      })
    )
    mocks.processTokens.mockImplementation(async ({ code }: { code: string }) => ({
      code,
      tokensByCanonical: {},
      sourceIndex: new Map()
    }))
    mocks.renderTree.mockResolvedValue(
      raw(`<div data-hint-auto-layout="inferred">${'X'.repeat(40000)}</div>`)
    )
    vi.stubGlobal('__DEV__', false)

    const { handleGetCode } = await import('@/mcp/tools/code')
    const result = await handleGetCode(
      [{ id: 'root', visible: true } as SceneNode],
      'jsx',
      false,
      'smart',
      { unbounded: true }
    )

    expect(result.code).toContain('data-hint-auto-layout="inferred"')
    expect(result.code.length).toBeGreaterThan(40000)
    expect(result.warnings?.map((item) => item.type)).toEqual(['auto-layout', 'depth-cap'])
    expect(mocks.renderShellTree).not.toHaveBeenCalled()
  })

  it('rerenders themeable vector presentation styles when resolveTokens is enabled', async () => {
    const icon = createSnapshot({ id: 'icon', type: 'VECTOR' })
    const tree = createTree([icon])
    const resolver = vi.fn((style: Record<string, string>) => ({
      ...style,
      color: style.color === 'var(--icon-color)' ? '#fff' : style.color
    }))

    vi.stubGlobal('__DEV__', false)
    mocks.buildVisibleTree.mockReturnValue(tree)
    mocks.planAssets.mockReturnValue({
      vectorRoots: new Set(['icon']),
      skippedIds: new Set<string>()
    })
    mocks.collectNodeData.mockResolvedValue({
      nodes: tree.nodes,
      styles: new Map(),
      textSegments: new Map()
    })
    mocks.prepareStyles.mockImplementation(
      ({ styles }: { styles: Map<string, Record<string, string>> }) => ({
        styles,
        layout: new Map(),
        usedCandidateIds: new Set<string>()
      })
    )
    mocks.exportVectorAssets.mockResolvedValue(
      new Map([
        [
          'icon',
          {
            props: {
              width: '16px',
              height: '16px',
              viewBox: '0 0 16 16'
            },
            presentationStyle: {
              color: 'var(--icon-color)'
            },
            raw: '<svg><path fill="currentColor" /></svg>'
          }
        ]
      ])
    )
    mocks.processTokens.mockResolvedValue({
      code: '<svg data-color="var(--icon-color)" />',
      tokensByCanonical: {
        '--icon-color': { kind: 'color', value: '#fff' }
      },
      sourceIndex: new Map([['--icon-color', 'var-1']]),
      tokenMatcher: vi.fn((value: string) => value.includes('--icon-color')),
      resolveNodeIds: new Set(['icon'])
    })
    mocks.createStyleVarResolver.mockReturnValue(resolver)
    mocks.resolveStyleMap.mockImplementation(
      (styles: Map<string, Record<string, string>>) => new Map(styles)
    )
    mocks.renderTree.mockImplementation(
      async (
        _rootId: string,
        _tree: unknown,
        ctx: { svgs: Map<string, { presentationStyle?: Record<string, string> }> }
      ) => raw(`<svg data-color="${ctx.svgs.get('icon')?.presentationStyle?.color}" />`)
    )

    const { handleGetCode } = await import('@/mcp/tools/code')
    const result = await handleGetCode([{ id: 'icon', visible: true } as SceneNode], 'jsx', true)

    expect(result.code).toContain('data-color="#fff"')
    expect(mocks.renderTree).toHaveBeenCalledTimes(2)
  })

  it('resolves all plugin instances through one batched collection call', async () => {
    const instances = Array.from({ length: 10 }, (_, index) =>
      createSnapshot({ id: `instance-${index}`, type: 'INSTANCE' })
    )
    const tree = createTree(instances)

    mocks.activePlugin.value = { name: 'test-plugin', code: 'plugin-code' }
    mocks.buildVisibleTree.mockReturnValue(tree)
    mocks.resolvePluginComponents.mockResolvedValue(instances.map(() => null))
    mocks.collectNodeData.mockResolvedValue({
      nodes: tree.nodes,
      styles: new Map(),
      textSegments: new Map()
    })
    mocks.prepareStyles.mockReturnValue({
      styles: new Map(),
      layout: new Map(),
      usedCandidateIds: new Set<string>()
    })
    mocks.renderTree.mockResolvedValue(raw('<div />'))
    mocks.processTokens.mockImplementation(async ({ code }: { code: string }) => ({
      code,
      tokensByCanonical: {},
      sourceIndex: new Map()
    }))
    vi.stubGlobal('__DEV__', false)

    const { handleGetCode } = await import('@/mcp/tools/code')
    await handleGetCode([instances[0]?.node as SceneNode], 'jsx', false)

    expect(mocks.resolvePluginComponents).toHaveBeenCalledOnce()
    expect(mocks.resolvePluginComponents).toHaveBeenCalledWith(
      instances.map((snapshot) => snapshot.node),
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'plugin-code',
      'jsx'
    )
  })
})
