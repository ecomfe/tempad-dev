import { parseNumber, toDecimalPlace } from '../../utils'
import type { StyleRecord } from '../types'
import type { NumericFigure, NumericSpacing, NumericFraction } from './types'

interface FontMetaData {
  style: string
  weight: number
}

const FONT_META_SECTION_RE = /fontMetaData:\s*\{([^}]+)}/
const FONT_META_RE = /\s+([^:]+):\s*FontMetaData\([^,]+,\s*[^,]+,\s*([^,]+),\s*([^)]+)/g

export function getFontFace(raw?: string, textData?: string): Record<string, string> | null {
  if (!textData || !raw) {
    return null
  }

  const [, fontMetaDataSection] = textData.match(FONT_META_SECTION_RE) || []
  const fonts = [...fontMetaDataSection.matchAll(FONT_META_RE)].reduce(
    (acc, cur) => {
      const [, fullName, style, weight] = cur

      if (!fullName) {
        return acc
      }

      return {
        ...acc,
        [fullName]: {
          style,
          weight: parseNumber(weight) || 400
        }
      }
    },
    {} as Record<string, FontMetaData>
  )

  // Noto Sans Display Bold 2 -> Noto Sans Display
  const fullName = raw.replace(/\s+\d+(?:\.\d+)?$/, '')
  const font = fonts[fullName]
  if (!font) {
    return null
  }

  const { style, weight } = font

  const result: StyleRecord = {
    'font-family': getFontFamily(fullName, style)
  }

  if (style !== 'normal') {
    result['font-style'] = style
  }

  if (weight !== 400) {
    result['font-weight'] = `${weight}`
  }

  return result
}

// Based on Figma's own heuristics:
// https://youtu.be/kVD-sjtFoEI?si=5rdjpzZTGalH1Nix&t=247
const WEIGHT_MODIFIERS = [
  // 100
  'hairline',
  'thin',

  // 200
  'ultra light',
  'extra light',

  // 300
  'demi',
  'light',
  'book',

  // 400
  'regular',
  // 'book',
  'normal',

  // 500
  'medium',

  // 600
  'demi bold',
  'semi bold',

  // 700
  'bold',

  // 800
  'ultra bold',
  'extra bold',

  // 900
  'black',
  'heavy'
]
const WEIGHT_MODIFIER_RE = new RegExp(
  `\\s+(?:${WEIGHT_MODIFIERS.map((mod) => mod.replace(' ', '[ -]?')).join('|')})$`,
  'i'
)

const ITALIC_MODIFIER_RE = /\s+italic/i

const CONTEXTUAL_MODIFIERS = ['display', 'text', 'caption', 'headline', 'subhead', 'poster', 'body']
const CONTEXTUAL_MODIFIER_RE = new RegExp(`\\s+(?:${CONTEXTUAL_MODIFIERS.join('|')})$`, 'i')

export function getFontFamily(fullName: string, style: string): string {
  let family = fullName
  if (style === 'italic') {
    family = fullName.replace(ITALIC_MODIFIER_RE, '').trim()
  }

  family = family.replace(WEIGHT_MODIFIER_RE, '').trim()
  family = family.replace(CONTEXTUAL_MODIFIER_RE, '').trim()

  return family.includes(' ') ? `"${family}"` : family
}

interface FontVariantNumericFeatures {
  figure: NumericFigure
  spacing: NumericSpacing
  fraction: NumericFraction
  slashedZero: boolean
  ordinal: boolean
}

export function getVariantNumeric({
  figure,
  spacing,
  fraction,
  slashedZero,
  ordinal
}: FontVariantNumericFeatures): string {
  return [
    ...[figure, spacing, fraction].filter((feature) => feature !== 'normal'),
    ...(slashedZero ? ['slashed-zero'] : []),
    ...(ordinal ? ['ordinal'] : [])
  ].join(' ')
}

export function getLineHeight(raw?: string): string {
  // undefined -> normal
  // 100% -> normal
  if (!raw || raw === '100%') {
    return 'normal'
  }

  // 24.123456789px -> 24.123px
  if (raw.endsWith('px')) {
    return `${toDecimalPlace(raw.slice(0, -2), 3)}`
  }

  // 1.234567 -> 1.235
  return `${toDecimalPlace(raw)}`
}
