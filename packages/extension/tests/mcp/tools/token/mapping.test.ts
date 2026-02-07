import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getVariableByIdCached } from '@/mcp/tools/token/cache'
import { collectCandidateVariableIds } from '@/mcp/tools/token/candidates'
import {
  applyPluginTransforms,
  buildVariableMappings,
  normalizeStyleVars
} from '@/mcp/tools/token/mapping'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'

vi.mock('@/mcp/tools/token/candidates', () => ({
  collectCandidateVariableIds: vi.fn()
}))

vi.mock('@/mcp/tools/token/cache', () => ({
  getVariableByIdCached: vi.fn()
}))

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn()
}))

const config = {
  cssUnit: 'rem',
  rootFontSize: 16,
  scale: 2
} as const

describe('token/mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates variable mapping collection to candidate collector', () => {
    const roots = [{ id: 'root' }] as unknown as SceneNode[]
    const cache = new Map<string, Variable | null>()
    const mappings = {
      variableIds: new Set<string>(['var-1']),
      rewrites: new Map<string, { canonical: string; id: string }>([
        ['var(--brand)', { canonical: '--brand', id: 'var-1' }]
      ])
    }
    vi.mocked(collectCandidateVariableIds).mockReturnValue(mappings)

    expect(buildVariableMappings(roots, cache)).toBe(mappings)
    expect(collectCandidateVariableIds).toHaveBeenCalledWith(roots, cache)
  })

  it('returns empty used set when mappings are missing', () => {
    const styles = new Map<string, Record<string, string>>([['node-1', { color: 'brand' }]])

    const used = normalizeStyleVars(
      styles,
      null as unknown as {
        variableIds: Set<string>
        rewrites: Map<string, { canonical: string; id: string }>
      }
    )

    expect(used).toEqual(new Set())
    expect(styles.get('node-1')?.color).toBe('brand')
  })

  it('rewrites direct matches, syntax aliases and raw names with placeholder protection', () => {
    const invalidPlaceholder = `__VAR_${'9'.repeat(400)}__`
    const vars: Record<string, Variable | null> = {
      'id-syntax-first': {
        id: 'id-syntax-first',
        name: 'Syntax First',
        codeSyntax: { WEB: 'DesignToken' }
      } as unknown as Variable,
      'id-syntax-second': {
        id: 'id-syntax-second',
        name: 'Syntax Second',
        codeSyntax: { WEB: 'DesignToken' }
      } as unknown as Variable,
      'id-skip-var': {
        id: 'id-skip-var',
        name: 'Skip Var',
        codeSyntax: { WEB: 'var(--skip)' }
      } as unknown as Variable,
      'id-short': {
        id: 'id-short',
        name: 'Brand Color',
        codeSyntax: { WEB: 'brand-color' }
      } as unknown as Variable,
      'id-long': {
        id: 'id-long',
        name: 'Brand Color Strong',
        codeSyntax: { WEB: 'brand-color-strong' }
      } as unknown as Variable,
      'id-unnamed-syntax': {
        id: 'id-unnamed-syntax',
        codeSyntax: { WEB: '--' }
      } as unknown as Variable,
      'id-unnamed': {
        id: 'id-unnamed'
      } as unknown as Variable
    }
    vi.mocked(getVariableByIdCached).mockImplementation((id: string) => vars[id] ?? null)

    const mappings = {
      variableIds: new Set([
        'id-syntax-first',
        'id-syntax-second',
        'id-skip-var',
        'id-short',
        'id-long',
        'id-unnamed-syntax',
        'id-unnamed',
        'id-missing'
      ]),
      rewrites: new Map<string, { canonical: string; id: string }>([
        ['semantic-token', { canonical: '--semantic-token', id: 'id-rewrite' }]
      ])
    }

    const styles = new Map<string, Record<string, string>>([
      [
        'node-1',
        {
          direct: ' semantic-token ',
          syntax: 'DesignToken',
          replace: `brand-color-strong + brand-color + var(brand-color) + brand-colorful + ${invalidPlaceholder}`,
          malformed: 'var(brand-color',
          untouched: 'none',
          empty: '',
          blank: '   '
        }
      ]
    ])

    const used = normalizeStyleVars(styles, mappings)

    expect(styles.get('node-1')).toEqual({
      direct: 'var(--semantic-token)',
      syntax: 'var(--DesignToken)',
      replace: `var(--brand-color-strong) + var(--brand-color) + var(brand-color) + brand-colorful + ${invalidPlaceholder}`,
      malformed: 'var(brand-color',
      untouched: 'none',
      empty: '',
      blank: '   '
    })
    expect(used).toEqual(new Set<string>(['id-rewrite', 'id-syntax-first', 'id-short', 'id-long']))
  })

  it('short-circuits raw-name replacement when there are no replacement entries', () => {
    vi.mocked(getVariableByIdCached).mockReturnValue(null)

    const styles = new Map<string, Record<string, string>>([
      ['node-2', { color: 'brand-color', blank: '   ' }]
    ])
    const mappings = {
      variableIds: new Set<string>(),
      rewrites: new Map<string, { canonical: string; id: string }>()
    }

    const used = normalizeStyleVars(styles, mappings)

    expect(used).toEqual(new Set())
    expect(styles.get('node-2')).toEqual({ color: 'brand-color', blank: '   ' })
  })

  it('returns markup unchanged when plugin code is absent or markup has no var references', async () => {
    expect(await applyPluginTransforms('color: red;', undefined, config)).toBe('color: red;')
    expect(await applyPluginTransforms('color: red;', 'plugin-code', config)).toBe('color: red;')
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('skips transform batch when markup has no custom property var references', async () => {
    const markup = 'color: var(color); border-color: var(currentColor);'
    expect(await applyPluginTransforms(markup, 'plugin-code', config)).toBe(markup)
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('applies plugin transform results and keeps original var on empty transform output', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['tw-brand', '   '])

    const input =
      'color: var(--brand, #fff); border-color: var(--border); shadow-color: var(color);'
    const output = await applyPluginTransforms(input, 'plugin-code', config)

    expect(output).toBe('color: tw-brand; border-color: var(--border); shadow-color: var(color);')
    expect(runTransformVariableBatch).toHaveBeenCalledWith(
      [
        { code: 'var(--brand, #fff)', name: 'brand', value: '#fff' },
        { code: 'var(--border)', name: 'border', value: undefined }
      ],
      { useRem: true, rootFontSize: 16, scale: 2 },
      'plugin-code'
    )
  })
})
