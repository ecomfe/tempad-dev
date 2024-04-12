export function parseNumber(value: string) {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

export function toDecimalPlace(value: string | number, decimalPlaces: number = 3): number {
  const val = typeof value === 'string' ? parseNumber(value) : value

  if (val == null) {
    return 0
  }

  return Number(val.toFixed(decimalPlaces))
}
