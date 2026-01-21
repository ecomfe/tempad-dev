import type { Group } from '@/types/rewrite'

import { logger } from '@/utils/log'

export const RULES_URL = 'https://ecomfe.github.io/tempad-dev/figma.json'
export const REWRITE_RULE_ID = 2

export function groupMatches(content: string, group: Group) {
  const markers = group.markers || []
  return markers.every((marker) => content.includes(marker))
}

export function applyGroups(content: string, groups: Group[]) {
  let out = content
  const matchedGroups: number[] = []
  const rewrittenGroups: number[] = []

  for (const [index, group] of groups.entries()) {
    if (!groupMatches(out, group)) {
      continue
    }
    matchedGroups.push(index)

    let groupChanged = false
    for (const { pattern, replacer } of group.replacements) {
      const before = out
      if (typeof pattern === 'string') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        out = out.replaceAll(pattern, replacer)
      } else {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        out = out.replace(pattern, replacer)
      }

      if (out !== before) {
        groupChanged = true
        logger.log(`Applied replacement: ${pattern} -> ${replacer}`)
      } else {
        logger.warn(`Replacement had no effect: ${pattern} -> ${replacer}`)
      }
    }

    if (groupChanged) {
      rewrittenGroups.push(index)
    }
  }
  return { content: out, changed: out !== content, matchedGroups, rewrittenGroups }
}
