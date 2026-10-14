import { describe, expect, it } from 'vitest'

import { createFontLoadingFixture } from './font-loading'

const REGULAR = { family: 'Noto Serif', style: 'Regular' }
const BOLD = { family: 'Noto Serif', style: 'Bold' }

describe('font-loading fixture', () => {
  it('requires each intermediate font even when the final face is already loaded', async () => {
    const fonts = createFontLoadingFixture()
    await fonts.loadFontAsync(BOLD)

    expect(() => fonts.requireLoadedFont(REGULAR)).toThrow('Noto Serif/Regular is not loaded')
    expect(() => fonts.requireLoadedFont(BOLD)).not.toThrow()

    await fonts.loadFontAsync(REGULAR)
    expect(() => fonts.requireLoadedFont(REGULAR)).not.toThrow()
  })

  it('keeps a pending font unavailable until its load completes', async () => {
    const pending = Promise.withResolvers<void>()
    const fonts = createFontLoadingFixture(() => pending.promise)
    const loading = fonts.loadFontAsync(REGULAR)

    expect(() => fonts.requireLoadedFont(REGULAR)).toThrow('Noto Serif/Regular is not loaded')
    pending.resolve()
    await loading
    expect(() => fonts.requireLoadedFont(REGULAR)).not.toThrow()
  })

  it('keeps a failed font unavailable until a successful retry', async () => {
    let fail = true
    const failure = new Error('Font unavailable')
    const fonts = createFontLoadingFixture(async () => {
      if (fail) throw failure
    })

    await expect(fonts.loadFontAsync(REGULAR)).rejects.toBe(failure)
    expect(() => fonts.requireLoadedFont(REGULAR)).toThrow('Noto Serif/Regular is not loaded')
    fail = false
    await fonts.loadFontAsync(REGULAR)
    expect(() => fonts.requireLoadedFont(REGULAR)).not.toThrow()
  })
})
