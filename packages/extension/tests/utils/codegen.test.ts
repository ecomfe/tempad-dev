import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => {
  class MockWorker {}

  return {
    MockWorker,
    createWorkerRequester: vi.fn(),
    resolveStylesFromNode: vi.fn(),
    getDesignComponent: vi.fn()
  }
})

vi.mock('@/codegen/requester', () => ({
  createWorkerRequester: mocked.createWorkerRequester
}))

vi.mock('@/codegen/worker?worker&inline', () => ({
  default: mocked.MockWorker
}))

vi.mock('@tempad-dev/shared', () => ({
  resolveStylesFromNode: mocked.resolveStylesFromNode
}))

vi.mock('@/utils/component', () => ({
  getDesignComponent: mocked.getDesignComponent
}))

import { codegen, generateCodeBlocksForNode, workerUnitOptions } from '@/utils/codegen'

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

  it('dispatches codegen requests through the worker requester bridge', async () => {
    const response = { css: '.button { color: red; }' }
    const request = vi.fn().mockResolvedValue(response)
    mocked.createWorkerRequester.mockReturnValue(request)

    const style = { color: 'red' }
    const component = { name: 'Button' } as unknown as ReturnType<typeof mocked.getDesignComponent>
    const options = { useRem: false, rootFontSize: 16, scale: 1 }

    const result = await codegen(style, component, options, 'plugin()', true)

    expect(mocked.createWorkerRequester).toHaveBeenCalledWith(mocked.MockWorker)
    expect(request).toHaveBeenCalledWith({
      style,
      component,
      options,
      pluginCode: 'plugin()',
      returnDevComponent: true
    })
    expect(result).toEqual(response)
  })

  it('omits component payload when input component is null', async () => {
    const response = { css: '.button { color: red; }' }
    const request = vi.fn().mockResolvedValue(response)
    mocked.createWorkerRequester.mockReturnValue(request)

    await codegen({ color: 'red' }, null, { useRem: false, rootFontSize: 16, scale: 1 })

    expect(request).toHaveBeenCalledWith({
      style: { color: 'red' },
      component: undefined,
      options: { useRem: false, rootFontSize: 16, scale: 1 },
      pluginCode: undefined,
      returnDevComponent: undefined
    })
  })

  it('resolves node style/component data before sending generation request', async () => {
    const response = { css: '.card { color: green; }' }
    const request = vi.fn().mockResolvedValue(response)
    mocked.createWorkerRequester.mockReturnValue(request)

    const rawStyle = { color: 'blue' }
    const resolvedStyle = { color: 'green' }
    mocked.resolveStylesFromNode.mockResolvedValue(resolvedStyle)

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
    expect(mocked.resolveStylesFromNode).toHaveBeenCalledWith(rawStyle, node)
    expect(mocked.getDesignComponent).toHaveBeenCalledWith(node)
    expect(mocked.createWorkerRequester).toHaveBeenCalledWith(mocked.MockWorker)
    expect(request).toHaveBeenCalledWith({
      style: resolvedStyle,
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
})
