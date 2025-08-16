import type { Group, Replacement } from './config'

export function groupMatches(content: string, group: Group) {
  const markers = group.markers || []
  return markers.every((marker) => content.includes(marker))
}

export function replacementWouldChange(content: string, replacement: Replacement) {
  if (typeof replacement.pattern === 'string') {
    return content.includes(replacement.pattern)
  }
  const re = new RegExp(replacement.pattern.source, replacement.pattern.flags)
  return re.test(content)
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

export function analyze(content: string, groups: Group[]) {
  for (const group of groups) {
    if (!groupMatches(content, group)) {
      continue
    }
    if (group.replacements.some((r) => replacementWouldChange(content, r))) {
      return { matched: true, rewritable: true }
    }
    return { matched: true, rewritable: false }
  }
  return { matched: false, rewritable: false }
}
