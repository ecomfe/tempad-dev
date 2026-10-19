import type { CanvasVariableReference } from '@tempad-dev/shared'

export const GEOMETRY_TOLERANCE = 0.01

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isVariableBinding(value: unknown): value is { variable: CanvasVariableReference } {
  return isRecord(value) && 'variable' in value
}

export function scalarValuesEqual(current: unknown, desired: unknown): boolean {
  return (
    Object.is(current, desired) ||
    (typeof current === 'number' && typeof desired === 'number' && current === Math.fround(desired))
  )
}

export function transformsMatch(current: Transform, desired: Transform): boolean {
  return current.every((row, rowIndex) =>
    row.every((value, columnIndex) => {
      const expected = desired[rowIndex]![columnIndex]!
      return (
        Math.abs(value - expected) <= 1e-6 ||
        (columnIndex === 2 && scalarValuesEqual(value, expected))
      )
    })
  )
}

function comparableEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).filter(
    ([key, field]) =>
      !(
        (key === 'boundVariables' || key === 'properties') &&
        isRecord(field) &&
        !Object.keys(field).length
      )
  )
}

export function nativeValueEqual(current: unknown, desired: unknown, numberTolerance = 0): boolean {
  if (Object.is(current, desired)) return true
  if (typeof current === 'number' && typeof desired === 'number') {
    return Math.abs(current - desired) <= numberTolerance
  }
  if (Array.isArray(current) || Array.isArray(desired)) {
    return (
      Array.isArray(current) &&
      Array.isArray(desired) &&
      current.length === desired.length &&
      current.every((value, index) => nativeValueEqual(value, desired[index], numberTolerance))
    )
  }
  if (!isRecord(current) || !isRecord(desired)) return false
  const currentEntries = comparableEntries(current)
  const desiredEntries = comparableEntries(desired)
  return (
    currentEntries.length === desiredEntries.length &&
    currentEntries.every(([key, value]) => nativeValueEqual(value, desired[key], numberTolerance))
  )
}

export const FIGMA_NATIVE_TOLERANCE = 1 / 255 + Number.EPSILON

export function textMeasuresEqual(
  current: LineHeight | LetterSpacing | typeof figma.mixed,
  desired: LineHeight | LetterSpacing
): boolean {
  return (
    current !== figma.mixed &&
    current.unit === desired.unit &&
    (current.unit === 'AUTO' ||
      (desired.unit !== 'AUTO' && scalarValuesEqual(current.value, desired.value)))
  )
}

export function hyperlinksEqual(
  current: HyperlinkTarget | null | typeof figma.mixed,
  desired: HyperlinkTarget | null
): boolean {
  return (
    current !== figma.mixed &&
    (current === desired ||
      (!!current && !!desired && current.type === desired.type && current.value === desired.value))
  )
}

export function rotationsMatch(current: number, desired: number): boolean {
  const delta = ((((current - desired + 180) % 360) + 360) % 360) - 180
  return Math.abs(delta) <= 0.001
}

export function finiteRect(value: Rect | null | undefined): Rect | null {
  return value &&
    [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
    value.width >= 0 &&
    value.height >= 0
    ? value
    : null
}
