import type { DesignSystemFontsResult, GetDesignSystemParametersInput } from '@tempad-dev/shared'

import { utf8Bytes } from '@tempad-dev/shared'

// Query the environment only: no file nodes, styles, components, or library imports.
export async function queryAvailableFonts(
  args: GetDesignSystemParametersInput
): Promise<DesignSystemFontsResult> {
  const available = await figma.listAvailableFontsAsync()
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  const families = [...new Set(available.map(({ fontName }) => fontName.family))].sort(compare)
  const cursor = args.cursor ?? 0
  const result: DesignSystemFontsResult = { scope: 'fonts' }
  const rows = args.families
    ? [
        ...new Map(
          available
            .filter(({ fontName }) => args.families!.includes(fontName.family))
            .map(({ fontName }) => [JSON.stringify(fontName), fontName])
        ).values()
      ].sort((a, b) => compare(a.family, b.family) || compare(a.style, b.style))
    : families.filter(
        (family) => !args.query || family.toLowerCase().includes(args.query.toLowerCase())
      )
  if (cursor > rows.length || (cursor > 0 && cursor === rows.length)) {
    throw new Error('Font cursor is outside the current query. Restart the font query.')
  }
  if (args.families) {
    result.fonts = []
    const missing = [...new Set(args.families)].filter((family) => !families.includes(family))
    if (missing.length) result.missingFamilies = missing
  } else result.families = []
  if (utf8Bytes(result) > 12 * 1024) {
    throw new Error('Missing font-family names exceed the response budget; query fewer families.')
  }
  let index = cursor
  for (; index < rows.length; index += 1) {
    const row = rows[index]!
    if (typeof row === 'string') result.families!.push(row)
    else result.fonts!.push(row)
    if (utf8Bytes(result) > 12 * 1024) {
      if (typeof row === 'string') result.families!.pop()
      else result.fonts!.pop()
      if (index === cursor)
        throw new Error('A native font name exceeds the bounded font response budget.')
      break
    }
    if (index - cursor >= 31) {
      index += 1
      break
    }
  }
  if (index < rows.length) result.nextCursor = index
  return result
}
