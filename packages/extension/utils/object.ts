/* eslint-disable @typescript-eslint/no-explicit-any */

type Prune<T> = T extends undefined
  ? never
  : T extends any[]
    ? PruneArray<T>
    : T extends object
      ? PruneObject<T>
      : T

type PruneArray<T extends any[]> = {
  [K in keyof T]: PruneArrayItem<T[K]>
}

type PruneArrayItem<Item> = Item extends undefined
  ? Item
  : Item extends any[]
    ? PruneArray<Item>
    : Item extends object
      ? PruneObjectInArray<Item>
      : Item

type PruneObjectInArray<T extends object> = {
  [K in keyof T as T[K] extends undefined ? never : Prune<T[K]> extends never ? never : K]: Prune<
    T[K]
  >
}

type PruneObject<T extends object> = {
  [K in keyof T as T[K] extends undefined ? never : Prune<T[K]> extends never ? never : K]: Prune<
    T[K]
  >
} extends infer O
  ? O extends object
    ? keyof O extends never
      ? never
      : O
    : never
  : never

export function prune<T extends object>(obj: T): Prune<T> extends never ? undefined : Prune<T> {
  return _prune(obj, false) as any
}

function _prune(value: any, insideArray: boolean): any {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => _prune(item, true))
  }

  const result: Record<string, any> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue

    const pruned = _prune(v, false)

    if (pruned === undefined) continue

    if (typeof pruned === 'object' && !Array.isArray(pruned) && Object.keys(pruned).length === 0) {
      continue
    }

    result[k] = pruned
  }

  if (Object.keys(result).length === 0) {
    return insideArray ? {} : undefined
  }
  return result
}
