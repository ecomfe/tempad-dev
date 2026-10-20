import { type CanvasResolvedApplyParameters, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'
import {
  createVariableState,
  resolveCollection,
  resolvedCollection,
  resolvedModeId,
  resolvedVariable,
  resolveModeId,
  resolveVariable
} from '@/mcp/tools/canvas/variables'

import { createFixture } from '../../fakes/figma'

afterEach(() => vi.unstubAllGlobals())

describe('canvas variable resolution', () => {
  it.each(['variable', 'collection', 'mode'] as const)(
    'distinguishes an invalid %s reference from a missing preflight result',
    async (kind) => {
      createFixture()
      const state = createVariableState()
      const collection = figma.variables.createVariableCollection('Modes')
      const resolve = {
        variable: () => resolveVariable({ id: 'missing' }, state),
        collection: () => resolveCollection('missing', state),
        mode: () => resolveModeId(collection, 'missing', state)
      }
      const resolved = {
        variable: () => resolvedVariable({ id: 'missing' }, state),
        collection: () => resolvedCollection('missing', state),
        mode: () => resolvedModeId(collection, 'missing', state)
      }

      await expect(resolve[kind]()).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
      })
      expect(resolved[kind]).toThrowError(
        expect.objectContaining({ code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED })
      )
    }
  )

  it.each(['base', 'extension', 'styled range'] as const)(
    'converges native FLOAT precision in a %s resource without hiding a representable change',
    async (path) => {
      const fixture = createFixture()
      const createVariable = vi.mocked(figma.variables.createVariable).getMockImplementation()!
      const writes = vi.fn()
      vi.mocked(figma.variables.createVariable).mockImplementation((name, collection, type) => {
        const variable = createVariable(name, collection, type)
        const setValueForMode = variable.setValueForMode.bind(variable)
        variable.setValueForMode = (mode, value) => {
          writes(mode, value)
          setValueForMode(mode, typeof value === 'number' ? Math.fround(value) : value)
        }
        return variable
      })
      const request = (value: number): CanvasResolvedApplyParameters => ({
        mode: 'create',
        markup:
          path === 'styled range'
            ? '<div data-key="root" class="flex w-80 h-80"><span data-key="label" class="w-40 h-10">Range metrics</span></div>'
            : '<div data-key="root" class="w-80 h-80"></div>',
        variableCollections: {
          tokens: {
            name: 'Typography',
            modes: { default: { name: 'Default' } },
            variables: {
              size: {
                name: 'Size',
                type: 'FLOAT',
                values: { default: path === 'extension' ? 8 : value }
              }
            }
          },
          ...(path === 'extension'
            ? {
                extended: {
                  name: 'Extended',
                  extends: { collectionKey: 'tokens' },
                  overrides: [{ variable: { variableKey: 'size' }, values: { default: value } }]
                }
              }
            : {})
        },
        ...(path === 'styled range'
          ? {
              styles: {
                type: {
                  type: 'TEXT',
                  name: 'Body',
                  fontName: { family: 'Inter', style: 'Regular' },
                  fontSize: 16,
                  lineHeight: { unit: 'PIXELS', value: 24 },
                  variables: { fontSize: { variableKey: 'size' } }
                }
              },
              bindings: {
                label: {
                  figma: {
                    text: {
                      ranges: [
                        {
                          start: 0,
                          end: 5,
                          textStyle: { styleKey: 'type' },
                          fontSize: value,
                          lineHeight: { unit: 'PIXELS', value: 32 }
                        }
                      ]
                    }
                  }
                }
              }
            }
          : {})
      })
      const created = await applyCanvas(request(21.1))
      const size = [...fixture.variables.values()].find((variable) => variable.name === 'Size')!
      const values = () =>
        path === 'extension'
          ? (
              [...fixture.variableCollections.values()].find(
                (collection) => collection.name === 'Extended'
              )! as unknown as ExtendedVariableCollection
            ).variableOverrides[size.id]!
          : size.valuesByMode
      // The native result exposed this value for the authored 21.1px token.
      expect(Object.values(values())).toEqual([21.100000381469727])
      const update = (value: number) =>
        applyCanvas({
          ...request(value),
          mode: 'update',
          targetNodeId: created.rootNodeId!
        })
      writes.mockClear()
      await expect(update(21.1)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(writes).not.toHaveBeenCalled()

      const next = 21.10000228881836
      expect((await update(next)).mutationCount).toBeGreaterThan(0)
      expect(Object.values(values())).toEqual([next])
      expect(writes).toHaveBeenCalledTimes(1)
      await expect(update(next)).resolves.toMatchObject({ mutationCount: 0, updatedNodeIds: [] })
      expect(writes).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['alias', 'string'] as const)('retains exact %s resource identity', async (kind) => {
    createFixture()
    const request = (changed: boolean): CanvasResolvedApplyParameters => ({
      mode: 'create',
      markup: '<div data-key="root" class="w-80 h-80"></div>',
      variableCollections: {
        tokens: {
          name: 'Tokens',
          modes: { default: { name: 'Default' } },
          variables: {
            first: { name: 'First', type: 'FLOAT', values: { default: 21.1 } },
            second: { name: 'Second', type: 'FLOAT', values: { default: 21.1 } },
            value:
              kind === 'alias'
                ? {
                    name: 'Value',
                    type: 'FLOAT',
                    values: { default: { variable: { variableKey: changed ? 'second' : 'first' } } }
                  }
                : { name: 'Value', type: 'STRING', values: { default: changed ? '21.10' : '21.1' } }
          }
        }
      }
    })
    const created = await applyCanvas(request(false))
    const update = (changed: boolean) =>
      applyCanvas({
        ...request(changed),
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    await expect(update(false)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(update(true)).resolves.toMatchObject({ mutationCount: 1, updatedNodeIds: [] })
    await expect(update(true)).resolves.toMatchObject({ mutationCount: 0 })
  })
})
