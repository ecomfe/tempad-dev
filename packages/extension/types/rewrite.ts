export type Replacement = {
  pattern: string | RegExp
  replacer: string | ((...args: unknown[]) => string)
}

export type Group = {
  markers?: string[]
  replacements: Replacement[]
}

export type Rules = NonNullable<
  Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[0]['addRules']
>
