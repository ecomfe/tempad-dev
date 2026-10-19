import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTokenDiagnostics } from '@/mcp/tools/code/tokens/diagnostics'
import {
  createTokenConsumerResolver,
  createStyleVarResolver,
  resolveStyleMap
} from '@/mcp/tools/code/tokens/resolve'
import { createTokenReadContext } from '@/mcp/tools/token/context'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn(async (refs: { code: string }[]) => refs.map(({ code }) => code))
}))

const config = { cssUnit: 'rem', rootFontSize: 16, scale: 1 } as const
const node = { id: 'consumer' } as SceneNode

function fixture(name: string, value: unknown, resolvedType: Variable['resolvedType'] = 'FLOAT') {
  const variable = {
    id: 'v',
    name,
    resolveForConsumer: vi.fn(() => ({ value, resolvedType }))
  } as unknown as Variable
  const cache = new Map([['v', variable]])
  const context = createTokenReadContext(config, undefined, cache)
  const diagnostics = createTokenDiagnostics()
  const source = new Map([[`--${name}`, 'v']])
  const resolve = createStyleVarResolver(
    source,
    cache,
    config,
    undefined,
    undefined,
    context,
    diagnostics.report
  )
  return { variable, cache, context, diagnostics, source, resolve }
}

afterEach(() => vi.unstubAllGlobals())

