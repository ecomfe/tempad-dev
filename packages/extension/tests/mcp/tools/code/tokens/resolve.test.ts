import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTokenDiagnostics } from '@/mcp/tools/code/tokens/diagnostics'
import { createStyleVarResolver, resolveStyleMap } from '@/mcp/tools/code/tokens/resolve'
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
  it('resolves each native consumer once and preserves units across repeated properties', () => {
    const { resolve, variable } = fixture('spacing', 32)
    expect(resolve({ width: 'var(--spacing)', height: 'var(--spacing)' }, node)).toEqual({
      width: '2rem',
      height: '2rem'
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

  it('shares raw reads between overlapping roots without sharing serialization', () => {
    const { resolve, source, cache, context, variable } = fixture('spacing', 32)
    const other = createStyleVarResolver(
      source,
      cache,
      { ...config, cssUnit: 'px' },
      undefined,
      undefined,
      context
    )
    expect(resolve({ width: 'var(--spacing)' }, node).width).toBe('2rem')
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
    expect(fresh(style, node).width).toBe('2rem')
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
    expect(resolve(style, node)).toEqual({ ...style, width: 'calc(100% - 2rem)' })
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
    ).toBe('1rem')
    expect(resolve({ fontSize: 'var(--spacing)' }, text).fontSize).toBe('1rem')
    expect(resolve({ strokeWidth: 'var(--spacing)' }, svg).strokeWidth).toBe('1rem')
    expect(vi.mocked(variable.resolveForConsumer).mock.calls.map(([consumer]) => consumer)).toEqual(
      [node, text, svg]
    )
  })
})
