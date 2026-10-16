import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
})
