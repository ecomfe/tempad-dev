import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getCurrentContextNodeById,
  getLocalStyles,
  getLocalVariableCollections,
  getLocalVariables,
  getMainComponent,
  getNodeById,
  getStyleById,
  getVariableById,
  getVariableCollectionById
} from '@/mcp/local-resources'

afterEach(() => vi.unstubAllGlobals())

describe('local Figma resource reads', () => {
  it('reads an attached node from the current context without using the async backend', () => {
    const node = { id: '1:1', removed: false } as BaseNode
    const getNodeByIdAsync = vi.fn()
    vi.stubGlobal('figma', {
      getNodeById: vi.fn(() => node),
      getNodeByIdAsync
    } as unknown as PluginAPI)

    expect(getCurrentContextNodeById(node.id)).toBe(node)
    expect(getNodeByIdAsync).not.toHaveBeenCalled()
  })

  it('returns no current-context node when the synchronous API is unavailable', () => {
    vi.stubGlobal('figma', {
      getNodeById: vi.fn(() => {
        throw new Error('current context unavailable')
      })
    } as unknown as PluginAPI)

    expect(getCurrentContextNodeById('1:1')).toBeNull()
  })

  it('uses an attached instance relationship without waiting for the async backend', async () => {
    const component = { id: '1:1', removed: false } as ComponentNode
    const getMainComponentAsync = vi.fn<InstanceNode['getMainComponentAsync']>()
    const instance = { componentProperties: {}, getMainComponentAsync, mainComponent: component }

    await expect(getMainComponent(instance as unknown as InstanceNode)).resolves.toBe(component)
    expect(getMainComponentAsync).not.toHaveBeenCalled()
  })

  it('uses the asynchronous instance relationship when the current context cannot read it', async () => {
    const component = { id: '1:1', removed: false } as ComponentNode
    const getMainComponentAsync = vi
      .fn<InstanceNode['getMainComponentAsync']>()
      .mockResolvedValue(component)
    const instance = { componentProperties: {}, getMainComponentAsync, mainComponent: null }

    await expect(getMainComponent(instance as unknown as InstanceNode)).resolves.toBe(component)
    expect(getMainComponentAsync).toHaveBeenCalledOnce()
  })

  it('prefers the asynchronous Plugin API', async () => {
    const node = { id: '1:1' } as BaseNode
    const getNodeByIdAsync = vi.fn().mockResolvedValue(node)
    const getNodeByIdSync = vi.fn()
    vi.stubGlobal('figma', {
      getNodeById: getNodeByIdSync,
      getNodeByIdAsync
    } as unknown as PluginAPI)

    await expect(getNodeById(node.id)).resolves.toBe(node)
    expect(getNodeByIdSync).not.toHaveBeenCalled()
  })

  it('uses current-context reads while the rewritten async backend is unavailable', async () => {
    const node = { id: '1:1' } as BaseNode
    const style = { id: 'S:1', type: 'PAINT' } as PaintStyle
    const textStyle = { id: 'S:2', type: 'TEXT' } as TextStyle
    const effectStyle = { id: 'S:3', type: 'EFFECT' } as EffectStyle
    const gridStyle = { id: 'S:4', type: 'GRID' } as GridStyle
    const variable = { id: 'V:1' } as Variable
    const collection = { id: 'VC:1' } as VariableCollection
    const unavailable = () => Promise.reject(new Error('async backend unavailable'))

    vi.stubGlobal('figma', {
      getLocalEffectStyles: vi.fn(() => [effectStyle]),
      getLocalEffectStylesAsync: vi.fn(unavailable),
      getLocalGridStyles: vi.fn(() => [gridStyle]),
      getLocalGridStylesAsync: vi.fn(unavailable),
      getLocalPaintStyles: vi.fn(() => [style]),
      getLocalPaintStylesAsync: vi.fn(unavailable),
      getLocalTextStyles: vi.fn(() => [textStyle]),
      getLocalTextStylesAsync: vi.fn(unavailable),
      getNodeById: vi.fn(() => node),
      getNodeByIdAsync: vi.fn(unavailable),
      getStyleById: vi.fn(() => style),
      getStyleByIdAsync: vi.fn(unavailable),
      variables: {
        getLocalVariableCollections: vi.fn(() => [collection]),
        getLocalVariableCollectionsAsync: vi.fn(unavailable),
        getLocalVariables: vi.fn(() => [variable]),
        getLocalVariablesAsync: vi.fn(unavailable),
        getVariableById: vi.fn(() => variable),
        getVariableByIdAsync: vi.fn(unavailable),
        getVariableCollectionById: vi.fn(() => collection),
        getVariableCollectionByIdAsync: vi.fn(unavailable)
      }
    } as unknown as PluginAPI)

    await expect(
      Promise.all([
        getNodeById(node.id),
        getStyleById(style.id),
        getVariableById(variable.id),
        getVariableCollectionById(collection.id),
        getLocalVariables(),
        getLocalVariableCollections(),
        getLocalStyles()
      ])
    ).resolves.toEqual([
      node,
      style,
      variable,
      collection,
      [variable],
      [collection],
      [style, textStyle, effectStyle, gridStyle]
    ])
  })

  it('loads the current page and retries a transient connection timeout once', async () => {
    const node = { id: '1:1' } as BaseNode
    const timeout = new Error('Unable to establish connection to Figma after 10 seconds')
    const getNodeByIdAsync = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValue(node)
    const getNodeByIdSync = vi.fn(() => {
      throw timeout
    })
    const loadAsync = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('figma', {
      currentPage: { loadAsync },
      getNodeById: getNodeByIdSync,
      getNodeByIdAsync
    } as unknown as PluginAPI)

    await expect(getNodeById(node.id)).resolves.toBe(node)
    expect(loadAsync).toHaveBeenCalledOnce()
    expect(getNodeByIdAsync).toHaveBeenCalledTimes(2)
    expect(getNodeByIdSync).toHaveBeenCalledOnce()
  })

  it('preserves the asynchronous read error when the sync fallback also fails', async () => {
    const asyncError = new Error('asynchronous read failed')
    const syncError = new Error('synchronous fallback failed')
    vi.stubGlobal('figma', {
      getNodeById: vi.fn(() => {
        throw syncError
      }),
      getNodeByIdAsync: vi.fn().mockRejectedValue(asyncError)
    } as unknown as PluginAPI)

    await expect(getNodeById('1:1')).rejects.toBe(asyncError)
  })
})
