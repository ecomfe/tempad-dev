import { afterEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_COUNTER_AXIS_SYNC_NAME, CANVAS_KEY_NAMESPACE } from '@/mcp/tools/canvas/identity'
import { handleGetCode } from '@/mcp/tools/code'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { renderTree } from '@/mcp/tools/code/render'
import { sanitizeStyles } from '@/mcp/tools/code/sanitize'
import { processTokens } from '@/mcp/tools/code/tokens/process'
import {
  createTokenConsumerResolver,
  createStyleVarResolver,
  resolveStyleMap
} from '@/mcp/tools/code/tokens/resolve'
import { buildVisibleTree } from '@/mcp/tools/code/tree'
import { serializeVariableValue } from '@/mcp/tools/token/value'
import { stringifyComponent } from '@/utils/component'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

// Native API fixture only: collection, style processing, sanitization and rendering
// are the production modules, with no collaborator mocks.
function node(
  id: string,
  type: SceneNode['type'],
  x: number,
  y: number,
  children: SceneNode[] = [],
  css: Record<string, string> = {}
): SceneNode {
  return {
    id,
    type,
    name: id,
    visible: true,
    x,
    y,
    width: 100,
    height: 40,
    relativeTransform: [
      [1, 0, x],
      [0, 1, y]
    ],
    absoluteBoundingBox: { x, y, width: 100, height: 40 },
    absoluteRenderBounds: { x, y, width: 100, height: 40 },
    children,
    fills: [],
    strokes: [],
    effects: [],
    getCSSAsync: vi.fn(async () => ({ width: '100px', height: '40px', ...css }))
  } as unknown as SceneNode
}

afterEach(() => vi.unstubAllGlobals())

