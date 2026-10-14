import { describe, expect, it } from 'vitest'

import { REWRITE_TARGET_REGEX } from '@/rewrite/rules'

describe('packaged script matching', () => {
  it('matches Figma entrypoints and chunks without intercepting fallback requests', () => {
    const base = 'https://www.figma.com/webpack-artifacts/assets/'
    expect(REWRITE_TARGET_REGEX.test(`${base}figma_app-abc.min.js`)).toBe(true)
    expect(REWRITE_TARGET_REGEX.test(`${base}abc-123.min.js.br`)).toBe(true)
    // Chrome also classifies Worker requests as scripts. Broadening the chunk
    // alphabet can redirect native image workers to the page-only bootstrap.
    expect(REWRITE_TARGET_REGEX.test(`${base}abc_123.min.js`)).toBe(false)
    expect(REWRITE_TARGET_REGEX.test(`${base}image_decoder.min.js`)).toBe(false)
    expect(REWRITE_TARGET_REGEX.test(`${base}abc-123.min.js?fallback`)).toBe(false)
    expect(REWRITE_TARGET_REGEX.test('https://www.figma.com/unrelated.js')).toBe(false)
  })

  it('uses the same case-insensitive matching as Chrome declarative rules', () => {
    expect(
      REWRITE_TARGET_REGEX.test('https://www.figma.com/WEBPACK-ARTIFACTS/ASSETS/ABC.MIN.JS')
    ).toBe(true)
  })
})
