import { afterEach, expect, it, vi } from 'vitest'

import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { renderTree } from '@/mcp/tools/code/render'
import { processTokens } from '@/mcp/tools/code/tokens/process'
import { createStyleVarResolver, resolveStyleMap } from '@/mcp/tools/code/tokens/resolve'
import { buildVisibleTree } from '@/mcp/tools/code/tree'
import { stringifyComponent } from '@/utils/component'

vi.mock('@/ui/state', () => ({ activePlugin: { value: undefined }, options: { value: {} } }))

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it.each([
  [false, 'Bold Italic', 700, 'ITALIC'],
  [true, 'Bold Italic', 700, 'ITALIC'],
  [false, 'Medium', 500, 'REGULAR'],
  [true, 'Medium', 500, 'REGULAR']
] as const)(
  'renders native range fonts with resolveTokens=%s and face %s',
  async (resolveTokens, face, weight, nativeStyle) => {
    const variable = {
      id: 'face',
      name: 'Style',
      resolvedType: 'STRING',
      scopes: ['FONT_STYLE'],
      variableCollectionId: 'fonts',
      valuesByMode: { base: 'Bold Italic', alternate: 'Medium' },
      resolveForConsumer: () => ({ value: face, resolvedType: 'STRING' })
    } as unknown as Variable
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: {
        getVariableById: () => variable,
        getVariableCollectionById: () => ({
          id: 'fonts',
          name: 'Fonts',
          defaultModeId: 'base',
          modes: [
            { modeId: 'base', name: 'Base' },
            { modeId: 'alternate', name: 'Alternate' }
          ]
        })
      },
      getStyleById: () => null
    })
    const segments = [
      {
        characters: 'Range: ',
        start: 0,
        end: 7,
        fontName: { family: 'Inter', style: 'Regular' },
        fontWeight: 400,
        fontStyle: 'REGULAR',
        boundVariables: {}
      },
      {
        characters: `Crimson Pro ${face}`,
        start: 7,
        end: 7 + `Crimson Pro ${face}`.length,
        fontName: { family: 'Crimson Pro', style: face },
        fontWeight: weight,
        fontStyle: nativeStyle,
        boundVariables: { fontStyle: { type: 'VARIABLE_ALIAS', id: 'face' } }
      }
    ].map((segment) => ({
      ...segment,
      fontSize: 30,
      fills: [],
      listOptions: { type: 'NONE' },
      paragraphSpacing: 0,
      indentation: 0
    })) as unknown as StyledTextSegment[]
    const node = {
      id: 'text',
      type: 'TEXT',
      name: 'Range',
      visible: true,
      characters: `Range: Crimson Pro ${face}`,
      x: 0,
      y: 0,
      width: 500,
      height: 40,
      absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 40 },
      absoluteRenderBounds: { x: 0, y: 0, width: 500, height: 40 },
      fills: [],
      strokes: [],
      effects: [],
      boundVariables: { fontStyle: [{ type: 'VARIABLE_ALIAS', id: 'face' }] },
      getStyledTextSegments: () => segments,
      getCSSAsync: async () => ({
        'font-family': 'Crimson Pro',
        'font-weight': String(weight),
        'font-style': nativeStyle === 'ITALIC' ? 'italic' : 'normal'
      })
    } as unknown as TextNode
    const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
    const tree = buildVisibleTree([node])
    const collected = await collectNodeData(tree, config, new Map(), createGetCodeCacheContext())
    const ctx = {
      ...collected,
      nodes: new Map([['text', node]]),
      config,
      layout: new Map(),
      svgs: new Map(),
      fontStyleVariableIds: new Set<string>()
    }
    const stringify = (rendered: Awaited<ReturnType<typeof renderTree>>) => {
      if (!rendered || typeof rendered === 'string') throw new Error('Expected text component')
      return stringifyComponent(rendered, { lang: 'vue' })
    }
    const first = stringify(await renderTree('text', tree, ctx))
    const cache = new Map([['face', variable]])
    const processed = await processTokens({
      ...ctx,
      code: first,
      variableIds: new Set(['face']),
      usedCandidateIds: new Set(),
      variableCache: cache,
      resolveTokens
    })
    const resolver = createStyleVarResolver(processed.sourceIndex, cache, config)
    const code = resolveTokens
      ? stringify(
          await renderTree('text', tree, {
            ...ctx,
            styles: resolveStyleMap(ctx.styles, ctx.nodes, resolver),
            resolveStyleVars: resolver
          })
        )
      : first
    expect(processed.tokensByCanonical['--Style']?.value).toEqual({
      'Fonts:Base': 'Bold Italic',
      'Fonts:Alternate': 'Medium'
    })
    expect.soft(code).not.toContain('Bold_Italic')
    expect.soft(code).not.toContain('(--Style)')
    expect.soft(code).toContain('font-normal')
    if (nativeStyle === 'ITALIC') {
      expect(code).toContain('<strong')
      expect(code).toContain('<em')
    } else {
      expect(code).not.toContain('<strong')
      expect(code).not.toContain('<em')
      expect(code).not.toMatch(/class="[^"]*\bMedium\b/)
    }

    // The actual emitted utility classes control the browser, including inherited defaults.
    const style = document.createElement('style')
    style.textContent =
      '.font-normal{font-weight:400}.font-medium{font-weight:500}.font-bold{font-weight:700}.italic{font-style:italic}.not-italic{font-style:normal}'
    const host = document.createElement('div')
    host.style.cssText = 'font-weight:900;font-style:italic'
    host.innerHTML = code
    document.body.append(style, host)
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const weights: string[] = []
    const styles: string[] = []
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue
      const computed = getComputedStyle(walker.currentNode.parentElement!)
      weights.push(computed.fontWeight)
      styles.push(computed.fontStyle)
    }
    expect.soft(weights).toEqual(['400', String(weight)])
    expect.soft(styles).toEqual(['normal', nativeStyle === 'ITALIC' ? 'italic' : 'normal'])
  }
)
