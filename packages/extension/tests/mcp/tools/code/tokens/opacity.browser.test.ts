import { describe, expect, it } from 'vitest'

import {
  createStyleVarResolver,
  createTokenConsumerResolver
} from '@/mcp/tools/code/tokens/resolve'
import { serializeVariableValue } from '@/mcp/tools/token/value'
import { normalizeStyleValues } from '@/utils/css'

describe('native unitless consumer token CSS units', () => {
  it.each([
    { cssUnit: 'px', rootFontSize: 16, scale: 1 },
    { cssUnit: 'px', rootFontSize: 16, scale: 2 },
    { cssUnit: 'rem', rootFontSize: 16, scale: 1 },
    { cssUnit: 'rem', rootFontSize: 16, scale: 2 }
  ] as const)('keeps shared length tokens usable in opacity and gap: %s', (config) => {
    const element = document.createElement('div')
    const originalFontSize = document.documentElement.style.fontSize
    document.documentElement.style.fontSize = `${config.rootFontSize}px`
    document.body.append(element)
    try {
      const light = serializeVariableValue(50, 'FLOAT', config, '--shared', undefined, true)!
      const dark = serializeVariableValue(0, 'FLOAT', config, '--shared', undefined, true)!
      const weight = serializeVariableValue(600, 'FLOAT', config, '--weight', undefined, true)!
      const resolver = createTokenConsumerResolver(
        {
          '--shared': { kind: 'number', value: { Light: light, Dark: dark } },
          '--weight': { kind: 'number', value: weight }
        },
        new Map([
          ['--shared', 'v'],
          ['--weight', 'w']
        ]),
        undefined
      )
      const normalized = normalizeStyleValues(
        resolver({
          opacity: 'var(--shared)',
          gap: 'var(--shared)',
          'font-weight': 'var(--weight)'
        }),
        config
      )
      element.style.opacity = normalized.opacity!
      element.style.gap = normalized.gap!
      element.style.fontWeight = normalized['font-weight']!
      element.style.setProperty('--weight', weight)
      expect(getComputedStyle(element).fontWeight).toBe('600')
      element.style.setProperty('--shared', light)
      expect(getComputedStyle(element).opacity).toBe('0.5')
      expect(getComputedStyle(element).gap).toBe(`${50 * config.scale}px`)
      element.style.setProperty('--shared', dark)
      expect(getComputedStyle(element).opacity).toBe('0')
      expect(getComputedStyle(element).gap).toBe('0px')

      const sharedNumber = serializeVariableValue(
        50,
        'FLOAT',
        config,
        '--Opacity',
        undefined,
        true
      )!
      expect(sharedNumber).toBe('50')
      const tokens = { '--Opacity': { kind: 'number' as const, value: sharedNumber } }
      const source = new Map([['--Opacity', 'o']])
      const consumer = { id: 'consumer' } as SceneNode
      const variable = {
        id: 'o',
        name: 'Opacity',
        scopes: ['ALL_SCOPES'],
        resolveForConsumer: () => ({ value: 50, resolvedType: 'FLOAT' })
      } as unknown as Variable
      for (const resolveTokens of [false, true]) {
        const resolve = resolveTokens
          ? createStyleVarResolver(source, new Map([['o', variable]]), config)
          : createTokenConsumerResolver(tokens, source, undefined)
        const consumed = normalizeStyleValues(
          resolve(
            {
              opacity: 'var(--Opacity)',
              gap: 'var(--Opacity)',
              width: 'var(--Opacity)'
            },
            consumer
          ),
          config
        )
        element.style.setProperty('--Opacity', sharedNumber)
        element.style.opacity = consumed.opacity!
        element.style.gap = consumed.gap!
        element.style.width = consumed.width!
        expect(getComputedStyle(element).opacity).toBe('0.5')
        expect(getComputedStyle(element).gap).toBe(`${50 * config.scale}px`)
        expect(getComputedStyle(element).width).toBe(`${50 * config.scale}px`)
      }
      expect(tokens['--Opacity'].value).toBe('50')
    } finally {
      element.remove()
      document.documentElement.style.fontSize = originalFontSize
    }
  })

  it('normalizes unitless alias values without replacing their canonical reference', () => {
    const element = document.createElement('div')
    document.body.append(element)
    try {
      const resolve = createTokenConsumerResolver(
        {
          '--alpha': { kind: 'number', value: '--base' },
          '--base': { kind: 'number', value: '50' }
        },
        new Map([['--alpha', 'v']]),
        undefined
      )
      element.style.opacity = resolve({ opacity: 'var(--alpha)' }).opacity!
      element.style.setProperty('--alpha', 'var(--base)')
      element.style.setProperty('--base', '50')
      expect(getComputedStyle(element).opacity).toBe('0.5')
      element.style.setProperty('--base', '0.5')
      expect(getComputedStyle(element).opacity).toBe('0.005')
    } finally {
      element.remove()
    }
  })
})
