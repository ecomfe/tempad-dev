import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture } from './figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Figma text-range fixture', () => {
  it('includes untouched text and clips requested segments without losing mixed range state', () => {
    const text = createFixture().createNode('TEXT') as TextNode
    text.characters = 'ABCDEF'
    const bold = { family: 'Inter', style: 'Bold' }
    const regular = { family: 'Inter', style: 'Regular' }
    text.setRangeFontName(0, 2, bold)
    expect(text.getStyledTextSegments(['fontName'])).toEqual([
      { start: 0, end: 2, characters: 'AB', fontName: bold },
      { start: 2, end: 6, characters: 'CDEF', fontName: regular }
    ])
    expect(text.getStyledTextSegments(['fontName'], 1, 5)).toEqual([
      { start: 1, end: 2, characters: 'B', fontName: bold },
      { start: 2, end: 5, characters: 'CDE', fontName: regular }
    ])
    expect(text.getRangeFontName(0, 6)).toBe(figma.mixed)
    expect(text.getRangeFontName(1, 2)).toEqual(bold)
    expect(text.getRangeFontName(3, 5)).toEqual(regular)
    expect(text.getRangeAllFontNames(0, 6)).toEqual([bold, regular])
    expect(text.getRangeAllFontNames(1, 2)).toEqual([bold])
  })

  it('applies overlapping writes in order and merges by the requested properties', () => {
    const text = createFixture().createNode('TEXT') as TextNode
    text.characters = 'ABCDEF'
    text.setRangeFontSize(0, 4, 20)
    text.setRangeFontSize(2, 6, 30)
    text.setRangeFontSize(1, 3, 20)
    text.setRangeTextDecoration(1, 5, 'UNDERLINE')
    expect(text.getStyledTextSegments(['fontSize'])).toEqual([
      { start: 0, end: 3, characters: 'ABC', fontSize: 20 },
      { start: 3, end: 6, characters: 'DEF', fontSize: 30 }
    ])
    expect(text.getStyledTextSegments(['fontSize', 'textDecoration'])).toEqual([
      { start: 0, end: 1, characters: 'A', fontSize: 20, textDecoration: 'NONE' },
      { start: 1, end: 3, characters: 'BC', fontSize: 20, textDecoration: 'UNDERLINE' },
      { start: 3, end: 5, characters: 'DE', fontSize: 30, textDecoration: 'UNDERLINE' },
      { start: 5, end: 6, characters: 'F', fontSize: 30, textDecoration: 'NONE' }
    ])
    expect(text.getRangeTextDecoration(0, 6)).toBe(figma.mixed)
    expect(text.getRangeFontSize(1, 3)).toBe(20)
  })

  it('reports local unbinding and the remaining node binding consistently', () => {
    const fixture = createFixture()
    const text = fixture.createNode('TEXT') as TextNode
    text.characters = 'ABCDEF'
    const variable = fixture.variables.get('variable:spacing')!
    const alias = { type: 'VARIABLE_ALIAS', id: variable.id }
    text.setBoundVariable('fontSize', variable)
    text.setRangeBoundVariable(0, 2, 'fontSize', null)
    expect(text.getRangeBoundVariable(0, 2, 'fontSize')).toBeNull()
    expect(text.getRangeBoundVariable(0, 6, 'fontSize')).toBe(figma.mixed)
    expect(text.getStyledTextSegments(['boundVariables'])).toEqual([
      { start: 0, end: 2, characters: 'AB', boundVariables: {} },
      { start: 2, end: 6, characters: 'CDEF', boundVariables: { fontSize: alias } }
    ])
  })

  it('clips segments using UTF-16 offsets, including a split surrogate pair', () => {
    const text = createFixture().createNode('TEXT') as TextNode
    text.characters = 'A😀B'
    text.setRangeFontSize(1, 3, 20)
    expect(text.getStyledTextSegments(['fontSize'], 2, 4)).toEqual([
      { start: 2, end: 3, characters: '\uDE00', fontSize: 20 },
      { start: 3, end: 4, characters: 'B', fontSize: 12 }
    ])
  })

  it('keeps distinct variable-font settings while deduplicating repeated faces', () => {
    const text = createFixture().createNode('TEXT') as TextNode
    text.characters = 'ABCDEF'
    const regular = { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } }
    const bold = { ...regular, variationSettings: { wght: 700 } }
    text.setRangeFontName(0, 2, regular)
    text.setRangeFontName(2, 4, bold)
    text.setRangeFontName(4, 6, structuredClone(regular))
    expect(text.getRangeAllFontNames(0, 6)).toEqual([regular, bold])
    expect(text.getRangeAllFontNames(2, 4)).toEqual([bold])
  })
})
