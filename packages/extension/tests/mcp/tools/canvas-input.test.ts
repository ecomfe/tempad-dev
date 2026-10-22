import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCodedError } from '@/mcp/errors'
import { applyResolvedCanvas, handleApplyCanvas } from '@/mcp/tools/canvas'
import { parseCanvasHtml } from '@/mcp/tools/canvas/html'
import { parseCanvasMarkup } from '@/mcp/tools/canvas/markup'

import { createFixture } from '../../fakes/figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas input diagnostics', () => {
  it.each([
    ['AT&T&nbsp;Inc R&D&#169;', 'AT&T\u00a0Inc R&D©', false],
    ['Q&A&unknown;', 'Q&A&unknown;', true],
    ['&&amp;&amp; &#x41;', '&&& A', false]
  ] as const)('decodes entities after literal ampersands: %s', (source, decoded, warned) => {
    const parsed = parseCanvasHtml(`<span data-name="${source}">${source}</span>`)
    expect(parsed.text).toBe(decoded)
    expect(parsed.attributes['data-name']).toBe(decoded)
    expect(!!parsed.hasUnknownEntities).toBe(warned)
  })

  it('decodes every named entity documented by the authoring skill', () => {
    const reference = readFileSync(
      new URL(
        '../../../../../agent-plugin/src/skills/design-in-figma/references/canvas-html.md',
        import.meta.url
      ),
      'utf8'
    )
    const names = [
      ...reference
        .match(/these named entities decode: ([\s\S]*?)\. Other names/)![1]!
        .matchAll(/`(\w+)`/g)
    ].map((match) => match[1]!)
    const expected: Record<string, string> = {
      amp: '&',
      apos: "'",
      bull: '•',
      copy: '©',
      gt: '>',
      hellip: '…',
      ldquo: '“',
      lsquo: '‘',
      lt: '<',
      mdash: '—',
      middot: '·',
      nbsp: '\u00a0',
      ndash: '–',
      quot: '"',
      rdquo: '”',
      reg: '®',
      rsquo: '’',
      trade: '™'
    }
    expect(names).toEqual(Object.keys(expected))
    for (const name of names) {
      expect(parseCanvasHtml(`<span>&${name};</span>`).text).toBe(expected[name])
    }
  })

  it.each([
    ['&unknown; &euro; &unknown;', true],
    ['&amp;unknown; &#8364; R&D', false]
  ] as const)('preserves literal entities with one bounded warning: %s', async (text, warned) => {
    const fixture = createFixture()
    const result = await handleApplyCanvas({
      mode: 'create',
      markup: `<div data-key="root" class="flex w-80 h-20"><span data-key="label" class="w-fit h-fit">${text}</span></div>`
    })
    expect((fixture.getNode(result.nodeIdsByKey.label!) as TextNode).characters).toBe(
      warned ? text : '&unknown; € R&D'
    )
    const warnings = result.verification.warnings.filter(
      ({ code }) => code === 'unknown-html-entity'
    )
    expect(warnings).toHaveLength(warned ? 1 : 0)
    if (warned)
      expect(warnings[0]).toMatchObject({
        message: expect.stringContaining('literal'),
        key: 'root'
      })
  })

  it.each([
    '<div data-key="root" class="w-20 h-20">',
    '<div data-key=root class="w-20 h-20"/>',
    '<span data-key="root" class="w-20 h-20">&#x110000;</span>'
  ])('classifies malformed HTML as input failure: %s', async (markup) => {
    const fixture = createFixture()
    await expect(handleApplyCanvas({ mode: 'create', markup })).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining('INVALID_CANVAS_SPEC')
    })
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it.each(['uncoded', 'coded'] as const)(
    'marks %s local theme-read failures as aborted preparation',
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
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
        message: expect.stringContaining(failure.message),
        cause: failure
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

  it('keeps a failed library import uncertain even before the Undo boundary', async () => {
    const fixture = createFixture()
    vi.mocked(figma.variables.importVariableByKeyAsync).mockRejectedValueOnce(
      new Error('Library import interrupted')
    )
    await expect(
      applyResolvedCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-20 h-20"/>',
        bindings: { root: { variables: { width: { key: 'library-width' } } } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: 'Library import interrupted'
    })
    expect(figma.variables.importVariableByKeyAsync).toHaveBeenCalledWith('library-width')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it('keeps a coded validation failure uncertain after importing a library component', async () => {
    const fixture = createFixture()
    await expect(
      applyResolvedCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-80 h-40"><div data-key="action" class="w-20 h-10"/></div>',
        bindings: {
          action: {
            component: { key: 'component-key' },
            componentProperties: { Missing: 'value' }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('INVALID_CANVAS_SPEC'),
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC }
    })
    expect(fixture.importComponentByKeyAsync).toHaveBeenCalledWith('component-key')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it('does not let a later aborted download erase earlier library-import uncertainty', async () => {
    const fixture = createFixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    await expect(
      applyResolvedCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-80 h-40"><div data-key="action" class="w-20 h-10"/></div>',
        bindings: {
          action: { component: { key: 'component-key' } },
          root: {
            figma: {
              fills: [
                { type: 'VIDEO', videoUrl: 'https://example.com/movie.mp4', scaleMode: 'FILL' }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining('Video download failed')
    })
    expect(fixture.importComponentByKeyAsync).toHaveBeenCalledWith('component-key')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
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
