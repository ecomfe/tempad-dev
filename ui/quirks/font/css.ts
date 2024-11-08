import { toDecimalPlace } from '@/utils'

import type { QuirksNodeProps, StyleRecord } from '../types'

import { getFontFace, getLineHeight, getVariantNumeric } from './utils'

const ALIGN_FLEX_MAP = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
  left: 'flex-start',
  right: 'flex-end'
} as const

export function getFontCSS(props: QuirksNodeProps): StyleRecord {
  const result: StyleRecord = {}

  const fontFace = getFontFace(props['font-handle'], props['derived-text-data'])
  if (fontFace) {
    Object.assign(result, fontFace)
  }

  const size = toDecimalPlace(props['font-size'] || 0)
  result['font-size'] = `${size}px`

  const lineHeight = getLineHeight(props['line-height'])
  if (lineHeight !== 'normal') {
    result['line-height'] = lineHeight
  }

  const textCase = props['text-case'] || 'none'
  const fontCaps = props['font-variant-caps'] || 'normal'
  if (textCase !== 'none') {
    result['text-transform'] = textCase
  }
  if (fontCaps !== 'normal') {
    result['font-variant-caps'] = fontCaps
  }

  const autoResize = props['text-auto-resize'] || 'width'
  const alignX = props['text-align-horizontal'] || 'left'
  const alignY = props['text-align-vertical'] || 'top'
  if (autoResize === 'width') {
    result.width = ''
    result.height = ''
  } else if (autoResize === 'height') {
    result.height = ''
    if (alignX !== 'left') {
      result['text-align'] = alignX
    }
  } else {
    result.display = 'flex'
    if (alignX !== 'left' && alignX !== 'justify') {
      result['justify-content'] = ALIGN_FLEX_MAP[alignX]
    }
    if (alignY !== 'top') {
      result['align-items'] = ALIGN_FLEX_MAP[alignY]
    }
  }

  const decoration = props['text-decoration'] || 'none'
  if (decoration !== 'none') {
    result['text-decoration'] = decoration
  }

  const indent = toDecimalPlace(props['paragraph-indent'] || 0, 5)
  if (indent !== 0) {
    result['text-indent'] = `${indent}px`
  }

  const truncation = props['text-truncation']
  const maxLines = props['max-lines'] || 1
  if (truncation) {
    if (autoResize === 'none') {
      result.display = 'block'
    } else if (maxLines > 1) {
      result.display = '-webkit-box'
      result['-webkit-line-clamp'] = `${maxLines}`
      result['-webkit-box-orient'] = 'vertical'
    }
    result['text-overflow'] = 'ellipsis'
    result['white-space'] = 'nowrap'
    result.overflow = 'hidden'
  }

  const figure = props['font-variant-numeric-figure'] || 'normal'
  const spacing = props['font-variant-numeric-spacing'] || 'normal'
  const fraction = props['font-variant-numeric-fraction'] || 'normal'
  const slashedZero = props['font-variant-slashed-zero'] || false
  const ordinal = props['font-variant-ordinal'] || false

  const numericFeatures = getVariantNumeric({ figure, spacing, fraction, slashedZero, ordinal })
  if (numericFeatures) {
    result['font-variant-numeric'] = numericFeatures
  }

  const onFeatures = props['toggled-on-ot-features'] || []
  const offFeatures = props['toggled-off-ot-features'] || []
  if (onFeatures.length || offFeatures.length) {
    result['font-feature-settings'] = [
      ...onFeatures.map((tag) => `"${tag.toLowerCase()}"`),
      ...offFeatures.map((tag) => `"${tag.toLowerCase()}" 0`)
    ].join(', ')
  }

  const position = props['font-vairant-position'] || 'normal'
  if (position !== 'normal') {
    result['font-variant-position'] = position
  }

  return result
}
