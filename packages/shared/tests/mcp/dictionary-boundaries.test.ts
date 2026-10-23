import { describe, expect, it } from 'vitest'

import {
  ApplyCanvasParametersSchema,
  ApplyCanvasResultSchema,
  CanvasResolvedApplyParametersSchema,
  CanvasThemeSchema,
  CanvasVariableCollectionsSchema,
  DesignSystemResourcesResultSchema
} from '../../src/mcp/tools'

const dictionary = <Value>(value: Value) => Object.fromEntries([['__proto__', value]])

describe('dictionary keys across public schemas', () => {
  it('retains prototype-like native, resource, and asset keys in public canvas requests', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="__proto__"/>',
      native: dictionary({ figma: { locked: true } }),
      variableCollections: dictionary(null),
      styles: dictionary(null),
      assets: dictionary({ type: 'SVG', svg: '<svg/>' })
    }
    expect(ApplyCanvasParametersSchema.parse(input)).toEqual(input)
  })

  it('retains nested collection, mode, variable, and binding keys after resolution', () => {
    const input = {
      mode: 'create',
      markup: '<div data-key="__proto__"/>',
      bindings: dictionary({ figma: { locked: true } }),
      variableCollections: dictionary({
        modes: dictionary({ name: 'Dark' }),
        variables: dictionary({ type: 'FLOAT', values: dictionary(8) })
      }),
      styles: dictionary(null),
      assets: dictionary({ type: 'SVG', svg: '<svg/>' })
    }
    expect(CanvasResolvedApplyParametersSchema.parse(input)).toEqual(input)
    expect(
      CanvasVariableCollectionsSchema.safeParse(
        dictionary({ variables: dictionary({ type: 'FLOAT', values: dictionary([]) }) })
      ).success
    ).toBe(false)
  })

  it('validates a prototype-like key instead of dropping it before key validation', () => {
    const result = CanvasThemeSchema.safeParse({
      variables: dictionary({ variableKey: 'color' })
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['variables', '__proto__'])
  })

  it('retains node identity keys and rejects invalid node ids in canvas results', () => {
    const input = {
      rootNodeId: '1:1',
      nodeIdsByKey: dictionary('1:1'),
      createdNodeIds: ['1:1'],
      updatedNodeIds: [],
      removedNodeIds: [],
      mutationCount: 1,
      verification: { status: 'passed', nodesChecked: 1, referencesChecked: 0, warnings: [] }
    }
    expect(ApplyCanvasResultSchema.parse(input)).toEqual(input)
    expect(
      ApplyCanvasResultSchema.safeParse({ ...input, nodeIdsByKey: dictionary('') }).success
    ).toBe(false)
  })

  it('retains component property names in catalog output', () => {
    const input = {
      catalogId: 'catalog',
      components: [
        {
          ref: 'c1',
          tag: 'Card',
          name: 'Card',
          props: dictionary({ type: 'text', default: 'Text' })
        }
      ],
      variables: [],
      collections: [],
      styles: [],
      omitted: dictionary(1)
    }
    expect(DesignSystemResourcesResultSchema.parse(input)).toEqual(input)
  })
})
