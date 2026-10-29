import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCodeCheckpoint } from '@/mcp/tools/code/deadline'
import { addVariableModeHints } from '@/mcp/tools/code/tokens/modes'
import { createTokenReadContext } from '@/mcp/tools/token/context'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

vi.mock('@/mcp/transform-variables/requester', () => ({ runTransformVariableBatch: vi.fn() }))

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
const makeVariable = (id: string, collection: string, values: Record<string, unknown>) =>
  ({ id, variableCollectionId: collection, valuesByMode: values }) as unknown as Variable

afterEach(() => vi.restoreAllMocks())

describe('variable mode hints', () => {
  it('preserves an unknown mode ID with a diagnostic', () => {
    const root = createSnapshot({ id: 'root' })
    Object.assign(root.node, { resolvedVariableModes: { theme: 'missing' } })
    const context = createTokenReadContext(
      config,
      undefined,
      new Map([['v', makeVariable('v', 'theme', { missing: 1 })]])
    )
    vi.spyOn(context, 'getCollection').mockReturnValue({
      id: 'theme',
      name: 'Theme',
      modes: [{ modeId: 'm', name: 'Default' }]
    } as VariableCollection)
    const report = vi.fn()

    addVariableModeHints(createTree([root]), new Set(['v']), context, report)

    expect(root.dataHint?.['data-hint-variable-mode']).toBe('Theme=missing')
    expect(report).toHaveBeenCalledWith('token-definition', expect.stringContaining('missing'))
  })

  it.each(['alias-chain', 'mode-map'])(
    'checks native %s reads against the generation deadline',
    (stage) => {
      let elapsed = 0
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
      const checkpoint = createCodeCheckpoint(20)
      const root = createSnapshot({ id: 'root' })
      const context = createTokenReadContext(config)
      const readVariable = vi.spyOn(context, 'getVariable').mockImplementation((id) => {
        if (stage === 'alias-chain') elapsed += 21
        return makeVariable(id, 'theme', { m: { type: 'VARIABLE_ALIAS', id: 'next' } })
      })
      vi.spyOn(context, 'getCollection').mockReturnValue({
        name: 'Theme',
        modes: [{ modeId: 'm', name: 'Default' }]
      } as VariableCollection)
      Object.defineProperty(root.node, 'resolvedVariableModes', {
        get() {
          elapsed += 21
          return { theme: 'm' }
        }
      })

      expect(() =>
        addVariableModeHints(createTree([root]), new Set(['v']), context, vi.fn(), checkpoint)
      ).toThrow('timed out')
      expect(readVariable).toHaveBeenCalledTimes(stage === 'alias-chain' ? 1 : 2)
      expect(root.dataHint?.['data-hint-variable-mode']).toBeUndefined()
    }
  )

  it('includes inherited modes at the export root and only explicit changes below it', () => {
    const root = createSnapshot({ id: 'root', children: ['child', 'inherited'] })
    const child = createSnapshot({ id: 'child', parentId: 'root' })
    const inherited = createSnapshot({ id: 'inherited', parentId: 'root' })
    Object.assign(root.node, {
      explicitVariableModes: {},
      resolvedVariableModes: { semantic: 'only', palette: 'dark', unrelated: 'other' }
    })
    Object.assign(child.node, {
      explicitVariableModes: { palette: 'light' },
      resolvedVariableModes: { palette: 'light', semantic: 'only' }
    })
    Object.assign(inherited.node, {
      explicitVariableModes: {},
      resolvedVariableModes: { palette: 'dark' }
    })
    const context = createTokenReadContext(
      config,
      undefined,
      new Map([
        [
          'semantic',
          makeVariable('semantic', 'semantic', { only: { type: 'VARIABLE_ALIAS', id: 'palette' } })
        ],
        ['palette', makeVariable('palette', 'palette', { light: 'LIGHT', dark: 'DARK' })]
      ])
    )
    const collection = vi.spyOn(context, 'getCollection').mockImplementation(
      (id) =>
        ({
          id,
          name: id === 'palette' ? 'Palette' : 'Semantic',
          modes:
            id === 'palette'
              ? [
                  { modeId: 'light', name: 'Light' },
                  { modeId: 'dark', name: 'Dark' }
                ]
              : [{ modeId: 'only', name: 'Default' }]
        }) as VariableCollection
    )
    const report = vi.fn()
    addVariableModeHints(
      createTree([root, child, inherited]),
      new Set(['semantic']),
      context,
      report
    )
    expect(root.dataHint?.['data-hint-variable-mode']).toBe('Palette=Dark;Semantic=Default')
    expect(child.dataHint?.['data-hint-variable-mode']).toBe('Palette=Light')
    expect(inherited.dataHint?.['data-hint-variable-mode']).toBeUndefined()
    expect(collection).toHaveBeenCalledTimes(2)
    expect(report).not.toHaveBeenCalled()
  })

  it('uses collection IDs for duplicate names and reports missing definitions', () => {
    const root = createSnapshot({ id: 'root' })
    Object.assign(root.node, { resolvedVariableModes: { a: 'm', b: 'm', missing: 'm' } })
    const context = createTokenReadContext(
      config,
      undefined,
      new Map(['a', 'b', 'missing'].map((id) => [id, makeVariable(id, id, { m: 1 })]))
    )
    vi.spyOn(context, 'getCollection').mockImplementation((id) =>
      id === 'missing'
        ? null
        : ({
            id,
            name: 'Theme',
            modes: [{ modeId: 'm', name: 'Default' }]
          } as VariableCollection)
    )
    const report = vi.fn()
    addVariableModeHints(createTree([root]), new Set(['a', 'b', 'missing']), context, report)
    expect(root.dataHint?.['data-hint-variable-mode']).toBe('a=Default;b=Default;missing=m')
    expect(report).toHaveBeenCalledWith(
      'token-definition',
      expect.stringContaining('Duplicate collection')
    )
    expect(report).toHaveBeenCalledWith('token-definition', expect.stringContaining('missing'))
  })
})
