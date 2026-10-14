import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCodedError } from '@/mcp/errors'
import { handleApplyCanvas } from '@/mcp/tools/canvas'
import { parseCanvasHtml } from '@/mcp/tools/canvas/html'
import { parseCanvasMarkup } from '@/mcp/tools/canvas/markup'

import { createFixture } from '../../fakes/figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas input diagnostics', () => {
  it.each([
    '<div data-key="root" class="w-20 h-20">',
    '<div data-key=root class="w-20 h-20"/>',
    '<span data-key="root" class="w-20 h-20">&#x110000;</span>'
  ])('classifies malformed HTML as input failure: %s', async (markup) => {
    const fixture = createFixture()
    await expect(handleApplyCanvas({ mode: 'create', markup })).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
    })
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it.each(['uncoded', 'coded'] as const)(
    'preserves %s live theme-read failures as execution failures',
    async (kind) => {
      const fixture = createFixture()
      const failure =
        kind === 'coded'
          ? createCodedError(TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE, 'Variable inaccessible')
          : new Error('Variable read failed')
      vi.mocked(figma.variables.getLocalVariablesAsync).mockRejectedValueOnce(failure)
      await expect(
        handleApplyCanvas({
          mode: 'create',
          markup: '<div data-key="root" class="w-(--width) h-20"/>',
          theme: { variables: { '--width': { variableKey: 'width' } } }
        })
      ).rejects.toMatchObject({
        code:
          kind === 'coded'
            ? TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SCOPE
            : TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        message: failure.message
      })
      expect(fixture.commitUndo).not.toHaveBeenCalled()
    }
  )

  it('reports the original variable utility when early theme validation rejects its fallback', () => {
    expect(() =>
      parseCanvasMarkup({
        mode: 'create',
        markup:
          '<div data-key="root" class="w-80 h-80"><span data-key="label" class="absolute left-0 top-0 size-fit font-(--weight)">Label</span></div>',
        theme: { variables: { '--weight': { variableKey: 'weight' } } },
        variableCollections: {
          type: {
            name: 'Type',
            modes: { base: { name: 'Base' } },
            variables: { weight: { name: 'Weight', type: 'FLOAT', values: { base: 1001 } } }
          }
        }
      })
    ).toThrow('"font-(--weight)"')
  })

  it('does not warn about native-only preservation values the caller never supplied', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas({
      mode: 'create',
      markup:
        '<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="w-20 h-20">Before</span></div>'
    })
    const label = fixture.getNode(created.nodeIdsByKey.label!) as TextNode
    for (const field of ['width', 'height', 'minWidth'] as const) {
      label.setBoundVariable(field, fixture.variables.get('variable:spacing')!)
    }
    label.minWidth = 10
    const collection = figma.variables.createVariableCollection('Content')
    const characters = figma.variables.createVariable('Text', collection, 'STRING')
    characters.setValueForMode(collection.defaultModeId, 'Before')
    label.setBoundVariable('characters', characters)
    const updated = await handleApplyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { label: { figma: { name: 'Renamed' } } }
    })
    expect(label.name).toBe('Renamed')
    expect(
      (updated.verification.warnings ?? []).filter(
        ({ code }) => code === 'literal-ignored-by-binding'
      )
    ).toEqual([])
    expect(label.boundVariables).toMatchObject({
      width: { id: 'variable:spacing' },
      characters: { id: characters.id }
    })
  })

  it('still warns about an explicit native stroke literal ignored by a binding', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-20 h-20"/>'
    })
    fixture
      .getNode(created.rootNodeId!)
      .setBoundVariable('strokeWeight', fixture.variables.get('variable:spacing')!)
    const updated = await handleApplyCanvas({
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      native: { root: { figma: { stroke: { weight: 2 } } } }
    })
    expect(updated.verification.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'literal-ignored-by-binding',
          message: expect.stringContaining('strokeWeight')
        })
      ])
    )
    expect(fixture.getNode(created.rootNodeId!).boundVariables).toMatchObject({
      strokeWeight: { id: 'variable:spacing' }
    })
  })

  it('decodes common HTML punctuation and symbols while preserving unknown names', () => {
    expect(
      parseCanvasHtml(
        '<span>&mdash; &ndash; &hellip; &lsquo;Hi&rsquo; &ldquo;Hello&rdquo; &copy; &reg; &trade; &bull; &middot; R&D; &unknown;</span>'
      ).text
    ).toBe('— – … ‘Hi’ “Hello” © ® ™ • · R&D; &unknown;')
  })
})
