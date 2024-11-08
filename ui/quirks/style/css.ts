import { toDecimalPlace } from '@/utils'

import type { QuirksNodeProps, StyleRecord } from '../types'

function isShape(type: NodeType) {
  return ['VECTOR', 'ELLIPSE', 'STAR', 'POLYGON'].includes(type)
}

export function getStyleCSS(props: QuirksNodeProps): StyleRecord {
  const result: StyleRecord = {}

  const opacity = props.opacity
  if (opacity !== 1) {
    result.opacity = `${toDecimalPlace(opacity, 4)}`
  }

  const blendMode = props['blend-mode']
  if (blendMode !== 'pass-through') {
    result['mix-blend-mode'] = blendMode
  }

  const fill = props['fill-paint-data'] || []
  if (fill.length) {
    const fillString = fill.join(', ')
    if (props.type === 'TEXT') {
      if (
        fill.length > 1 ||
        fill.some((f) => f.includes('linear-gradient')) ||
        fill.some((f) => f.includes('url('))
      ) {
        // not simple color
        result.background = fillString
        result['-webkit-background-clip'] = 'text'
        result['background-clip'] = 'text'
        result['-webkit-text-fill-color'] = 'transparent'
        result['text-fill-color'] = 'transparent'
      } else {
        result.color = fillString
      }
    } else if (isShape(props.type)) {
      result.fill = fillString
    } else {
      result.background = fillString
    }
  }

  return {
    ...result,
    ...(isShape(props.type) ? getStrokeCSS(props) : getBordersCSS(props)),
    ...getBorderRadiusCSS(props)
  }
}

function getStrokeCSS(props: QuirksNodeProps): StyleRecord | null {
  const strokeWidth = toDecimalPlace(props['stroke-weight'] || 0)
  const strokeColor = props['stroke-paint-data'] || []
  if (!strokeWidth || strokeColor.length === 0) {
    return null
  }
  return {
    'stroke-width': `${strokeWidth}px`,
    stroke: strokeColor.join(', ')
  }
}

function getBordersCSS(props: QuirksNodeProps): StyleRecord | null {
  const borderTopWidth = props['border-top-weight']
  const borderRightWidth = props['border-right-weight']
  const borderBottomWidth = props['border-bottom-weight']
  const borderLeftWidth = props['border-left-weight']
  const borderColor = props['stroke-paint-data'] || []

  const anyWidth = borderTopWidth || borderRightWidth || borderBottomWidth || borderLeftWidth

  if (!anyWidth || borderColor.length === 0) {
    return null
  }

  const borderStyle = props['stroke-dash-pattern']?.length ? 'dashed' : 'solid'

  if (!props['border-stroke-weights-independent']) {
    const borderWidth = toDecimalPlace(anyWidth)
    if (!borderWidth) {
      return null
    }
    return {
      border: `${borderWidth}px ${borderStyle} ${borderColor}`
    }
  }

  const topWidth = toDecimalPlace(props['border-top-weight'] || 0)
  const rightWidth = toDecimalPlace(props['border-right-weight'] || 0)
  const bottomWidth = toDecimalPlace(props['border-bottom-weight'] || 0)
  const leftWidth = toDecimalPlace(props['border-left-weight'] || 0)

  const borders: StyleRecord = {}

  if (topWidth) {
    borders['border-top'] = `${topWidth}px ${borderStyle} ${borderColor}`
  }
  if (rightWidth) {
    borders['border-right'] = `${rightWidth}px ${borderStyle} ${borderColor}`
  }
  if (bottomWidth) {
    borders['border-bottom'] = `${bottomWidth}px ${borderStyle} ${borderColor}`
  }
  if (leftWidth) {
    borders['border-left'] = `${leftWidth}px ${borderStyle} ${borderColor}`
  }

  return borders
}

function getBorderRadiusCSS(props: QuirksNodeProps): StyleRecord | null {
  if (!props['rectangle-corner-radii-independent']) {
    const borderRadius = toDecimalPlace(props['rectangle-top-left-corner-radius'] || 0)
    if (!borderRadius) {
      return null
    }
    return {
      'border-radius': `${borderRadius}px`
    }
  }

  const topLeft = toDecimalPlace(props['rectangle-top-left-corner-radius'] || 0)
  const topRight = toDecimalPlace(props['rectangle-top-right-corner-radius'] || 0)
  const bottomLeft = toDecimalPlace(props['rectangle-bottom-left-corner-radius'] || 0)
  const bottomRight = toDecimalPlace(props['rectangle-bottom-right-corner-radius'] || 0)

  return {
    'border-radius': `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`
  }
}
