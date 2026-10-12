export type Replacement = {
  pattern: string | RegExp
  replacer: string | ((...args: unknown[]) => string)
}

export type Group = {
  markers?: string[]
  replacements: Replacement[]
}

export interface CacheEntry {
  url: string
  ref: number
}

export interface BlobHandle {
  url: string
  release: () => void
}
