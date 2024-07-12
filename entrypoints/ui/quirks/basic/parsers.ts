const PARENT_INDEX_RE = /^(\d+):(\d+);/

export function getParentIndex(raw: string): string | null {
  const [, index] = raw.match(PARENT_INDEX_RE) || []
  return index || null
}

export function getBool(raw: string): boolean {
  return raw === 'true'
}

export function getFloat(raw: string): number {
  if (raw === 'inf') {
    return Infinity
  }
  if (raw === 'nan') {
    return Number.NaN
  }
  return parseFloat(raw)
}

export function getInt(raw: string): number {
  return parseInt(raw, 10)
}

export function getString(raw: string): string {
  return raw.substring(1, raw.length - 1)
}

export function getEnumString(raw: string): string {
  return raw.substring(3)
}

export function getFloatArray(raw: string): number[] {
  return JSON.parse(`[${raw.substring(1, raw.length - 1)}]`)
}

export function getStringArray(raw: string): string[] {
  return raw
    .substring(1, raw.length - 1)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const VECTOR_RE = /^VectorF\(([^,]+), ([^)]+)\)$/

export function getFloatVector2(raw: string): [number, number] | null {
  if (raw === '(null)') {
    return null
  }

  const [, v0, v1] = raw.match(VECTOR_RE) || []
  if (!v0 || !v1) {
    return null
  }

  return [getFloat(v0), getFloat(v1)]
}

const NODE_TYPE_MAP: Record<string, NodeType> = {
  ROUNDED_RECTANGLE: 'RECTANGLE',
  REGULAR_POLYGON: 'POLYGON',
  SYMBOL: 'COMPONENT'
}

export function getNodeType(type: string): NodeType {
  const typeString = getEnumString(type)
  return NODE_TYPE_MAP[typeString] || typeString
}

export const basicParsers = {
  ParentIndex: getParentIndex,
  ImmutableString: getString,
  NodeType: getNodeType,
  bool: getBool,
  float: getFloat,
  int: getInt,
  'TVector2<float>': getFloatVector2,
  'Optional<TVector2<float>': getFloatVector2,
  'ImmutableArray<float>': getFloatArray
}
