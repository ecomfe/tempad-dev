export interface CacheEntry {
  url: string
  ref: number
}

export interface BlobHandle {
  url: string
  release: () => void
}

export type Rules = NonNullable<
  Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[number]['addRules']
>
