export type Replacement = {
  pattern: string | RegExp
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replacer: string | ((...args: any[]) => string)
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

export type Rules = NonNullable<
  Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[0]['addRules']
>
