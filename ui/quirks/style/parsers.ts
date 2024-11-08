import { snakeToKebab, fadeTo, parseNumber, toDecimalPlace } from '@/utils'

import { getEnumString } from '../basic'

export function getBlendMode(raw: string): string {
  const modeString = getEnumString(raw)
  return snakeToKebab(modeString) || modeString
}

const PAINT_DATA_RE = /^PaintData\(([\s\S]*)\)$/
const PAINT_RE = /(Solid|Gradient|Raster)Paint\((.+)\)/g
const PAINT_VALUE_RE = /([^,]+)(?:,\s*colorVar[^)]+\))?(?:,\s*opacity (.*))?/

export function getPaint(raw: string): string[] {
  const [, rawPaints] = raw.match(PAINT_DATA_RE) || []

  if (!rawPaints) {
    return []
  }

  const paints: string[] = []

  ;[...rawPaints.matchAll(PAINT_RE)].forEach((match) => {
    const [, type, paintValue] = match
    const [, paint, opacity] = paintValue.match(PAINT_VALUE_RE) || []
    if (!paint) {
      return
    }

    const opacityValue = toDecimalPlace(opacity || 1, 2)
    switch (type) {
      case 'Solid':
        if (opacityValue > 0) {
          paints.push(fadeTo(paint, opacityValue))
        }
        break
      case 'Gradient':
        paints.push(`linear-gradient(<color-stops>)`)
        break
      case 'Raster':
        paints.push(`url(<path-to-image>) no-repeat`)
        break
      default:
        break
    }
  })

  return paints.reverse()
}

const EFFECT_RE = /EffectData\[([^\]]+)\]/
export function getEffectCount(raw: string): number {
  const [, effectCount = ''] = raw.match(EFFECT_RE) || []
  return parseNumber(effectCount) || 0
}

export const styleParsers = {
  BlendMode: getBlendMode,
  'Immutable<PaintData>': getPaint,
  'Immutable<EffectData>': getEffectCount
}
