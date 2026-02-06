import type { Group, Replacement, Rules } from '@/types/rewrite'

import { logger } from '@/utils/log'

export const RULES_URL = 'https://ecomfe.github.io/tempad-dev/figma.json'
export const REWRITE_RULE_ID = 2

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object'
}

function isRule(value: unknown): value is Rules[number] {
  if (!isRecord(value)) return false
  return typeof value.id === 'number' && isRecord(value.action) && isRecord(value.condition)
}

export function isRules(value: unknown): value is Rules {
  return Array.isArray(value) && value.every(isRule)
}

export function getRewriteTargetRegex(source: Rules): RegExp | null {
  try {
    const rule = source.find((item) => item.id === REWRITE_RULE_ID)
    return rule?.condition?.regexFilter ? new RegExp(rule.condition.regexFilter, 'i') : null
  } catch {
    return null
  }
}

export async function loadRules(url: string, init?: RequestInit): Promise<Rules | null> {
  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      return null
    }
    const payload: unknown = await response.json()
    return isRules(payload) ? payload : null
  } catch {
    return null
  }
}

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
