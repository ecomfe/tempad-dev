import { describe, expect, it } from 'vitest'

import { parseCanvasMarkup } from '@/mcp/tools/canvas/markup'
import { normalizePortableFontStyle } from '@/mcp/tools/canvas/tailwind'

describe('Canvas utility lookup boundaries', () => {
  it.each([
    ['w-constructor', 'frame'],
    ['min-w-toString', 'frame'],
    ['rounded-valueOf', 'frame'],
    ['rounded-t-__proto__', 'frame'],
    ['mix-blend-constructor', 'frame'],
    ['text-toString', 'text'],
    ['text-lg/constructor', 'text'],
    ['leading-__proto__', 'text'],
    ['tracking-constructor', 'text'],
    ['constructor', 'text'],
    ['__proto__', 'text'],
    ['toString', 'text']
  ])('rejects inherited dictionary entry %s during markup compilation', (token, kind) => {
    const markup =
      kind === 'text'
        ? `<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="size-fit ${token}">Text</span></div>`
        : `<div data-key="root" class="flex ${token.startsWith('w-') ? '' : 'w-80'} h-80 ${token}"/>`

    expect(() => parseCanvasMarkup({ mode: 'create', markup })).toThrow(/Unsupported.*class/)
  })

  it.each([
    ['Inter', 'constructor'],
    ['__proto__', 'toString'],
    ['constructor', 'name']
  ])('preserves the exact unmapped font identity %s / %s', (family, style) => {
    expect(normalizePortableFontStyle(family, style)).toBe(style)
  })

  it.each([
    ['Inter', 'SemiBold', 'Semi Bold'],
    ['Noto Sans Mono', 'Extra Bold', 'ExtraBold'],
    ['Noto Serif', 'Extra Light', 'ExtraLight']
  ])('still normalizes the declared portable font alias %s / %s', (family, style, expected) => {
    expect(normalizePortableFontStyle(family, style)).toBe(expected)
  })
})

describe('Canvas utility numeric boundaries', () => {
  const finiteValue = `5${'0'.repeat(307)}`
  const infiniteValue = '9'.repeat(309)

  it.each([
    ['scaled width', `w-${finiteValue}`, 'frame'],
    ['scaled line height', `leading-${finiteValue}`, 'text'],
    ['unitless line height', `leading-[${finiteValue}]`, 'text'],
    ['em letter spacing', `tracking-[${finiteValue}em]`, 'text'],
    ['shadow length', `shadow-[${infiniteValue}px_0_0_#000]`, 'frame']
  ])('rejects %s when its normalized native value is not finite', (_label, token, kind) => {
    const markup =
      kind === 'text'
        ? `<div data-key="root" class="flex flex-col w-80 h-80"><span data-key="label" class="size-fit ${token}">Text</span></div>`
        : `<div data-key="root" class="${token.startsWith('w-') ? '' : 'w-80'} h-80 ${token}"/>`

    expect(() => parseCanvasMarkup({ mode: 'create', markup })).toThrow(/Invalid numeric class/)
  })
})
