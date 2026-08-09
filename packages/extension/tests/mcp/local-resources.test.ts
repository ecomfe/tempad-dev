import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getLocalStyles,
  getLocalVariableCollections,
  getLocalVariables,
  getNodeById,
  getStyleById,
  getVariableById,
  getVariableCollectionById
} from '@/mcp/local-resources'

afterEach(() => vi.unstubAllGlobals())

describe('local Figma resource reads', () => {
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
})
