import { raw } from '@tempad-dev/plugins'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

const mocks = vi.hoisted(() => ({
  currentCodegenConfig: vi.fn(() => ({ cssUnit: 'px', rootFontSize: 16, scale: 1 })),
  buildVariableMappings: vi.fn(() => ({ variableIds: new Set<string>(), rewrites: new Map() })),
  planAssets: vi.fn(() => ({ vectorRoots: new Set<string>(), skippedIds: new Set<string>() })),
  collectNodeData: vi.fn(),
  prepareStyles: vi.fn(),
  exportVectorAssets: vi.fn(() => Promise.resolve(new Map())),
  processTokens: vi.fn(),
  renderTree: vi.fn(),
  renderShellTree: vi.fn(),
  getOrderedChildIds: vi.fn(),
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
  buildLayoutStyles: vi.fn(() => new Map())
}))

vi.mock('@/mcp/tools/code/assets/export', () => ({
  exportVectorAssets: mocks.exportVectorAssets
}))

vi.mock('@/mcp/tools/code/tokens', () => ({
  processTokens: mocks.processTokens,
  createStyleVarResolver: vi.fn(),
  resolveStyleMap: vi.fn()
}))

vi.mock('@/mcp/tools/code/render', () => ({
  renderTree: mocks.renderTree,
  renderShellTree: mocks.renderShellTree,
  getOrderedChildIds: mocks.getOrderedChildIds
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
    mocks.renderTree.mockResolvedValue(raw('X'.repeat(40000)))
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
    expect(mocks.renderShellTree).toHaveBeenCalledWith(
      expect.any(String),
      tree,
      expect.any(Object),
      ['c', 'b']
    )
    expect(result.assets).toBeUndefined()
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
    mocks.renderTree.mockResolvedValue(raw('X'.repeat(40000)))
    mocks.getOrderedChildIds.mockReturnValue(['b'])
    mocks.renderShellTree.mockResolvedValue(null)
    vi.stubGlobal('__DEV__', false)

    const { handleGetCode } = await import('@/mcp/tools/code')

    await expect(
      handleGetCode([{ id: 'root', visible: true } as SceneNode], 'jsx', false)
    ).rejects.toThrow('Output exceeds token/context budget')
  })
})
