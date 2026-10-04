import type { Group } from '@/types/rewrite'

import rules from '@/public/rules/figma.json'

import { GROUPS } from './config'
import { applyGroups, getRewriteTargetRegex, isRules } from './shared'

export const REWRITE_RUNTIME_PROTOCOL = 1

export interface RewriteRuntime {
  protocol: typeof REWRITE_RUNTIME_PROTOCOL
  targetPattern: string
  rewrite: (source: string, url: string) => string
}

export function rewriteSource(source: string, groups: Group[]): string {
  return applyGroups(source, groups).content.replaceAll(
    'delete window.figma',
    'window.figma = undefined'
  )
}

export const bundledRuntime: RewriteRuntime = {
  protocol: REWRITE_RUNTIME_PROTOCOL,
  targetPattern: (isRules(rules) && getRewriteTargetRegex(rules)?.source) || 'a^',
  rewrite: (source) => rewriteSource(source, GROUPS)
}
