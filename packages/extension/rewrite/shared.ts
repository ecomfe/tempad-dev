import type { Group, Replacement } from '@/types/rewrite'

import { logger } from '@/utils/log'

function applyReplacement(content: string, replacement: Replacement): string {
  const { pattern, replacer } = replacement

  if (typeof pattern === 'string') {
    if (typeof replacer === 'string') {
      return content.replaceAll(pattern, replacer)
    }
    return content.replaceAll(pattern, replacer)
  }

  if (typeof replacer === 'string') {
    return content.replace(pattern, replacer)
  }
  return content.replace(pattern, replacer)
}

export function groupMatches(content: string, group: Group) {
  const markers = group.markers || []
  return markers.every((marker) => content.includes(marker))
}

export function applyGroups(
  content: string,
  groups: Group[],
  options: { logReplacements?: boolean } = {}
) {
  let out = content
  const matchedGroups: number[] = []
  const rewrittenGroups: number[] = []
  const replacementStats: { groupIndex: number; replacementIndex: number; changed: boolean }[] = []
  const { logReplacements = true } = options

  for (const [index, group] of groups.entries()) {
    if (!groupMatches(out, group)) {
      continue
    }
    matchedGroups.push(index)

    let groupChanged = false
    for (const [replacementIndex, replacement] of group.replacements.entries()) {
      const { pattern, replacer } = replacement
      const before = out
      out = applyReplacement(out, replacement)

      const changed = out !== before
      replacementStats.push({ groupIndex: index, replacementIndex, changed })

      if (changed) {
        groupChanged = true
        if (logReplacements) {
          logger.log(`Applied replacement: ${pattern} -> ${replacer}`)
        }
      } else {
        if (logReplacements) {
          logger.warn(`Replacement had no effect: ${pattern} -> ${replacer}`)
        }
      }
    }

    if (groupChanged) {
      rewrittenGroups.push(index)
    }
  }
  return {
    content: out,
    changed: out !== content,
    matchedGroups,
    rewrittenGroups,
    replacementStats
  }
}