describe('get_code with native opacity bindings', () => {
  function fixture(
    modeId: 'base' | 'opaque',
    options: { alias?: boolean; resolveFailure?: boolean; middleZIndex?: string } = {}
  ) {
    vi.stubGlobal('__DEV__', false)
    const collection = {
      id: 'opacity-modes',
      name: 'Opacity modes',
      defaultModeId: 'base',
      modes: [
        { modeId: 'base', name: 'Default' },
        { modeId: 'opaque', name: 'Opaque' }
      ]
    }
    const resolveForConsumer = vi.fn((consumer: SceneNode) => {
      if (options.resolveFailure) throw new Error('Native consumer resolution unavailable')
      return {
        value: consumer.resolvedVariableModes[collection.id] === 'opaque' ? 100 : 50,
        resolvedType: 'FLOAT'
      }
    })
    const variable = {
      id: 'opacity',
      name: 'Opacity',
      variableCollectionId: collection.id,
      resolvedType: 'FLOAT',
      scopes: ['OPACITY'],
      valuesByMode: { base: 50, opaque: 100 },
      resolveForConsumer
    } as unknown as Variable
    const alias = {
      ...variable,
      id: 'opacity-alias',
      name: 'Opacity alias',
      valuesByMode: {
        base: { type: 'VARIABLE_ALIAS', id: variable.id },
        opaque: { type: 'VARIABLE_ALIAS', id: variable.id }
      }
    } as unknown as Variable
    const variables = new Map([
      [variable.id, variable],
      [alias.id, alias]
    ])
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: {
        getVariableById: (id: string) => variables.get(id) ?? null,
        getVariableCollectionById: (id: string) => (id === collection.id ? collection : null)
      },
      getStyleById: () => null
    })
    const bound = options.alias ? alias : variable
    const token = options.alias ? '--Opacity-alias' : '--Opacity'
    const first = node('first', 'GROUP', 0, 0, [node('red', 'FRAME', 0, 0)], {
      opacity: `var(${token})`
    })
    const middle = node('middle', 'FRAME', 0, 0, [], {
      ...(options.middleZIndex ? { 'z-index': options.middleZIndex } : {})
    })
    const last = node('last', 'GROUP', 50, 0, [node('green', 'FRAME', 50, 0)], {
      opacity: `var(${token})`
    })
    const root = node('root', 'FRAME', 0, 0, [first, middle, last])
    Object.assign(root, { layoutMode: 'NONE' })
    for (const group of [first, last]) {
      Object.assign(group, {
        opacity: modeId === 'opaque' ? 1 : 0.5,
        blendMode: 'PASS_THROUGH',
        boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: bound.id } }
      })
    }
    const attach = (current: SceneNode) => {
      Object.assign(current, { resolvedVariableModes: { [collection.id]: modeId } })
      if ('children' in current) {
        for (const child of current.children) {
          Object.assign(child, { parent: current })
          attach(child)
        }
      }
    }
    attach(root)
    return { root, token, resolveForConsumer }
  }

  it.each(['base', 'opaque'] as const)(
    'keeps natural sibling stacking and complete definitions in %s mode',
    async (mode) => {
      const { root, token } = fixture(mode)
      const unresolved = await handleGetCode([root], 'jsx', false)
      const resolved = await handleGetCode([root], 'jsx', true)

      expect(unresolved.tokens).toEqual({
        [token]: {
          kind: 'number',
          value: { 'Opacity modes:Default': '50', 'Opacity modes:Opaque': '100' }
        }
      })
      expect(resolved.tokens).toEqual(unresolved.tokens)
      expect(unresolved.code).toContain(`opacity-[calc(var(${token})_/_100)]`)
      expect(resolved.code).toContain(`opacity-[${mode === 'opaque' ? 1 : 0.5}]`)
      expect(resolved.code).not.toContain('var(')
      for (const result of [unresolved, resolved]) {
        expect(result.code).not.toContain('-z-[1]')
        expect(result.code).not.toContain('z-[0]')
        const groups = Array.from(result.code.matchAll(/className="([^"]*opacity-[^"]*)"/g))
        expect(groups).toHaveLength(2)
        for (const [, classes] of groups) expect(classes).not.toMatch(/\b(?:isolate|relative)\b/)
        expect(result.warnings).toBeUndefined()
      }
    }
  )

  it('retains opacity alias dependencies through the resolved rerender', async () => {
    const { root, token } = fixture('base', { alias: true })
    const unresolved = await handleGetCode([root], 'jsx', false)
    const resolved = await handleGetCode([root], 'jsx', true)
    expect(unresolved.tokens).toEqual({
      [token]: {
        kind: 'number',
        value: {
          'Opacity modes:Default': '--Opacity',
          'Opacity modes:Opaque': '--Opacity'
        }
      },
      '--Opacity': {
        kind: 'number',
        value: { 'Opacity modes:Default': '50', 'Opacity modes:Opaque': '100' }
      }
    })
    expect(resolved.tokens).toEqual(unresolved.tokens)
    expect(unresolved.code).toContain(`opacity-[calc(var(${token})_/_100)]`)
    expect(resolved.code).toContain('opacity-[0.5]')
    for (const result of [unresolved, resolved]) expect(result.code).not.toContain('-z-[1]')
  })

  it.each([undefined, '7'])(
    'preserves references and diagnostics if resolution fails with authored z-index %s',
    async (middleZIndex) => {
      const { root, token, resolveForConsumer } = fixture('base', {
        resolveFailure: true,
        middleZIndex
      })
      const unresolved = await handleGetCode([root], 'jsx', false)
      const resolved = await handleGetCode([root], 'jsx', true)
      expect(resolveForConsumer).toHaveBeenCalled()
      expect(resolved.tokens).toEqual(unresolved.tokens)
      expect(resolved.code).toContain(`opacity-(${token})`)
      expect(resolved.warnings).toEqual([expect.objectContaining({ type: 'token-resolution' })])
      for (const result of [unresolved, resolved]) {
        if (middleZIndex) expect(result.code).toContain(`z-[${middleZIndex}]`)
        expect(result.code).not.toContain('-z-[1]')
      }
    }
  )
})

