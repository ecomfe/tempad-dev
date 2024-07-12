import { toDecimalPlace } from '../../utils'
import type { QuirksNodeProps, StyleRecord } from '../types'

export function getBasicCSS(props: QuirksNodeProps): StyleRecord {
  const result: StyleRecord = {}

  const [width, height] = props.size!
  Object.assign(result, {
    width: `${toDecimalPlace(width)}px`,
    height: `${toDecimalPlace(height)}px`
  })

  const maxSize = props['max-size']
  if (maxSize) {
    const [width, height] = maxSize
    Object.assign(result, {
      ...(width !== Infinity ? { 'max-width': `${toDecimalPlace(width)}px` } : {}),
      ...(height !== Infinity ? { 'max-height': `${toDecimalPlace(height)}px` } : {})
    })
  }

  const minSize = props['min-size']
  if (minSize) {
    const [width, height] = minSize
    Object.assign(result, {
      ...(width !== 0 ? { 'min-width': `${toDecimalPlace(width)}px` } : {}),
      ...(height !== 0 ? { 'min-height': `${toDecimalPlace(height)}px` } : {})
    })
  }

  // We only need to calculate the rotation part
  const matrix = props['relative-transform']
  const { a, c } = matrix
  const angle = Math.atan2(c, a) * (180 / Math.PI)
  if (angle) {
    result.transform = `rotate(${toDecimalPlace(angle, 2)}deg)`
  }

  return result
}
