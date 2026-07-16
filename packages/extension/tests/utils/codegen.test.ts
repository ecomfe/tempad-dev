import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => {
  return {
    requestPluginSandbox: vi.fn(),
    resolveStylesFromNode: vi.fn(),
    getDesignComponent: vi.fn(),
    formatNodeStyleForUi: vi.fn(
      (
        style: Record<string, string>
      ): { style: Record<string, string>; variableSyntax?: Record<string, string> } => ({ style })
    ),
    formatNodeStyleForPluginVariables: vi.fn((style: Record<string, string>) => style)
  }
})

vi.mock('@/plugin-sandbox/requester', () => ({
  requestPluginSandbox: mocked.requestPluginSandbox
}))

vi.mock('@/utils/figma-style/style-resolver', () => ({
  resolveStylesFromNode: mocked.resolveStylesFromNode
}))

vi.mock('@/utils/variable-output', () => ({
  formatNodeStyleForUi: mocked.formatNodeStyleForUi,
  formatNodeStyleForPluginVariables: mocked.formatNodeStyleForPluginVariables
}))

vi.mock('@/utils/component', () => ({
  getDesignComponent: mocked.getDesignComponent
}))

import { PluginSandboxError } from '@/plugin-sandbox/client'
import {
  codegen,
  generateCodeBlocksForNode,
  generateCodeBlocksForNodes,
  workerUnitOptions
} from '@/utils/codegen'

