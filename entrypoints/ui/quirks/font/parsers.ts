import { getEnumString, getStringArray } from '../basic'
import type {
  TextCase,
  TextAutoResize,
  TextAlignX,
  TextAlignY,
  TextDecoration,
  NumericFigure,
  NumericSpacing,
  NumericFraction,
  FontCaps,
  FontPosition
} from './types'

const TEXT_CASE_MAP: Record<string, TextCase> = {
  ORIGINAL: 'none',
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize'
}

export function getTextCase(raw: string): TextCase {
  const caseString = getEnumString(raw)
  return TEXT_CASE_MAP[caseString] || caseString
}

const TEXT_AUTO_RESIZE_MAP: Record<string, TextAutoResize> = {
  NONE: 'none',
  WIDTH_AND_HEIGHT: 'width',
  HEIGHT: 'height'
}

export function getTextAutoResize(raw: string): TextAutoResize {
  const resizeString = getEnumString(raw)
  return TEXT_AUTO_RESIZE_MAP[resizeString] || resizeString
}

const TEXT_ALIGN_X_MAP: Record<string, TextAlignX> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  JUSIFIED: 'justify'
}

export function getAlignX(raw: string): TextAlignX {
  const alignString = getEnumString(raw)
  return TEXT_ALIGN_X_MAP[alignString] || alignString
}

const TEXT_ALIGN_Y_MAP: Record<string, TextAlignY> = {
  TOP: 'top',
  CENTER: 'center',
  BOTTOM: 'bottom'
}

export function getAlignY(raw: string): TextAlignY {
  const alignString = getEnumString(raw)
  return TEXT_ALIGN_Y_MAP[alignString] || alignString
}

const TEXT_DECORATION_MAP: Record<string, TextDecoration> = {
  NONE: 'none',
  UNDERLINE: 'underline',
  STRIKETHROUGH: 'line-through'
}

export function getTextDecoration(raw: string): TextDecoration {
  const decorationString = getEnumString(raw)
  return TEXT_DECORATION_MAP[decorationString] || decorationString
}

export function getTextTruncation(raw: string): boolean {
  const truncationString = getEnumString(raw)
  return truncationString !== 'DISABLED'
}

const NUMERIC_FIGURE_MAP: Record<string, NumericFigure> = {
  NORMAL: 'normal',
  LINING: 'lining-nums',
  OLDSTYLE: 'oldstyle-nums'
}

export function getNumericFigure(raw: string): NumericFigure {
  const figureString = getEnumString(raw)
  return NUMERIC_FIGURE_MAP[figureString] || figureString
}

const NUMERIC_SPACING_MAP: Record<string, NumericSpacing> = {
  NORMAL: 'normal',
  PROPORTIONAL: 'proportional-nums',
  TABULAR: 'tabular-nums'
}

export function getNumericSpacing(raw: string): NumericSpacing {
  const spacingString = getEnumString(raw)
  return NUMERIC_SPACING_MAP[spacingString] || spacingString
}

const NUMERIC_FRACTION_MAP: Record<string, NumericFraction> = {
  NORMAL: 'normal',
  STACKED: 'stacked-fractions'
}

export function getNumericFraction(raw: string): NumericFraction {
  const fractionString = getEnumString(raw)
  return NUMERIC_FRACTION_MAP[fractionString] || fractionString
}

const FONT_CAPS_MAP: Record<string, FontCaps> = {
  NORMAL: 'normal',
  SMALL: 'smallcaps',
  ALL_SMALL: 'all-small-caps'
}

export function getFontCaps(raw: string): FontCaps {
  const capsString = getEnumString(raw)
  return FONT_CAPS_MAP[capsString] || capsString
}

const FONT_POSITION_MAP: Record<string, FontPosition> = {
  NORMAL: 'normal',
  SUB: 'sub',
  SUPER: 'super'
}

export function getFontPosition(raw: string): FontPosition {
  const positionString = getEnumString(raw)
  return FONT_POSITION_MAP[positionString] || positionString
}

export function getOpenTypeFeatures(raw: string): string[] {
  return getStringArray(raw)
}

export const fontParsers = {
  TextCase: getTextCase,
  TextAutoResize: getTextAutoResize,
  AlignX: getAlignX,
  AlignY: getAlignY,
  TextDecoration: getTextDecoration,
  TextTruncation: getTextTruncation,
  FontVariantNumericFigure: getNumericFigure,
  FontVariantNumericSpacing: getNumericSpacing,
  FontVariantNumericFraction: getNumericFraction,
  FontVariantCaps: getFontCaps,
  FontVariantPosition: getFontPosition,
  'ImmutableArray<OpenTypeFeature>': getOpenTypeFeatures
}
