import { getEnumString } from '../basic'
import { snakeToKebab } from '../../utils'
import type {
  StackAlign,
  StackJustify,
  StackMode,
  StackPosition,
  StackSize,
  StackWrap
} from './types'

const STACK_MODE_MAP: Record<string, StackMode> = {
  HORIZONTAL: 'row',
  VERTICAL: 'column',
  NONE: 'none'
}

export function getStackMode(raw: string): StackMode {
  const modeString = getEnumString(raw)
  return STACK_MODE_MAP[modeString] || modeString
}

const STACK_JUSTIFY_MAP: Record<string, StackJustify> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_EVENLY: 'space-between'
}

export function getStackJustify(raw: string): StackJustify {
  const justifyString = getEnumString(raw)
  return STACK_JUSTIFY_MAP[justifyString] || justifyString
}

const STACK_ALIGN_MAP: Record<string, StackAlign> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  BASELINE: 'baseline',
  STRETCH: 'stretch',
  AUTO: 'auto'
}

export function getStackAlign(raw: string): StackAlign {
  const alignString = getEnumString(raw)
  return STACK_ALIGN_MAP[alignString] || alignString
}

const STACK_WRAP_MAP: Record<string, StackWrap> = {
  WRAP: 'wrap',
  NO_WRAP: 'nowrap'
}

export function getStackWrap(raw: string): StackWrap {
  const wrapString = getEnumString(raw)
  return STACK_WRAP_MAP[wrapString] || wrapString
}

const POSITION_MAP: Record<string, StackPosition> = {
  ABSOLUTE: 'absolute',
  AUTO: 'static'
}

export function getStackPosition(raw: string): StackPosition {
  const positionString = getEnumString(raw)
  return POSITION_MAP[positionString] || positionString
}

const STACK_SIZE_MAP: Record<string, StackSize> = {
  RESIZE_TO_FIT_WITH_IMPLICIT_SIZE: 'hug',
  FIXED: 'fixed'
}

export function getStackSize(raw: string): StackSize {
  const sizeString = getEnumString(raw)
  return STACK_SIZE_MAP[sizeString] || sizeString
}

export function getConstraintType(raw: string): string {
  const typeString = getEnumString(raw)
  return snakeToKebab(typeString) || typeString
}

const TRANSFORM_RE = /^AffineTransformF\(([^)]+)\)$/

export function getTransform(raw: string): DOMMatrixReadOnly | null {
  const [, args] = raw.match(TRANSFORM_RE) || []
  if (!args) {
    return null
  }

  // For transform matrix:
  // a c e
  // b d f
  // 0 0 1
  // CSS transform matrix() order: a, b, c, d, e, f
  // AffineTransformF here: a, c, e, b, d, f
  // So we need to reorder them first.
  const [a, c, e, b, d, f] = JSON.parse(`[${args}]`)

  return new DOMMatrixReadOnly(`matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`)
}

export const stackParsers = {
  StackMode: getStackMode,
  StackJustify: getStackJustify,
  StackAlign: getStackAlign,
  StackCounterAlign: getStackAlign,
  StackWrap: getStackWrap,
  StackPositioning: getStackPosition,
  StackSize: getStackSize,
  ConstraintType: getConstraintType,
  AffineTransformF: getTransform
}
