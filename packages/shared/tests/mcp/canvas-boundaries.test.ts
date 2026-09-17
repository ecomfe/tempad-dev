import { describe, expect, it } from 'vitest'

import {
  ApplyCanvasParametersSchema,
  ApplyCanvasResultSchema,
  CanvasFigmaLayoutGridSchema,
  CanvasFigmaVectorNetworkSchema,
  CanvasResolvedApplyParametersSchema,
  CanvasVariableCollectionsSchema,
  MAX_CANVAS_VARIABLE_RESOURCES
} from '../../src/mcp/tools'

// Both the public envelope and the resolved dialect enforce the same operation scope.
describe.each([ApplyCanvasParametersSchema, CanvasResolvedApplyParametersSchema])(
  'Canvas operation boundaries',
  (schema) => {
    it.each([
      [{ mode: 'create' }, 'Create mode requires markup or page.'],
      [{ mode: 'create', page: { id: '0:1' } }, 'Page-only create cannot include page.id.'],
      [
        { mode: 'create', markup: '<div/>', selection: [] },
        'selection is only valid in activate mode.'
      ],
      [
        { mode: 'update', page: { id: '0:1' }, selection: [] },
        'selection is only valid in activate mode.'
      ],
      [
        { mode: 'update', page: { name: 'New name' } },
        'Page-only update requires page.id or page.pageKey.'
      ],
      [
        { mode: 'update', page: { id: '0:1' }, styles: { deleted: null } },
        'Page-only update cannot include node or resource fields.'
      ],
      [
        { mode: 'remove', targetNodeId: '1:1', markup: '<div/>' },
        'Remove mode cannot include markup.'
      ],
      [
        { mode: 'remove', targetNodeId: '1:1', selection: [] },
        'selection is only valid in activate mode.'
      ],
      [{ mode: 'remove', page: { id: '0:1' } }, 'Page removal requires page.pageKey.'],
      [{ mode: 'activate' }, 'Activate mode requires page.id or page.pageKey.'],
      [
        { mode: 'activate', page: { id: '0:1' }, targetNodeId: '1:1' },
        'targetNodeId is not valid in activate mode.'
      ],
      [
        { mode: 'activate', page: { id: '0:1' }, styles: { deleted: null } },
        'Activate mode cannot include node or resource fields.'
      ]
    ])('rejects %j with a scope diagnostic', (input, message) => {
      const result = schema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues.map((issue) => issue.message)).toContain(message)
    })
  }
)

it('bounds variable resource declarations, including explicit removals', () => {
  const resources = Object.fromEntries(
    Array.from({ length: MAX_CANVAS_VARIABLE_RESOURCES }, (_, i) => [`collection-${i}`, null])
  )
  expect(CanvasVariableCollectionsSchema.safeParse(resources).success).toBe(true)
  const result = CanvasVariableCollectionsSchema.safeParse({ ...resources, overflow: null })
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues[0]?.message).toContain('at most')
})

it('requires a result identity and a root identity for root removal', () => {
  const result = {
    nodeIdsByKey: {},
    createdNodeIds: [],
    updatedNodeIds: [],
    removedNodeIds: [],
    mutationCount: 0,
    verification: { status: 'passed', nodesChecked: 0, referencesChecked: 0, warnings: [] }
  }
  expect(ApplyCanvasResultSchema.safeParse(result).success).toBe(false)
  expect(ApplyCanvasResultSchema.safeParse({ ...result, rootRemoved: true }).success).toBe(false)
  expect(
    ApplyCanvasResultSchema.safeParse({ ...result, rootRemoved: true, rootNodeId: '1:1' }).success
  ).toBe(true)
})

it('rejects a bound section size on a stretch grid but allows an unbound stretch grid', () => {
  const grid = { pattern: 'COLUMNS', alignment: 'STRETCH', count: 2, gutterSize: 8 }
  expect(CanvasFigmaLayoutGridSchema.safeParse(grid).success).toBe(true)
  expect(
    CanvasFigmaLayoutGridSchema.safeParse({ ...grid, variables: { sectionSize: { id: 'size' } } })
      .success
  ).toBe(false)
})

it('accepts reverse-oriented vector segments and rejects empty or negative-index loops', () => {
  const network = {
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 }
    ],
    segments: [
      { start: 0, end: 1 },
      { start: 2, end: 1 },
      { start: 2, end: 0 }
    ]
  }
  const withLoop = (loop: number[]) => ({
    ...network,
    regions: [{ windingRule: 'NONZERO', loops: [loop] }]
  })
  expect(CanvasFigmaVectorNetworkSchema.safeParse(withLoop([0, 1, 2])).success).toBe(true)
  expect(CanvasFigmaVectorNetworkSchema.safeParse(withLoop([])).success).toBe(false)
  expect(CanvasFigmaVectorNetworkSchema.safeParse(withLoop([0, -1])).success).toBe(false)
})
