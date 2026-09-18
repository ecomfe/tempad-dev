import type { CanvasNodeSpec } from './model'

import { retryAfterFigmaConnectionTimeout } from '../../figma-readiness'
import { specError } from './errors'

export type CanvasFontState = {
  availableFonts?: Promise<Font[]>
  fontLoads: Map<string, Promise<void>>
}

export function createFontState(): CanvasFontState {
  return { fontLoads: new Map() }
}

export function loadFont(font: FontName, state: CanvasFontState): Promise<void> {
  const key = `${font.family}\0${font.style}`
  const pending = state.fontLoads.get(key)
  if (pending) return pending
  const load = Promise.resolve()
    .then(() => figma.loadFontAsync(font))
    .catch((error) => retryAfterFigmaConnectionTimeout(() => figma.loadFontAsync(font), error))
    .catch(() =>
      specError(`Font "${font.family} ${font.style}" is unavailable in the current Figma context.`)
    )
  state.fontLoads.set(key, load)
  return load
}

export async function loadFonts(fonts: Iterable<FontName>, state: CanvasFontState): Promise<void> {
  const unique = new Map([...fonts].map((font) => [`${font.family}\0${font.style}`, font] as const))
  await Promise.all([...unique.values()].map((font) => loadFont(font, state)))
}

const PORTABLE_FONT_CANDIDATES = {
  mono: ['Noto Sans Mono', 'Roboto Mono', 'IBM Plex Mono', 'Source Code Pro', 'Space Mono'],
  sans: ['Inter'],
  serif: ['Noto Serif', 'Source Serif 4', 'Roboto Serif', 'Merriweather', 'Georgia']
} as const

function normalizedFontStyle(style: string): string {
  return style.toLowerCase().replaceAll(/[^a-z]/g, '')
}

function fontStyleWeight(style: string): number {
  const normalized = normalizedFontStyle(style)
  if (normalized.includes('thin')) return 100
  if (normalized.includes('extralight') || normalized.includes('ultralight')) return 200
  if (normalized.includes('light')) return 300
  if (normalized.includes('medium')) return 500
  if (normalized.includes('semibold') || normalized.includes('demibold')) return 600
  if (normalized.includes('extrabold') || normalized.includes('ultrabold')) return 800
  if (normalized.includes('black') || normalized.includes('heavy')) return 900
  if (normalized.includes('bold')) return 700
  return 400
}

function closestFontStyle(fonts: Font[], desiredStyle: string, weight?: number): FontName {
  const normalizedDesired = normalizedFontStyle(desiredStyle)
  const exact = fonts.find(
    ({ fontName }) => normalizedFontStyle(fontName.style) === normalizedDesired
  )
  if (exact && weight === undefined) return exact.fontName

  const desiredWeight = weight ?? fontStyleWeight(desiredStyle)
  const desiredItalic = /italic/i.test(desiredStyle)
  let closest = fonts[0]!
  let closestScore = Infinity
  for (const font of fonts) {
    const score =
      Math.abs(fontStyleWeight(font.fontName.style) - desiredWeight) +
      (/italic/i.test(font.fontName.style) === desiredItalic ? 0 : 1000)
    if (score < closestScore) {
      closest = font
      closestScore = score
    }
  }
  return closest.fontName
}

export async function resolveFamilyFont(
  family: string,
  desiredStyle: string,
  state: CanvasFontState,
  weight?: number
): Promise<FontName> {
  state.availableFonts ??= figma.listAvailableFontsAsync()
  const fonts = (await state.availableFonts).filter(({ fontName }) => fontName.family === family)
  if (!fonts.length)
    specError(
      `Font family "${family}" is unavailable. Query get_design_system with scope: "fonts" for available families and styles.`
    )
  return closestFontStyle(fonts, desiredStyle, weight)
}

export async function resolvePortableFont(
  family: NonNullable<NonNullable<CanvasNodeSpec['text']>['portableFontFamily']>,
  desiredStyle: string,
  state: CanvasFontState
): Promise<FontName> {
  state.availableFonts ??= figma.listAvailableFontsAsync()
  let available: Font[]
  try {
    available = await state.availableFonts
  } catch {
    specError('Available Figma fonts could not be listed for a portable font utility.')
  }

  for (const candidate of PORTABLE_FONT_CANDIDATES[family]) {
    const matching = available.filter(({ fontName }) => fontName.family === candidate)
    if (matching.length) return closestFontStyle(matching, desiredStyle)
  }
  specError(
    `No portable ${family} font is available in the current Figma context; use an exact available font.`
  )
}

export function currentTextFonts(
  node: TextNode,
  range?: { start: number; end: number }
): FontName[] {
  if (range) return node.getRangeAllFontNames(range.start, range.end)
  return node.fontName === figma.mixed
    ? node.getRangeAllFontNames(0, node.characters.length)
    : [node.fontName]
}
