import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getVariableByIdCached } from '@/mcp/tools/token/cache'
import { collectCandidateVariableIds } from '@/mcp/tools/token/candidates'
import { getVariableRawName } from '@/mcp/tools/token/indexer'
import { logger } from '@/utils/log'

vi.mock('@/utils/css', () => ({
  canonicalizeVarName: vi.fn((value: string) => (value.startsWith('var(') ? '--syntax' : null)),
  normalizeFigmaVarName: vi.fn((value: string) => {
    const normalized = value.trim().replace(/\s+/g, '-').toLowerCase()
    return normalized ? `--${normalized}` : '--unnamed'
  }),
  toFigmaVarExpr: vi.fn((value: string) => {
    const normalized = value.trim().replace(/\s+/g, '-').toLowerCase()
    return normalized ? `var(--${normalized})` : ''
  })
}))

vi.mock('@/utils/log', () => ({
  logger: {
    debug: vi.fn()
  }
}))

vi.mock('@/mcp/tools/token/cache', () => ({
  getVariableByIdCached: vi.fn()
}))

vi.mock('@/mcp/tools/token/indexer', () => ({
  getVariableRawName: vi.fn()
}))

function createNode(input: Record<string, unknown>): SceneNode {
  return input as unknown as SceneNode
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  delete (globalThis as { figma?: PluginAPI }).figma
})

describe('token/candidates collectCandidateVariableIds', () => {
  it('collects candidate ids from node vars, paints, style paints and children', () => {
    const root = createNode({
      id: 'root',
      visible: true,
      fillStyleId: 'style-1',
      boundVariables: {
        color: { id: 'id-bound' },
        nested: [{ id: 'id-array' }]
      },
      fills: [
        {
          type: 'SOLID',
          visible: true,
          boundVariables: { color: { id: 'id-fill' } },
          variableReferences: { color: { id: 'id-fill-ref' } }
        },
        {
          type: 'SOLID',
          visible: false,
          boundVariables: { color: { id: 'id-fill-hidden' } }
        }
      ],
      strokes: [
        {
          type: 'SOLID',
          visible: true,
          boundVariables: { color: { id: 'id-stroke' } },
          variableReferences: { color: { id: 'id-stroke-ref' } }
        }
      ],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          boundVariables: { radius: { id: 'id-effect' } },
          variableReferences: { color: { id: 'id-effect-ref' } }
        }
      ],
      children: [
        createNode({
          id: 'child-visible',
          visible: true,
          boundVariables: { size: { id: 'id-child' } }
        }),
        createNode({
          id: 'child-hidden',
          visible: false,
          boundVariables: { size: { id: 'id-hidden-child' } }
        })
      ]
    })

    ;(globalThis as { figma?: PluginAPI }).figma = {
      getStyleById: vi.fn(() => ({
        paints: [
          {
            type: 'SOLID',
            visible: true,
            boundVariables: { color: { id: 'id-style-fill' } }
          },
          {
            type: 'SOLID',
            visible: false,
            boundVariables: { color: { id: 'id-style-hidden' } }
          }
        ]
      }))
    } as unknown as PluginAPI

    const vars: Record<string, Variable | null> = {
      'id-bound': {
        id: 'id-bound',
        name: 'Primary Color',
        codeSyntax: { WEB: 'var(--brand)' }
      } as unknown as Variable,
      'id-array': {
        id: 'id-array',
        name: 'Primary Color',
        codeSyntax: { WEB: '$spacing lg' }
      } as unknown as Variable,
      'id-fill': { id: 'id-fill', name: 'Fill' } as unknown as Variable,
      'id-fill-ref': { id: 'id-fill-ref', name: 'Fill Ref' } as unknown as Variable,
      'id-stroke': { id: 'id-stroke', name: 'Stroke' } as unknown as Variable,
      'id-stroke-ref': { id: 'id-stroke-ref', name: 'Stroke Ref' } as unknown as Variable,
      'id-effect': { id: 'id-effect', name: 'Effect' } as unknown as Variable,
      'id-effect-ref': { id: 'id-effect-ref', name: 'Effect Ref' } as unknown as Variable,
      'id-child': { id: 'id-child', name: 'Child Var' } as unknown as Variable,
      'id-style-fill': { id: 'id-style-fill', name: 'Style Fill' } as unknown as Variable
    }
    vi.mocked(getVariableByIdCached).mockImplementation((id: string) => vars[id] ?? null)
    vi.mocked(getVariableRawName).mockImplementation((variable: Variable) => variable.name)

    const cache = new Map<string, Variable | null>()
    const result = collectCandidateVariableIds([root], cache)

    expect(result.variableIds).toEqual(
      new Set([
        'id-bound',
        'id-array',
        'id-fill',
        'id-fill-ref',
        'id-stroke',
        'id-stroke-ref',
        'id-effect',
        'id-effect-ref',
        'id-child',
        'id-style-fill',
        'id-fill-hidden'
      ])
    )
    expect(result.rewrites.get('var(--brand)')).toEqual({
      canonical: '--primary-color',
      id: 'id-bound'
    })
    expect(result.rewrites.get('var(--primary-color)')).toEqual({
      canonical: '--primary-color',
      id: 'id-bound'
    })
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ids=11 rewrites='))
  })

  it('skips invisible roots and tolerates style lookup failures', () => {
    const hiddenRoot = createNode({
      id: 'hidden-root',
      visible: false,
      boundVariables: { color: { id: 'id-hidden' } }
    })
    const styleErrorNode = createNode({
      id: 'style-error-node',
      visible: true,
      fillStyleId: 'style-error'
    })
    const nonStringStyleIdNode = createNode({
      id: 'non-string-style-id',
      visible: true,
      fillStyleId: 1
    })

    ;(globalThis as { figma?: PluginAPI }).figma = {
      getStyleById: vi.fn(() => {
        throw new Error('style lookup failed')
      })
    } as unknown as PluginAPI

    vi.mocked(getVariableByIdCached).mockReturnValue(null)
    vi.mocked(getVariableRawName).mockImplementation((variable: Variable) => variable.name)

    const result = collectCandidateVariableIds([hiddenRoot, styleErrorNode, nonStringStyleIdNode])
    expect(result.variableIds).toEqual(new Set())
    expect(result.rewrites).toEqual(new Map())
  })

  it('falls back to Date.now when performance is unavailable', () => {
    const performanceOriginal = globalThis.performance
    vi.stubGlobal('performance', undefined)

    const root = createNode({
      id: 'root',
      visible: true,
      boundVariables: { color: { id: 'id-1' } }
    })
    vi.mocked(getVariableByIdCached).mockReturnValue({
      id: 'id-1',
      name: 'Fallback Name'
    } as unknown as Variable)
    vi.mocked(getVariableRawName).mockReturnValue('Fallback Name')

    const result = collectCandidateVariableIds([root])

    expect(result.variableIds).toEqual(new Set(['id-1']))
    expect(result.rewrites.get('var(--fallback-name)')).toEqual({
      canonical: '--fallback-name',
      id: 'id-1'
    })

    if (performanceOriginal) {
      vi.stubGlobal('performance', performanceOriginal)
    } else {
      delete (globalThis as { performance?: Performance }).performance
    }
  })
})