describe('real collect to render pipeline', () => {
  it.each([false, true])(
    'preserves interleaved native stacking with reverse=%s',
    async (reverse) => {
      vi.stubGlobal('figma', {
        mixed: Symbol('mixed'),
        variables: { getVariableById: () => null },
        getStyleById: () => null
      })
      const children = ['a', 'b', 'c'].map((id) => node(id, 'FRAME', 0, 0))
      const root = node('root', 'FRAME', 0, 0, children, { display: 'flex' })
      Object.assign(root, { layoutMode: 'HORIZONTAL', itemReverseZIndex: reverse })
      for (const child of children)
        Object.assign(child, {
          parent: root,
          layoutPositioning: child.id === 'b' ? 'ABSOLUTE' : 'AUTO'
        })
      const config = { cssUnit: 'px', scale: 1, rootFontSize: 16 } as const
      const tree = buildVisibleTree([root])
      const cache = createGetCodeCacheContext()
      const collected = await collectNodeData(tree, config, new Map(), cache)
      sanitizeStyles(tree, collected.styles, new Set(), cache)
      expect(children.map(({ id }) => collected.styles.get(id)?.['z-index'])).toEqual(
        reverse ? ['2', '1', '0'] : ['0', '1', '2']
      )
      expect(collected.styles.get('b')?.position).toBe('absolute')
      expect(collected.styles.get('a')?.position).not.toBe('absolute')
      const rendered = await renderTree('root', tree, {
        ...collected,
        nodes: new Map([...tree.nodes].map(([id, snapshot]) => [id, snapshot.node])),
        layout: new Map(),
        svgs: new Map(),
        config,
        preferredLang: 'jsx'
      })
      if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
      const code = stringifyComponent(rendered, { lang: 'jsx' })
      for (const rank of [0, 1, 2]) expect(code).toContain(`z-[${rank}]`)
      expect(code).toContain('isolate')
    }
  )

  it.each(['HORIZONTAL', 'VERTICAL'] as const)(
    'keeps synchronized native cross-gap mode changes in %s code',
    async (layoutMode) => {
      // Native probe 12/14: both axes change 50→75, although only itemSpacing is bound.
      for (const spacing of [50, 75]) {
        const variable = {
          id: 'gap',
          name: 'recovery-a19f42/Shared measure',
          resolveForConsumer: () => ({ value: spacing, resolvedType: 'FLOAT' })
        } as unknown as Variable
        vi.stubGlobal('figma', {
          mixed: Symbol('mixed'),
          variables: { getVariableById: () => variable },
          getStyleById: () => null
        })
        const root = node('root', 'FRAME', 0, 0, [], {
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: `${spacing}px`
        })
        Object.assign(root, {
          layoutMode,
          layoutWrap: 'WRAP',
          itemSpacing: spacing,
          counterAxisSpacing: spacing,
          boundVariables: { itemSpacing: { id: 'gap' } },
          getSharedPluginData: (namespace: string, key: string) =>
            namespace === CANVAS_KEY_NAMESPACE && key === CANVAS_COUNTER_AXIS_SYNC_NAME
              ? 'true'
              : ''
        })
        const config = { cssUnit: 'px', scale: 1, rootFontSize: 16 } as const
        const tree = buildVisibleTree([root])
        const collected = await collectNodeData(
          tree,
          config,
          new Map(),
          createGetCodeCacheContext()
        )
        const nodes = new Map([['root', root]])
        const token = '--recovery-a19f42-Shared-measure'
        for (const resolveTokens of [false, true]) {
          const styles = resolveTokens
            ? resolveStyleMap(
                collected.styles,
                nodes,
                createStyleVarResolver(
                  new Map([[token, 'gap']]),
                  new Map([['gap', variable]]),
                  config
                )
              )
            : collected.styles
          const component = await renderTree('root', tree, {
            ...collected,
            styles,
            nodes,
            config,
            layout: new Map(),
            svgs: new Map()
          })
          if (!component || typeof component === 'string')
            throw new Error('Expected component tree')
          const code = stringifyComponent(component, { lang: 'jsx' })
          expect(code).toContain(resolveTokens ? `gap-[${spacing}px]` : `gap-(${token})`)
          expect(code).not.toMatch(/gap-[xy]-/)
        }
      }
    }
  )

  it.each([
    ['px', 1, '100px', '50px'],
    ['px', 2, '200px', '100px'],
    ['rem', 1, '6.25rem', '3.125rem'],
    ['rem', 2, '12.5rem', '6.25rem']
  ] as const)(
    'consumes the Opacity token as both opacity and length with %s scale %s',
    async (cssUnit, scale, multiplier, length) => {
      const variable = {
        id: 'o',
        name: 'Opacity',
        scopes: ['ALL_SCOPES'],
        resolvedType: 'FLOAT',
        valuesByMode: { base: 50 },
        resolveForConsumer: () => ({ value: 50, resolvedType: 'FLOAT' })
      } as unknown as Variable
      const cache = new Map([['o', variable]])
      vi.stubGlobal('figma', {
        mixed: Symbol('mixed'),
        variables: { getVariableById: () => variable, getVariableCollectionById: () => null },
        getStyleById: () => null
      })
      const root = node('root', 'FRAME', 0, 0, [], {
        display: 'flex',
        width: 'var(--Opacity)',
        gap: 'var(--Opacity)',
        opacity: 'var(--Opacity)'
      })
      Object.assign(root, {
        layoutMode: 'HORIZONTAL',
        boundVariables: { width: { id: 'o' }, opacity: { id: 'o' }, itemSpacing: { id: 'o' } }
      })
      const config = { cssUnit, scale, rootFontSize: 16 }
      const tree = buildVisibleTree([root])
      const collected = await collectNodeData(tree, config, new Map(), createGetCodeCacheContext())
      const nodes = new Map([['root', root]])
      const ctx = { ...collected, nodes, config, layout: new Map(), svgs: new Map() }
      const rendered = await renderTree('root', tree, ctx)
      if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
      const processed = await processTokens({
        code: stringifyComponent(rendered, { lang: 'jsx' }),
        variableIds: new Set(['o']),
        usedCandidateIds: new Set(),
        variableCache: cache,
        styles: collected.styles,
        textSegments: collected.textSegments,
        svgs: new Map(),
        config
      })
      expect(processed.tokensByCanonical['--Opacity']).toEqual({ kind: 'number', value: '50' })
      for (const resolveTokens of [false, true]) {
        const resolve = resolveTokens
          ? createStyleVarResolver(processed.sourceIndex, cache, config)
          : createTokenConsumerResolver(
              processed.tokensByCanonical,
              processed.sourceIndex,
              undefined
            )
        const component = await renderTree('root', tree, {
          ...ctx,
          styles: resolveStyleMap(collected.styles, nodes, resolve)
        })
        if (!component || typeof component === 'string') throw new Error('Expected component tree')
        const code = stringifyComponent(component, { lang: 'jsx' })
        expect(code).toContain(
          resolveTokens ? 'opacity-[0.5]' : 'opacity-[calc(var(--Opacity)_/_100)]'
        )
        for (const prefix of ['w', 'gap']) {
          expect(code).toContain(
            resolveTokens
              ? `${prefix}-[${length}]`
              : `${prefix}-[calc(var(--Opacity)_*_${multiplier}_/_100)]`
          )
        }
        if (resolveTokens) expect(code).not.toContain('var(')
      }
      expect(processed.tokensByCanonical['--Opacity']?.value).toBe('50')
    }
  )

  it.each([
    ['px', 2, '200px'],
    ['rem', 1, '6.25rem'],
    ['rem', 2, '12.5rem']
  ] as const)(
    'normalizes font-weight in real text runs with %s at scale %s',
    async (cssUnit, scale, denominator) => {
      const variable = {
        id: 'w',
        name: 'Candidate 6e21 / Weight',
        resolveForConsumer: () => ({ value: 600, resolvedType: 'FLOAT' })
      } as unknown as Variable
      vi.stubGlobal('figma', {
        mixed: Symbol('mixed'),
        variables: { getVariableById: () => variable },
        getStyleById: () => null
      })
      const config = { cssUnit, scale, rootFontSize: 16 }
      const token = '--Candidate-6e21---Weight'
      const text = { id: 'text', type: 'TEXT', characters: 'Weight' } as TextNode
      const segment = {
        characters: 'Weight',
        start: 0,
        end: 6,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 16,
        fontWeight: 600,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        fills: [],
        boundVariables: { fontWeight: { id: 'w' } },
        listOptions: { type: 'NONE' }
      } as unknown as StyledTextSegment
      for (const resolveTokens of [false, true]) {
        const source = new Map([[token, 'w']])
        const resolver = resolveTokens
          ? createStyleVarResolver(source, new Map([['w', variable]]), config)
          : createTokenConsumerResolver(
              {
                [token]: {
                  kind: 'number',
                  value: serializeVariableValue(600, 'FLOAT', config, token, undefined, true)!
                }
              },
              source,
              undefined
            )
        const tree = buildVisibleTree([
          Object.assign(node('text', 'TEXT', 0, 0), { characters: 'Weight' })
        ])
        const component = await renderTree('text', tree, {
          config,
          nodes: new Map([['text', text]]),
          styles: new Map(),
          layout: new Map(),
          svgs: new Map(),
          textSegments: new Map([['text', [segment]]]),
          resolveStyleVars: resolver
        })
        if (!component || typeof component === 'string') throw new Error('Expected component tree')
        const code = stringifyComponent(component, { lang: 'jsx' })
        expect(code).toContain(
          resolveTokens
            ? 'font-semibold'
            : `font-[weight:calc(var(${token})_/_${denominator}_*_100)]`
        )
      }
    }
  )

  it.each(['Shared', 'Alias'])(
    'retains synchronized native counter-gap identity for %s',
    async (name) => {
      const variable = {
        id: 'bound',
        name: `Candidate 6e21 / ${name}`,
        resolvedType: 'FLOAT',
        scopes: ['ALL_SCOPES'],
        valuesByMode: { base: 50, alt: 30 },
        resolveForConsumer: () => ({ value: 50, resolvedType: 'FLOAT' })
      } as unknown as Variable
      const base = { ...variable, id: 'base', name: 'Candidate 6e21 / Shared' } as Variable
      if (name === 'Alias') {
        Object.assign(variable, {
          valuesByMode: {
            base: { type: 'VARIABLE_ALIAS', id: 'base' },
            alt: { type: 'VARIABLE_ALIAS', id: 'base' }
          }
        })
      }
      const cache = new Map([
        ['bound', variable],
        ['base', base]
      ])
      vi.stubGlobal('figma', {
        mixed: Symbol('mixed'),
        variables: {
          getVariableById: (id: string) => cache.get(id),
          getVariableCollectionById: () => null
        },
        getStyleById: () => null
      })
      const root = node('root', 'FRAME', 0, 0, [], {
        display: 'flex',
        gap: `var(--Candidate-6e21-${name})`
      })
      Object.assign(root, {
        layoutMode: 'HORIZONTAL',
        boundVariables: { itemSpacing: { id: 'bound' } }
      })
      const config = { cssUnit: 'px', scale: 1, rootFontSize: 16 } as const
      const tree = buildVisibleTree([root])
      const collected = await collectNodeData(tree, config, new Map(), createGetCodeCacheContext())
      const nodes = new Map([['root', root]])
      const ctx = { ...collected, nodes, layout: new Map(), svgs: new Map(), config }
      const rendered = await renderTree('root', tree, ctx)
      if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
      const code = stringifyComponent(rendered, { lang: 'jsx' })
      const processed = await processTokens({
        code,
        variableIds: new Set(['bound']),
        usedCandidateIds: new Set(),
        variableCache: cache,
        styles: collected.styles,
        textSegments: collected.textSegments,
        svgs: new Map(),
        config
      })
      const canonical = `--Candidate-6e21---${name}`
      expect(processed.tokensByCanonical).toHaveProperty(canonical)
      if (name === 'Alias')
        expect(processed.tokensByCanonical[canonical]?.value).toEqual({
          base: '--Candidate-6e21---Shared',
          alt: '--Candidate-6e21---Shared'
        })
      expect(code).not.toContain(`--Candidate-6e21-${name}`)
      expect(collected.styles.get('root')).toMatchObject({
        'row-gap': `var(${canonical})`,
        'column-gap': `var(${canonical})`
      })
      const resolved = await renderTree('root', tree, {
        ...ctx,
        styles: resolveStyleMap(
          collected.styles,
          nodes,
          createStyleVarResolver(processed.sourceIndex, cache, config)
        )
      })
      if (!resolved || typeof resolved === 'string') throw new Error('Expected component tree')
      const resolvedCode = stringifyComponent(resolved, { lang: 'jsx' })
      expect(resolvedCode).toContain('gap-[50px]')
      expect(resolvedCode).not.toContain('var(')
    }
  )

  it.each([
    ['px', 2, '200px', false],
    ['rem', 1, '6.25rem', false],
    ['rem', 2, '12.5rem', false],
    ['px', 2, '200px', true],
    ['rem', 1, '6.25rem', true],
    ['rem', 2, '12.5rem', true]
  ] as const)(
    'normalizes consumer units once with %s at scale %s (denominator %s, resolve %s)',
    async (cssUnit, scale, denominator, resolveTokens) => {
      vi.stubGlobal('figma', {
        mixed: Symbol('mixed'),
        variables: { getVariableById: () => null },
        getStyleById: () => null
      })
      const root = node('root', 'FRAME', 0, 0, [], {
        display: 'flex',
        opacity: 'var(--shared)',
        gap: 'var(--shared)'
      })
      const config = { cssUnit, scale, rootFontSize: 16 }
      const tree = buildVisibleTree([root])
      const collected = await collectNodeData(tree, config, new Map(), createGetCodeCacheContext())
      const nodes = new Map([['root', root]])
      const value = serializeVariableValue(50, 'FLOAT', config, '--shared', undefined, true)!
      const sourceIndex = new Map([['--shared', 'v']])
      const variable = {
        id: 'v',
        name: 'shared',
        resolveForConsumer: () => ({ value: 50, resolvedType: 'FLOAT' })
      } as unknown as Variable
      const resolver = resolveTokens
        ? createStyleVarResolver(sourceIndex, new Map([['v', variable]]), config)
        : createTokenConsumerResolver(
            { '--shared': { kind: 'number', value } },
            sourceIndex,
            undefined
          )
      const rendered = await renderTree('root', tree, {
        ...collected,
        styles: resolveStyleMap(collected.styles, nodes, resolver),
        nodes,
        layout: new Map(),
        svgs: new Map(),
        config,
        preferredLang: 'jsx'
      })
      if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
      const code = stringifyComponent(rendered, { lang: 'jsx' })
      if (resolveTokens) {
        expect(code).toContain('opacity-[0.5]')
        expect(code).toContain(`gap-[${value}]`)
        expect(code).not.toContain('var(--shared)')
      } else {
        expect(code).toContain(`opacity-[calc(var(--shared)_/_${denominator})]`)
        expect(code).toContain('gap-')
        expect(code).toContain('var(--shared)')
      }
      expect(Number.parseFloat(value) / Number.parseFloat(denominator)).toBe(0.5)
    }
  )

  it('positions structural group contents relative to their flow slot and keeps authored wrap order', async () => {
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: { getVariableById: () => null },
      getStyleById: () => null
    })
    const first = node('first', 'FRAME', 30, 20, [], { 'background-color': '#F00' })
    const second = node('second', 'FRAME', 20, 10, [], { 'background-color': '#00F' })
    const group = node('group', 'GROUP', 20, 10, [first, second])
    const root = node('root', 'FRAME', 0, 0, [group], { display: 'flex', 'flex-wrap': 'wrap' })
    Object.assign(root, { layoutMode: 'HORIZONTAL' })
    const config = { cssUnit: 'px', scale: 1, rootFontSize: 16 } as const
    const tree = buildVisibleTree([root])
    tree.nodes.get('first')!.dataHint = { 'data-hint-id': 'first' }
    tree.nodes.get('second')!.dataHint = { 'data-hint-id': 'second' }
    const cache = createGetCodeCacheContext()
    const collected = await collectNodeData(tree, config, new Map(), cache)
    sanitizeStyles(tree, collected.styles, new Set(), cache)
    expect(collected.styles.get('group')).toMatchObject({ position: 'relative' })
    expect(collected.styles.get('first')).toMatchObject({
      position: 'absolute',
      left: '10px',
      top: '10px'
    })
    const rendered = await renderTree('root', tree, {
      ...collected,
      nodes: new Map([...tree.nodes].map(([id, snapshot]) => [id, snapshot.node])),
      layout: new Map(),
      svgs: new Map(),
      config,
      preferredLang: 'jsx'
    })
    if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
    const code = stringifyComponent(rendered, { lang: 'jsx' })
    expect(code).toContain('absolute')
    expect(code).toContain('data-hint-id="first"')
    expect(code.indexOf('data-hint-id="first"')).toBeLessThan(code.indexOf('data-hint-id="second"'))
    for (const fixture of [root, group, first, second])
      expect(fixture.getCSSAsync).toHaveBeenCalledOnce()
  })
})
