import type { Group } from '@/types/rewrite'

export const RULES_URL = 'https://ecomfe.github.io/tempad-dev/figma.json'
export const REWRITE_RULE_ID = 2

export function groupMatches(content: string, group: Group) {
  const markers = group.markers || []
  return markers.every((marker) => content.includes(marker))
}

export function applyGroups(content: string, groups: Group[]) {
  let out = content
  for (const group of groups) {
    if (!groupMatches(out, group)) {
      continue
    }
    for (const { pattern, replacer } of group.replacements) {
      if (typeof pattern === 'string') {
        // @ts-ignore
        out = out.replaceAll(pattern, replacer)
      } else {
        // @ts-ignore
        out = out.replace(pattern, replacer)
      }
    }
  }
  return { content: out, changed: out !== content }
}