describe('consumer token resolution', () => {
  it('uses length consumers instead of the Opacity name heuristic', () => {
    const { resolve } = fixture('Opacity', 50)
    expect(
      resolve({ opacity: 'var(--Opacity)', gap: 'var(--Opacity)', width: 'var(--Opacity)' }, node)
    ).toEqual({
      opacity: '0.5',
      gap: '50px',
      width: '50px'
    })
    const diagnostics = createTokenDiagnostics()
    const unresolved = createTokenConsumerResolver(
      { '--Opacity': { kind: 'number', value: '50' } },
      new Map([['--Opacity', 'v']]),
      undefined,
      diagnostics.report
    )
    expect(
      unresolved({ opacity: 'var(--Opacity)', gap: 'var(--Opacity)', width: 'var(--Opacity)' })
    ).toEqual({
      opacity: 'calc(var(--Opacity) / 100)',
      gap: 'calc(var(--Opacity) * 100px / 100)',
      width: 'calc(var(--Opacity) * 100px / 100)'
    })
    expect(unresolved({ 'font-weight': 'var(--Opacity)' })).toEqual({
      'font-weight': 'var(--Opacity)'
    })
    expect(diagnostics.warnings()).toEqual([])
  })

  it.each([
    [50, '0.5', '50px'],
    [0.5, '0.005', '0.5px'],
    [0, '0', '0px'],
    [100, '1', '100px']
  ])(
    'normalizes native opacity %s without changing the same token used as length',
    (value, opacity, gap) => {
      const { resolve } = fixture('shared', value)
      expect(resolve({ opacity: 'var(--shared)', gap: 'var(--shared)' }, node)).toEqual({
        opacity,
        gap
      })
    }
  )

  it('retains canonical token identity while normalizing opacity through dimensional aliases', () => {
    const tokens = {
      '--plugin-shared': { kind: 'number' as const, value: { Light: '--base', Dark: '0rem' } },
      '--base': { kind: 'number' as const, value: '3.125rem' }
    }
    const resolve = createTokenConsumerResolver(
      tokens,
      new Map([['--shared', 'v']]),
      new Map([['--shared', '--plugin-shared']])
    )
    const style = { opacity: 'var(--shared)', gap: 'var(--shared)' }
    const normalized = resolve(style, node)
    expect(normalized).toEqual({ opacity: 'calc(var(--shared) / 100px)', gap: 'var(--shared)' })
    expect(resolve(normalized, node)).toBe(normalized)
    expect(tokens['--base'].value).toBe('3.125rem')
  })

  it('normalizes numeric opacity tokens with a unitless denominator', () => {
    const resolve = createTokenConsumerResolver(
      { '--alpha': { kind: 'number', value: { Light: '50', Dark: '0' } } },
      new Map([['--alpha', 'v']]),
      undefined
    )
    expect(resolve({ opacity: 'var(--alpha)' }, node)).toEqual({
      opacity: 'calc(var(--alpha) / 100)'
    })
  })

  it.each(['opacity', 'font-weight'])(
    'reports a deduplicated compatibility warning for %s using typed length division',
    (property) => {
      const diagnostics = createTokenDiagnostics()
      const resolve = createTokenConsumerResolver(
        {
          '--canonical': { kind: 'number', value: '--length' },
          '--length': { kind: 'number', value: { Light: '50px', Dark: '0px' } }
        },
        new Map([['--source', 'v']]),
        new Map([['--source', '--canonical']]),
        diagnostics.report
      )
      const style = { [property]: 'var(--source)' }
      expect(resolve(style)[property]).toBe(
        `calc(var(--source) / 100px${property === 'font-weight' ? ' * 100' : ''})`
      )
      resolve(style)
      const warnings = diagnostics.warnings()
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.type).toBe('token-resolution')
      expect(warnings[0]?.message).toContain(`${property} for --canonical`)
      expect(warnings[0]?.message.match(/requires CSS typed arithmetic support/g)).toHaveLength(1)
      expect(warnings[0]?.message).toContain('Use resolveTokens:true for portable literal output.')
    }
  )

  it('keeps numeric font weights unchanged and normalizes shared length aliases only at consumption', () => {
    const resolve = createTokenConsumerResolver(
      {
        '--weight': { kind: 'number', value: '600' },
        '--alias': { kind: 'number', value: '--length' },
        '--length': { kind: 'number', value: { Light: '400px', Dark: '600px' } }
      },
      new Map([
        ['--weight', 'w'],
        ['--alias', 'a']
      ]),
      undefined
    )
    const numeric = { 'font-weight': 'var(--weight)' }
    expect(resolve(numeric)).toBe(numeric)
    expect(resolve({ 'font-weight': 'var(--alias)', gap: 'var(--alias)' })).toEqual({
      'font-weight': 'calc(var(--alias) / 100px * 100)',
      gap: 'var(--alias)'
    })
  })

  it.each([
    { Light: '50', Dark: '50px' },
    { Light: '--missing', Dark: '50px' },
    { Light: '--alpha', Dark: '50px' }
  ])('diagnoses opacity normalization that cannot preserve all modes: %s', (value) => {
    const diagnostics = createTokenDiagnostics()
    const resolve = createTokenConsumerResolver(
      { '--alpha': { kind: 'number', value } },
      new Map([['--alpha', 'v']]),
      undefined,
      diagnostics.report
    )
    const style = { opacity: 'var(--alpha)' }
    expect(resolve(style, node)).toBe(style)
    expect(diagnostics.warnings()[0]?.message).toContain('opacity unit normalization')
  })

  it('uses the consuming property for unitless typography regardless of token name', () => {
    const { resolve } = fixture('typography-weight-bold', 700)
    expect(
      resolve(
        { 'font-weight': 'var(--typography-weight-bold)', width: 'var(--typography-weight-bold)' },
        node
      )
    ).toEqual({ 'font-weight': '700', width: '700px' })
  })

  it('resolves each native consumer once and preserves units across repeated properties', () => {
    const { resolve, variable } = fixture('spacing', 32)
    expect(resolve({ width: 'var(--spacing)', height: 'var(--spacing)' }, node)).toEqual({
      width: '32px',
      height: '32px'
    })
    expect(variable.resolveForConsumer).toHaveBeenCalledExactlyOnceWith(node)
  })

  it.each([
    ['opacity', 0.5, 'FLOAT', '0.5'],
    ['font-weight-body', 600, 'FLOAT', '600'],
    ['z-index-overlay', 3, 'FLOAT', '3'],
    ['label', 'Label', 'STRING', 'Label'],
    ['enabled', false, 'BOOLEAN', 'false'],
    ['color', { r: 1, g: 0, b: 0, a: 1 }, 'COLOR', '#F00']
  ] as const)('serializes %s using the source token identity', (name, value, type, expected) => {
    const { resolve } = fixture(name, value, type)
    expect(resolve({ value: `var(--${name})` }, node).value).toBe(expected)
  })

  it('shares native reads while leaving each renderer to convert units', () => {
    const { resolve, source, cache, context, variable } = fixture('spacing', 32)
    const other = createStyleVarResolver(
      source,
      cache,
      { ...config, cssUnit: 'px' },
      undefined,
      undefined,
      context
    )
    expect(resolve({ width: 'var(--spacing)' }, node).width).toBe('32px')
    expect(other({ width: 'var(--spacing)' }, node).width).toBe('32px')
    expect(variable.resolveForConsumer).toHaveBeenCalledTimes(1)
    resolve({ width: 'var(--spacing)' }, { id: 'other' } as SceneNode)
    expect(variable.resolveForConsumer).toHaveBeenCalledTimes(2)
  })

  it('rereads values in a new request and reports cached failures in each root', () => {
    const { resolve, variable, source, cache, context } = fixture('spacing', 32)
    vi.mocked(variable.resolveForConsumer).mockImplementationOnce(() => {
      throw Error('unavailable')
    })
    const style = { width: 'var(--spacing)' }
    expect(resolve(style, node)).toBe(style)
    const diagnostics = createTokenDiagnostics()
    const second = createStyleVarResolver(
      source,
      cache,
      config,
      undefined,
      undefined,
      context,
      diagnostics.report
    )
    expect(second(style, node)).toBe(style)
    expect(variable.resolveForConsumer).toHaveBeenCalledTimes(1)
    expect(diagnostics.warnings()).toEqual([expect.objectContaining({ type: 'token-resolution' })])
    const fresh = createStyleVarResolver(source, cache, config)
    expect(fresh(style, node).width).toBe('32px')
    expect(variable.resolveForConsumer).toHaveBeenCalledTimes(2)
  })

  it('preserves unresolved references and warns without choosing a collection default', () => {
    const { resolve, variable, diagnostics } = fixture('spacing', 32)
    vi.mocked(variable.resolveForConsumer).mockImplementation(() => {
      throw Error('mode unavailable')
    })
    const style = { width: 'var(--spacing)', height: 'var(--spacing)', color: 'var(--app-only)' }
    expect(resolve(style, node)).toBe(style)
    expect(diagnostics.warnings()).toHaveLength(1)
    expect(diagnostics.warnings()[0]?.message).toContain('node consumer')
  })

  it('does not resolve without a consumer, or when filters exclude a value', () => {
    const { source, cache, context, variable, diagnostics, resolve } = fixture('spacing', 32)
    const style = { width: 'var(--spacing)' }
    expect(resolve(style)).toBe(style)
    expect(diagnostics.warnings()[0]?.type).toBe('token-resolution')
    const filtered = createStyleVarResolver(
      source,
      cache,
      config,
      new Set(['allowed']),
      (value) => value.includes('color'),
      context
    )
    expect(filtered(style, node)).toBe(style)
    expect(filtered(style, { id: 'allowed' } as SceneNode)).toBe(style)
    expect(filtered({}, node)).toEqual({})
    expect(variable.resolveForConsumer).not.toHaveBeenCalled()
  })

  it('handles missing variables and mixed literal/token styles without losing properties', () => {
    const { resolve, cache, diagnostics } = fixture('spacing', 32)
    const style = { width: 'calc(100% - var(--spacing))', color: 'red', empty: '' }
    expect(resolve(style, node)).toEqual({ ...style, width: 'calc(100% - 32px)' })
    cache.set('v', null as unknown as Variable)
    const next = { id: 'next' } as SceneNode
    expect(resolve(style, next)).toBe(style)
    expect(diagnostics.warnings()[0]?.type).toBe('token-resolution')
  })

  it('passes exact consumer nodes through style-map and text/SVG resolver calls', () => {
    const { resolve, variable } = fixture('spacing', 16)
    const text = { id: 'text' } as SceneNode
    const svg = { id: 'svg' } as SceneNode
    const styles = new Map([['consumer', { width: 'var(--spacing)' }]])
    expect(
      resolveStyleMap(styles, new Map([['consumer', node]]), resolve).get('consumer')?.width
    ).toBe('16px')
    expect(resolve({ fontSize: 'var(--spacing)' }, text).fontSize).toBe('16px')
    expect(resolve({ strokeWidth: 'var(--spacing)' }, svg).strokeWidth).toBe('16px')
    expect(vi.mocked(variable.resolveForConsumer).mock.calls.map(([consumer]) => consumer)).toEqual(
      [node, text, svg]
    )
  })
})
