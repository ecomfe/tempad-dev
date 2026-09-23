import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFontState, resolveFamilyFont, resolvePortableFont } from '@/mcp/tools/canvas/fonts'

afterEach(() => vi.unstubAllGlobals())

function available(families: Array<[string, string]>) {
  const fonts = families.map(([family, style]) => ({ fontName: { family, style } }))
  const listAvailableFontsAsync = vi.fn().mockResolvedValue(fonts)
  vi.stubGlobal('figma', { listAvailableFontsAsync })
  return { fonts, listAvailableFontsAsync }
}

describe('canvas font availability', () => {
  it('shares availability across concurrent exact and portable lookups while preserving face order', async () => {
    const { fonts, listAvailableFontsAsync } = available([
      ['Roboto Mono', 'Medium'],
      ['Noto Sans Mono', 'Light'],
      ['Other', 'Regular'],
      ['Noto Sans Mono', 'Medium'],
      ['Noto Sans Mono', 'Regular Italic']
    ])
    const state = createFontState()
    const [exact, portable, italic] = await Promise.all([
      resolveFamilyFont('Noto Sans Mono', 'Regular', state, 400),
      resolvePortableFont('mono', 'Medium', state),
      resolveFamilyFont('Noto Sans Mono', 'Regular Italic', state)
    ])
    expect(exact).toBe(fonts[1]!.fontName)
    expect(portable).toBe(fonts[3]!.fontName)
    expect(italic).toBe(fonts[4]!.fontName)
    expect(listAvailableFontsAsync).toHaveBeenCalledOnce()

    await resolveFamilyFont('Other', 'Regular', createFontState())
    expect(listAvailableFontsAsync).toHaveBeenCalledTimes(2)
  })

  it('does not normalize exact family names or invent a portable fallback', async () => {
    available([['Inter', 'Regular']])
    const state = createFontState()
    await expect(resolveFamilyFont('inter', 'Regular', state)).rejects.toThrow(
      'Font family "inter" is unavailable.'
    )
    await expect(resolvePortableFont('serif', 'Regular', state)).rejects.toThrow(
      'No portable serif font is available in the current Figma context'
    )
  })

  it('retains rejected availability within one apply with lookup-specific diagnostics', async () => {
    const { listAvailableFontsAsync } = available([])
    const error = new Error('Availability failed')
    listAvailableFontsAsync.mockRejectedValue(error)
    const state = createFontState()
    await expect(resolveFamilyFont('Inter', 'Regular', state)).rejects.toBe(error)
    await expect(resolvePortableFont('sans', 'Regular', state)).rejects.toThrow(
      'Available Figma fonts could not be listed for a portable font utility.'
    )
    expect(listAvailableFontsAsync).toHaveBeenCalledOnce()
  })

  it('preserves synchronous availability failure and permits another attempt', async () => {
    const { listAvailableFontsAsync } = available([['Inter', 'Regular']])
    const error = new Error('Not connected')
    listAvailableFontsAsync.mockImplementationOnce(() => {
      throw error
    })
    const state = createFontState()
    await expect(resolvePortableFont('sans', 'Regular', state)).rejects.toBe(error)
    await expect(resolveFamilyFont('Inter', 'Regular', state)).resolves.toEqual({
      family: 'Inter',
      style: 'Regular'
    })
    expect(listAvailableFontsAsync).toHaveBeenCalledTimes(2)
  })

  it('reads family identities once per availability snapshot, including repeated lookups', async () => {
    const { fonts } = available(
      Array.from({ length: 1000 }, (_, index) => [`Family ${index}`, 'Regular'])
    )
    const reads = fonts.map(({ fontName }) => {
      const family = fontName.family
      const read = vi.fn(() => family)
      Object.defineProperty(fontName, 'family', { get: read })
      return read
    })
    const state = createFontState()
    for (let index = 0; index < 10; index += 1) {
      await resolveFamilyFont(`Family ${index}`, 'Regular', state)
    }
    for (const read of reads) expect(read).toHaveBeenCalledOnce()
  })
})