describe('utils/codegen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps css unit config into worker serialize options', () => {
    expect(
      workerUnitOptions({
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      })
    ).toEqual({
      useRem: false,
      rootFontSize: 16,
      scale: 1
    })

    expect(
      workerUnitOptions({
        cssUnit: 'rem',
        rootFontSize: 20,
        scale: 0.75
      })
    ).toEqual({
      useRem: true,
      rootFontSize: 20,
      scale: 0.75
    })
  })

  it('dispatches codegen requests through the plugin sandbox bridge', async () => {
    const response = { codeBlocks: [] }
    mocked.requestPluginSandbox.mockResolvedValue(response)

    const style = { color: 'red' }
    const component = { name: 'Button' } as unknown as ReturnType<typeof mocked.getDesignComponent>
    const options = { useRem: false, rootFontSize: 16, scale: 1 }

    const result = await codegen(style, component, options, 'plugin()', true)

    expect(mocked.requestPluginSandbox).toHaveBeenCalledWith('codegen', {
      style,
      component,
      options,
      pluginCode: 'plugin()',
      returnDevComponent: true
    })
    expect(result).toEqual(response)
  })

  it('omits component payload when input component is null', async () => {
    const response = { codeBlocks: [] }
    mocked.requestPluginSandbox.mockResolvedValue(response)

    await codegen({ color: 'red' }, null, { useRem: false, rootFontSize: 16, scale: 1 })

    expect(mocked.requestPluginSandbox).toHaveBeenCalledWith('codegen', {
      style: { color: 'red' },
      component: undefined,
      options: { useRem: false, rootFontSize: 16, scale: 1 },
      pluginCode: undefined,
      returnDevComponent: undefined
    })
  })

  it('resolves node style/component data before sending generation request', async () => {
    const response = { codeBlocks: [] }
    mocked.requestPluginSandbox.mockResolvedValue(response)

    const rawStyle = { color: 'blue' }
    const resolvedStyle = { color: 'green' }
    const pluginVariableStyle = { color: 'var(--green)' }
    const uiStyle = { color: 'theme.color.green' }
    mocked.resolveStylesFromNode.mockResolvedValueOnce(resolvedStyle)
    mocked.formatNodeStyleForUi.mockReturnValue({
      style: uiStyle,
      variableSyntax: { '--green': 'theme.color.green' }
    })
    mocked.formatNodeStyleForPluginVariables.mockReturnValue(pluginVariableStyle)

    const component = { name: 'Card' }
    mocked.getDesignComponent.mockReturnValue(component)

    const node = {
      getCSSAsync: vi.fn().mockResolvedValue(rawStyle)
    } as unknown as SceneNode

    const result = await generateCodeBlocksForNode(
      node,
      {
        cssUnit: 'rem',
        rootFontSize: 20,
        scale: 0.5
      },
      'plugin-code',
      {
        returnDevComponent: true,
        variableDisplay: 'resolved'
      }
    )

    expect(node.getCSSAsync).toHaveBeenCalledTimes(1)
    expect(mocked.resolveStylesFromNode).toHaveBeenNthCalledWith(1, rawStyle, node, undefined, {
      emitSafeStyleNameVars: true
    })
    expect(mocked.resolveStylesFromNode).toHaveBeenCalledTimes(1)
    expect(mocked.formatNodeStyleForUi).toHaveBeenCalledWith(resolvedStyle, node)
    expect(mocked.formatNodeStyleForPluginVariables).toHaveBeenCalledWith(resolvedStyle, node)
    expect(mocked.getDesignComponent).toHaveBeenCalledWith(node)
    expect(mocked.requestPluginSandbox).toHaveBeenCalledWith('codegen', {
      style: uiStyle,
      pluginVariableStyle,
      variableSyntax: { '--green': 'theme.color.green' },
      component,
      options: {
        useRem: true,
        rootFontSize: 20,
        scale: 0.5,
        variableDisplay: 'resolved'
      },
      pluginCode: 'plugin-code',
      returnDevComponent: true
    })
    expect(result).toEqual(response)
  })

  it('prepares four nodes at a time and batches sandbox jobs without repeating plugin code', async () => {
    let activePreparation = 0
    let maxActivePreparation = 0
    let activeRequests = 0
    let maxActiveRequests = 0
    const nodes = Array.from({ length: 129 }, (_, index) => ({
      id: `node-${index}`,
      getCSSAsync: vi.fn(async () => {
        activePreparation += 1
        maxActivePreparation = Math.max(maxActivePreparation, activePreparation)
        await Promise.resolve()
        activePreparation -= 1
        return { color: `color-${index}` }
      })
    })) as unknown as SceneNode[]
    mocked.resolveStylesFromNode.mockImplementation(async (style) => style)
    mocked.requestPluginSandbox.mockImplementation(async (_worker, payload) => {
      const jobs = (payload as { jobs: unknown[] }).jobs
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await Promise.resolve()
      activeRequests -= 1
      return { results: jobs.map(() => ({ codeBlocks: [] })) }
    })

    const results = await generateCodeBlocksForNodes(
      nodes,
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'plugin-code',
      { returnDevComponent: true }
    )

    expect(results).toHaveLength(nodes.length)
    expect(maxActivePreparation).toBe(4)
    expect(maxActiveRequests).toBe(4)
    expect(mocked.requestPluginSandbox).toHaveBeenCalledTimes(5)
    expect(
      mocked.requestPluginSandbox.mock.calls.map(
        ([, payload]) => (payload as { jobs: unknown[] }).jobs.length
      )
    ).toEqual([32, 32, 32, 32, 1])
    for (const [, payload] of mocked.requestPluginSandbox.mock.calls) {
      const batch = payload as { jobs: Array<Record<string, unknown>>; pluginCode?: string }
      expect(batch.pluginCode).toBe('plugin-code')
      expect(batch.jobs.every((job) => !Object.hasOwn(job, 'pluginCode'))).toBe(true)
    }
  })

  it('splits timed-out batches so a slow aggregate does not break valid per-node work', async () => {
    const nodes = Array.from({ length: 2 }, (_, index) => ({
      getCSSAsync: vi.fn(async () => ({ color: `color-${index}` }))
    })) as unknown as SceneNode[]
    mocked.resolveStylesFromNode.mockImplementation(async (style) => style)
    mocked.requestPluginSandbox.mockImplementation(async (_worker, payload) => {
      const jobs = (payload as { jobs: unknown[] }).jobs
      if (jobs.length > 1) {
        throw new PluginSandboxError('timeout', 'batch timeout')
      }
      return { results: [{ codeBlocks: [] }] }
    })

    await expect(
      generateCodeBlocksForNodes(
        nodes,
        { cssUnit: 'px', rootFontSize: 16, scale: 1 },
        'plugin-code'
      )
    ).resolves.toHaveLength(2)
    expect(
      mocked.requestPluginSandbox.mock.calls.map(
        ([, payload]) => (payload as { jobs: unknown[] }).jobs.length
      )
    ).toEqual([2, 1, 1])
  })
})
