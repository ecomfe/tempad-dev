import { toDecimalPlace } from '../../utils'
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

  const fill = props['fill-paint-data']
  if (fill) {
    if (props.type === 'TEXT') {
      if (fill.includes('linear-gradient') || fill.includes('url(') || fill.includes(', ')) {
        // not simple color
        result.background = fill
        result['-webkit-background-clip'] = 'text'
        result['background-clip'] = 'text'
        result['-webkit-text-fill-color'] = 'transparent'
        result['text-fill-color'] = 'transparent'
      } else {
        result.color = fill
      }
    } else if (isShape(props.type)) {
      result.fill = fill
    } else {
      result.background = fill
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
  if (!strokeWidth) {
    return null
  }
  const strokeColor = props['stroke-paint-data']
  return {
    'stroke-width': `${strokeWidth}px`,
    stroke: strokeColor
  }
}

function getBordersCSS(props: QuirksNodeProps): StyleRecord | null {
  const borderTopWidth = props['border-top-weight']
  if (!borderTopWidth) {
    return null
  }

  const borderStyle = props['stroke-dash-pattern'].length ? 'dashed' : 'solid'
  const borderColor = props['stroke-paint-data']

  if (!props['border-stroke-weights-independent']) {
    const borderWidth = toDecimalPlace(borderTopWidth)
    if (!borderWidth) {
      return null
    }
    return {
      border: `${borderWidth}px ${borderStyle} ${borderColor}`
    }
  }

  const topWidth = toDecimalPlace(borderTopWidth)
  const rightWidth = toDecimalPlace(props['border-right-weight'] || 0)
  const bottomWidth = toDecimalPlace(props['border-bottom-weight'] || 0)
  const leftWidth = toDecimalPlace(props['border-left-weight'] || 0)

  return {
    'border-top': `${topWidth}px ${borderStyle} ${borderColor}`,
    'border-right': `${rightWidth}px ${borderStyle} ${borderColor}`,
    'border-bottom': `${bottomWidth}px ${borderStyle} ${borderColor}`,
    'border-left': `${leftWidth}px ${borderStyle} ${borderColor}`
  }
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
