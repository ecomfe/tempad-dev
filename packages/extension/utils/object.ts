type Prune<T> = T extends undefined
  ? never
  : T extends readonly unknown[]
    ? PruneArray<T>
    : T extends object
      ? PruneObject<T>
      : T

type PruneArray<T extends readonly unknown[]> = {
  [K in keyof T]: PruneArrayItem<T[K]>
}

type PruneArrayItem<Item> = Item extends undefined
  ? Item
  : Item extends readonly unknown[]
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function prune<T extends object>(obj: T): Prune<T> extends never ? undefined : Prune<T> {
  return pruneValue(obj, false) as Prune<T> extends never ? undefined : Prune<T>
}

function pruneValue(value: unknown, insideArray: boolean): unknown {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => pruneValue(item, true))
  }

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue

    const pruned = pruneValue(item, false)
    if (pruned === undefined) continue

    if (isPlainObject(pruned) && Object.keys(pruned).length === 0) {
      continue
    }

    result[key] = pruned
  }

  if (Object.keys(result).length === 0) {
    return insideArray ? {} : undefined
  }

  return result
}
